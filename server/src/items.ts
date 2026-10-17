import { Router, Response } from 'express';
import { pool, tx, Db } from './db';
import { requireAuth } from './auth';
import { can, AuthUser, Action } from './permissions';
import { HttpError } from './errors';

export const itemsRouter = Router();
itemsRouter.use(requireAuth);

const TYPES = ['INCIDENT', 'CUSTOMER_ISSUE', 'PAYMENT', 'COMPLIANCE', 'TASK'];
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
// Allowed workflow moves, enforced on the server
const TRANSITIONS: Record<string, string[]> = {
  OPEN: ['IN_PROGRESS'],
  IN_PROGRESS: ['AWAITING_APPROVAL'],
  AWAITING_APPROVAL: ['RESOLVED', 'IN_PROGRESS'],
  RESOLVED: ['CLOSED'],
  CLOSED: [],
};

const currentUser = (res: Response): AuthUser => res.locals.user;

// Loads an item and checks permission. Outside your teams = 404 (we don't reveal it exists)
async function loadItem(db: Db, id: number, user: AuthUser, action: Action) {
  const { rows } = await db.query('SELECT * FROM work_items WHERE id = $1', [id]);
  const item = rows[0];
  if (!item || !can(user, 'read', item.team_id)) throw new HttpError(404, 'Item not found');
  if (!can(user, action, item.team_id)) throw new HttpError(403, `You are not allowed to ${action} items in this team`);
  return item;
}

// History row, always written in the SAME transaction as the change
async function logEvent(db: Db, itemId: number, actorId: number, kind: string, from: unknown, to: unknown) {
  await db.query(
    'INSERT INTO activity_events (item_id, actor_id, kind, from_value, to_value) VALUES ($1,$2,$3,$4,$5)',
    [itemId, actorId, kind, from == null ? null : String(from), to == null ? null : String(to)]);
}

// GET /items?view=&status=&priority=&team=&assignee=&q=&cursor=&limit=
itemsRouter.get('/', async (req, res) => {
  const user = currentUser(res);
  const q = req.query as Record<string, string | undefined>;
  const teamIds = Object.keys(user.roles).map(Number);
  const params: unknown[] = [teamIds];
  const where = ['team_id = ANY($1)'];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replaceAll('?', '$' + params.length));
  };

  if (q.view === 'mine') add("assignee_id = ? AND status NOT IN ('RESOLVED','CLOSED')", user.id);
  if (q.view === 'unassigned_urgent') where.push("assignee_id IS NULL AND priority = 'URGENT' AND status NOT IN ('RESOLVED','CLOSED')");
  if (q.view === 'awaiting_approval') {
    add("status = 'AWAITING_APPROVAL' AND team_id = ANY(?)", teamIds.filter(t => can(user, 'approve', t)));
  }
  if (q.status) add('status = ?', q.status);
  if (q.priority) add('priority = ?', q.priority);
  if (q.team) add('team_id = ?', Number(q.team));
  if (q.assignee === 'none') where.push('assignee_id IS NULL');
  else if (q.assignee) add('assignee_id = ?', Number(q.assignee));
  if (q.q) add('(title ILIKE ? OR description ILIKE ?)', `%${q.q}%`);
  if (q.cursor) add('id < ?', Number(q.cursor));

  const limit = Math.min(Number(q.limit) || 20, 100);
  const { rows } = await pool.query(
    `SELECT * FROM work_items WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ${limit + 1}`, params);
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  res.json({ items, nextCursor: hasMore ? items[items.length - 1].id : null });
});

