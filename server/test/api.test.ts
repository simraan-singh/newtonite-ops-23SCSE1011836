import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/index';
import { pool } from '../src/db';

const tokens: Record<string, string> = {};
const auth = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });

async function login(email: string) {
  const res = await request(app).post('/auth/login').send({ email, password: 'password123' });
  return res.body.token as string;
}

// Every test creates its own fresh item in the Payments team (id 1)
async function newItem() {
  const res = await request(app).post('/items').set(auth('payLead'))
    .send({ title: 'Test item', type: 'TASK', priority: 'HIGH', teamId: 1 });
  expect(res.status).toBe(201);
  return res.body;
}

beforeAll(async () => {
  tokens.payLead = await login('pay.lead@ops.test');
  tokens.payMember = await login('pay.member@ops.test');
  tokens.payViewer = await login('pay.viewer@ops.test');
  tokens.supMember = await login('sup.member@ops.test');
});
afterAll(() => pool.end());

describe('Concurrent claim', () => {
  it('only one of two parallel claims succeeds', async () => {
    const item = await newItem();
    const [a, b] = await Promise.all([
      request(app).post(`/items/${item.id}/claim`).set(auth('payMember')),
      request(app).post(`/items/${item.id}/claim`).set(auth('payLead')),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);

    const events = await request(app).get(`/items/${item.id}/activity`).set(auth('payLead'));
    expect(events.body.filter((e: any) => e.kind === 'CLAIMED')).toHaveLength(1);
  });
});

describe('Stale update (optimistic locking)', () => {
  it('rejects an update with an old version and keeps data unchanged', async () => {
    const item = await newItem();
    const first = await request(app).patch(`/items/${item.id}`).set(auth('payMember'))
      .send({ version: 1, priority: 'LOW' });
    expect(first.status).toBe(200);
    expect(first.body.version).toBe(2);

    const stale = await request(app).patch(`/items/${item.id}`).set(auth('payLead'))
      .send({ version: 1, priority: 'URGENT' });
    expect(stale.status).toBe(409);
    expect(stale.body.latest.version).toBe(2);

    const now = await request(app).get(`/items/${item.id}`).set(auth('payLead'));
    expect(now.body.priority).toBe('LOW');
  });
});

describe('Idempotency', () => {
  it('same Idempotency-Key sent twice in parallel creates only one item', async () => {
    const key = `test-${Date.now()}-${Math.random()}`;
    const title = `Idempotent ${key}`;
    const send = () => request(app).post('/items').set(auth('payLead')).set('Idempotency-Key', key)
      .send({ title, type: 'TASK', priority: 'LOW', teamId: 1 });
    const [a, b] = await Promise.all([send(), send()]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.id).toBe(b.body.id);

    const { rows } = await pool.query('SELECT count(*)::int AS n FROM work_items WHERE title = $1', [title]);
    expect(rows[0].n).toBe(1);
  });
});

describe('Workflow rules', () => {
  it('rejects an invalid jump from OPEN to CLOSED', async () => {
    const item = await newItem();
    const res = await request(app).post(`/items/${item.id}/transition`).set(auth('payLead'))
      .send({ to: 'CLOSED', version: 1 });
    expect(res.status).toBe(422);
  });

  it('only a Lead can approve', async () => {
    const item = await newItem();
    const step1 = await request(app).post(`/items/${item.id}/transition`).set(auth('payMember'))
      .send({ to: 'IN_PROGRESS', version: 1 });
    expect(step1.status).toBe(200);
    const step2 = await request(app).post(`/items/${item.id}/transition`).set(auth('payMember'))
      .send({ to: 'AWAITING_APPROVAL', version: 2 });
    expect(step2.status).toBe(200);

    const memberApprove = await request(app).post(`/items/${item.id}/transition`).set(auth('payMember'))
      .send({ to: 'RESOLVED', version: 3 });
    expect(memberApprove.status).toBe(403);

    const leadApprove = await request(app).post(`/items/${item.id}/transition`).set(auth('payLead'))
      .send({ to: 'RESOLVED', version: 3 });
    expect(leadApprove.status).toBe(200);
    expect(leadApprove.body.status).toBe('RESOLVED');
  });
});

describe('Authorization', () => {
  it('user from another team cannot read or change the item', async () => {
    const item = await newItem();
    const read = await request(app).get(`/items/${item.id}`).set(auth('supMember'));
    const write = await request(app).patch(`/items/${item.id}`).set(auth('supMember')).send({ version: 1, priority: 'LOW' });
    const claim = await request(app).post(`/items/${item.id}/claim`).set(auth('supMember'));
    expect([read.status, write.status, claim.status]).toEqual([404, 404, 404]);
  });

  it('a Viewer can read but cannot claim', async () => {
    const item = await newItem();
    const read = await request(app).get(`/items/${item.id}`).set(auth('payViewer'));
    const claim = await request(app).post(`/items/${item.id}/claim`).set(auth('payViewer'));
    expect(read.status).toBe(200);
    expect(claim.status).toBe(403);
  });

  it('rejects requests without a token', async () => {
    const res = await request(app).get('/items');
    expect(res.status).toBe(401);
  });
});