// POST /items  (Idempotency-Key header makes retries safe)
itemsRouter.post('/', async (req, res) => {
  const user = currentUser(res);
  const key = req.header('Idempotency-Key');
  const { title, description = '', type, priority, teamId, dueDate = null } = req.body ?? {};
  if (!title || !TYPES.includes(type) || !PRIORITIES.includes(priority)) {
    throw new HttpError(400, 'title, a valid type and a valid priority are required');
  }
  if (!can(user, 'write', Number(teamId))) throw new HttpError(403, 'You cannot create items in this team');

  const item = await tx(async db => {
    if (key) {
      // Lock on this key so two identical requests at the same time run one after the other
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${user.id}:${key}`]);
      const seen = await db.query('SELECT response FROM idempotency_keys WHERE key = $1 AND user_id = $2', [key, user.id]);
      if (seen.rows[0]) return seen.rows[0].response;
    }
    const { rows } = await db.query(
      `INSERT INTO work_items (title, description, type, priority, team_id, created_by, due_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [title, description, type, priority, Number(teamId), user.id, dueDate]);
    await logEvent(db, rows[0].id, user.id, 'CREATED', null, rows[0].status);
    if (key) {
      await db.query('INSERT INTO idempotency_keys (key, user_id, response) VALUES ($1,$2,$3)', [key, user.id, rows[0]]);
    }
    return rows[0];
  });
  res.status(201).json(item);
});

// GET /items/:id
itemsRouter.get('/:id', async (req, res) => {
  res.json(await loadItem(pool, Number(req.params.id), currentUser(res), 'read'));
});

// PATCH /items/:id  body: { version, title?, description?, priority?, dueDate? }
itemsRouter.patch('/:id', async (req, res) => {
  const user = currentUser(res);
  const id = Number(req.params.id);
  const { version, title, description, priority, dueDate } = req.body ?? {};
  if (!Number.isInteger(version)) throw new HttpError(400, 'version is required');
  if (priority !== undefined && !PRIORITIES.includes(priority)) throw new HttpError(400, 'invalid priority');

  const updated = await tx(async db => {
    const item = await loadItem(db, id, user, 'write');
    // Optimistic locking: only update if nobody changed it since the client loaded it
    const { rows } = await db.query(
      `UPDATE work_items SET
         title = COALESCE($1, title), description = COALESCE($2, description),
         priority = COALESCE($3, priority), due_date = COALESCE($4, due_date),
         version = version + 1, updated_at = now()
       WHERE id = $5 AND version = $6 RETURNING *`,
      [title ?? null, description ?? null, priority ?? null, dueDate ?? null, id, version]);
    if (!rows[0]) throw new HttpError(409, 'This item was changed by someone else. Reload and try again.', { latest: item });
    if (priority && priority !== item.priority) await logEvent(db, id, user.id, 'PRIORITY_CHANGED', item.priority, priority);
    if (title !== undefined || description !== undefined || dueDate !== undefined) await logEvent(db, id, user.id, 'EDITED', null, null);
    return rows[0];
  });
  res.json(updated);
});

// POST /items/:id/claim  (atomic: only one person can win)
itemsRouter.post('/:id/claim', async (req, res) => {
  const user = currentUser(res);
  const id = Number(req.params.id);
  const claimed = await tx(async db => {
    await loadItem(db, id, user, 'write');
    const { rows } = await db.query(
      `UPDATE work_items SET assignee_id = $1, version = version + 1, updated_at = now()
       WHERE id = $2 AND assignee_id IS NULL RETURNING *`, [user.id, id]);
    if (!rows[0]) throw new HttpError(409, 'Someone else has already claimed this item');
    await logEvent(db, id, user.id, 'CLAIMED', null, user.id);
    return rows[0];
  });
  res.json(claimed);
});

// POST /items/:id/transition  body: { to, version }
itemsRouter.post('/:id/transition', async (req, res) => {
  const user = currentUser(res);
  const id = Number(req.params.id);
  const { to, version } = req.body ?? {};
  if (!Number.isInteger(version)) throw new HttpError(400, 'version is required');

  const moved = await tx(async db => {
    const item = await loadItem(db, id, user, 'write');
    if (!TRANSITIONS[item.status]?.includes(to)) {
      throw new HttpError(422, `Cannot move from ${item.status} to ${to}`);
    }
    if (item.status === 'AWAITING_APPROVAL' && to === 'RESOLVED' && !can(user, 'approve', item.team_id)) {
      throw new HttpError(403, 'Only a Lead of this team can approve');
    }
    const { rows } = await db.query(
      `UPDATE work_items SET status = $1, version = version + 1, updated_at = now()
       WHERE id = $2 AND version = $3 RETURNING *`, [to, id, version]);
    if (!rows[0]) throw new HttpError(409, 'This item was changed by someone else. Reload and try again.', { latest: item });
    await logEvent(db, id, user.id, 'STATUS_CHANGED', item.status, to);
    return rows[0];
  });
  res.json(moved);
});

// GET /items/:id/activity
itemsRouter.get('/:id/activity', async (req, res) => {
  const id = Number(req.params.id);
  await loadItem(pool, id, currentUser(res), 'read');
  const { rows } = await pool.query(
    `SELECT e.*, u.name AS actor_name FROM activity_events e JOIN users u ON u.id = e.actor_id
     WHERE e.item_id = $1 ORDER BY e.id`, [id]);
  res.json(rows);
});

// POST /items/:id/comments  body: { body }
itemsRouter.post('/:id/comments', async (req, res) => {
  const user = currentUser(res);
  const id = Number(req.params.id);
  const { body } = req.body ?? {};
  if (!body) throw new HttpError(400, 'body is required');
  const comment = await tx(async db => {
    await loadItem(db, id, user, 'write');
    const { rows } = await db.query(
      'INSERT INTO comments (item_id, author_id, body) VALUES ($1,$2,$3) RETURNING *', [id, user.id, body]);
    await logEvent(db, id, user.id, 'COMMENTED', null, body);
    return rows[0];
  });
  res.status(201).json(comment);
});
