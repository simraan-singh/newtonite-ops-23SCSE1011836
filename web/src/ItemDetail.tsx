import { FormEvent, useState } from 'react';
import {
  ActivityEvent, api, ApiError, canApprove, canWrite, Item, label, PRIORITIES, Status, Team, TRANSITIONS, User,
} from './api';
import { useQuery } from './useQuery';

type Props = {
  id: number;
  me: User;
  teams: Team[];
  userName: (id: number | null) => string | null;
  onBack: () => void;
};

type Banner = { kind: 'error' | 'conflict' | 'ok'; text: string } | null;

const BUTTON_TEXT: Record<string, string> = {
  'OPEN>IN_PROGRESS': 'Start work',
  'IN_PROGRESS>AWAITING_APPROVAL': 'Request approval',
  'AWAITING_APPROVAL>RESOLVED': 'Approve & resolve',
  'AWAITING_APPROVAL>IN_PROGRESS': 'Send back',
  'RESOLVED>CLOSED': 'Close',
};

export function ItemDetail({ id, me, teams, userName, onBack }: Props) {
  // Polling every 10s keeps the page fresh without websockets
  const item = useQuery(`item-${id}`, () => api<Item>(`/items/${id}`), 10000);
  const activity = useQuery(`activity-${id}`, () => api<ActivityEvent[]>(`/items/${id}/activity`), 10000);
  const [banner, setBanner] = useState<Banner>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<null | { baseVersion: number; title: string; description: string; priority: string; dueDate: string }>(null);
  const [comment, setComment] = useState('');

  if (item.error && !item.data) {
    return (
      <section>
        <button className="ghost" onClick={onBack}>← Back</button>
        <div className="banner error">{item.error.status === 404 ? 'Item not found, or you do not have access to it.' : item.error.message}</div>
      </section>
    );
  }
  if (!item.data) return <p className="empty">Loading…</p>;

  const current = item.data;
  const team = teams.find(t => t.id === current.team_id);
  const writer = canWrite(team?.role);
  const approver = canApprove(team?.role);

  // Optimistic update: change the screen first, then ask the server.
  // If the server says no, put the old data back and show the server's reason.
  async function run(optimistic: Partial<Item>, request: () => Promise<Item>, success: string) {
    const previous = current;
    setBusy(true);
    setBanner(null);
    item.mutate({ ...previous, ...optimistic });
    try {
      item.mutate(await request());
      setBanner({ kind: 'ok', text: success });
      return true;
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 409 && err.body?.latest) {
        item.mutate(err.body.latest);
        setBanner({ kind: 'conflict', text: 'Someone else changed this item while you were looking at it. The latest version is now shown — check it and try again.' });
      } else {
        item.mutate(previous);
        setBanner({ kind: 'error', text: err.message });
        if (err.status === 409) item.refetch();
      }
      return false;
    } finally {
      setBusy(false);
      activity.refetch();
    }
  }

  const claim = () =>
    run({ assignee_id: me.id }, () => api<Item>(`/items/${id}/claim`, { method: 'POST' }), 'You claimed this item.');

  const transition = (to: Status) =>
    run(
      { status: to },
      () => api<Item>(`/items/${id}/transition`, { method: 'POST', body: { to, version: current.version } }),
      `Moved to ${label(to)}.`,
    );

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const changes: Record<string, unknown> = {};
    if (editing.title !== current.title) changes.title = editing.title;
    if (editing.description !== current.description) changes.description = editing.description;
    if (editing.priority !== current.priority) changes.priority = editing.priority;
    const due = current.due_date ? current.due_date.slice(0, 10) : '';
    if (editing.dueDate && editing.dueDate !== due) changes.dueDate = editing.dueDate;
    if (Object.keys(changes).length === 0) { setEditing(null); return; }

    // We send the version the user STARTED editing from. If anyone saved in between,
    // the server rejects it with 409 instead of silently overwriting their change.
    const ok = await run(
      { ...changes, due_date: (changes.dueDate as string) ?? current.due_date } as Partial<Item>,
      () => api<Item>(`/items/${id}`, { method: 'PATCH', body: { version: editing.baseVersion, ...changes } }),
      'Changes saved.',
    );
    if (ok) setEditing(null);
  }

  async function addComment(e: FormEvent) {
    e.preventDefault();
    if (!comment.trim()) return;
    setBusy(true);
    try {
      await api(`/items/${id}/comments`, { method: 'POST', body: { body: comment.trim() } });
      setComment('');
      activity.refetch();
    } catch (err) {
      setBanner({ kind: 'error', text: (err as ApiError).message });
    } finally {
      setBusy(false);
    }
  }

  const moves = TRANSITIONS[current.status].filter(
    to => !(current.status === 'AWAITING_APPROVAL' && to === 'RESOLVED' && !approver),
  );

  return (
    <section className="detail">
      <button className="ghost" onClick={onBack}>← Back to list</button>

      {banner && (
        <div className={`banner ${banner.kind}`}>
          {banner.text}
          <button className="link" onClick={() => setBanner(null)}>Dismiss</button>
        </div>
      )}

      <div className="detail-grid">
        <div className="card">
          <div className="row space-between">
            <h2>#{current.id} {current.title}</h2>
            <span className={`badge s-${current.status.toLowerCase()}`}>{label(current.status)}</span>
          </div>

          {editing ? (
            <form className="edit-form" onSubmit={saveEdit}>
              <label>Title<input value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })} required /></label>
              <label>Description<textarea rows={4} value={editing.description} onChange={e => setEditing({ ...editing, description: e.target.value })} /></label>
              <div className="row">
                <label>Priority
                  <select value={editing.priority} onChange={e => setEditing({ ...editing, priority: e.target.value })}>
                    {PRIORITIES.map(p => <option key={p} value={p}>{label(p)}</option>)}
                  </select>
                </label>
                <label>Due date<input type="date" value={editing.dueDate} onChange={e => setEditing({ ...editing, dueDate: e.target.value })} /></label>
              </div>
              <div className="row">
                <button className="primary" disabled={busy}>Save</button>
                <button type="button" className="ghost" onClick={() => setEditing(null)}>Cancel</button>
              </div>
            </form>
          ) : (
            <p className="description">{current.description || <span className="muted">No description.</span>}</p>
          )}

          <dl className="fields">
            <dt>Type</dt><dd>{label(current.type)}</dd>
            <dt>Priority</dt><dd><span className={`badge p-${current.priority.toLowerCase()}`}>{label(current.priority)}</span></dd>
            <dt>Team</dt><dd>{team?.name ?? current.team_id}</dd>
            <dt>Assignee</dt><dd>{userName(current.assignee_id) ?? <span className="muted">Unassigned</span>}</dd>
            <dt>Created by</dt><dd>{userName(current.created_by)}</dd>
            <dt>Due</dt><dd>{current.due_date ? current.due_date.slice(0, 10) : '—'}</dd>
            <dt>Updated</dt><dd>{new Date(current.updated_at).toLocaleString()}</dd>
            <dt>Version</dt><dd>{current.version}</dd>
          </dl>

          {writer ? (
            <div className="actions">
              {current.assignee_id == null && <button className="primary" disabled={busy} onClick={claim}>Claim</button>}
              {moves.map(to => (
                <button key={to} disabled={busy} onClick={() => transition(to)}>
                  {BUTTON_TEXT[`${current.status}>${to}`] ?? label(to)}
                </button>
              ))}
              {!editing && (
                <button
                  className="ghost"
                  disabled={busy}
                  onClick={() => setEditing({
                    baseVersion: current.version,
                    title: current.title,
                    description: current.description,
                    priority: current.priority,
                    dueDate: current.due_date ? current.due_date.slice(0, 10) : '',
                  })}
                >
                  Edit
                </button>
              )}
              {current.status === 'AWAITING_APPROVAL' && !approver && (
                <span className="muted small">Waiting for a Lead of this team to approve.</span>
              )}
            </div>
          ) : (
            <p className="muted small">You have view-only access in this team.</p>
          )}
        </div>

        <div className="card">
          <h3>Activity</h3>
          {writer && (
            <form className="comment-form" onSubmit={addComment}>
              <textarea rows={2} placeholder="Add a comment" value={comment} onChange={e => setComment(e.target.value)} />
              <button disabled={busy || !comment.trim()}>Comment</button>
            </form>
          )}
          <ol className="timeline">
            {(activity.data ?? []).slice().reverse().map(ev => (
              <li key={ev.id}>
                <div><strong>{ev.actor_name}</strong> {describe(ev, userName)}</div>
                <div className="muted small">{new Date(ev.created_at).toLocaleString()}</div>
              </li>
            ))}
            {activity.data?.length === 0 && <li className="muted">No activity yet.</li>}
          </ol>
        </div>
      </div>
    </section>
  );
}

function describe(ev: ActivityEvent, userName: (id: number | null) => string | null) {
  switch (ev.kind) {
    case 'CREATED': return 'created the item';
    case 'CLAIMED': return 'claimed the item';
    case 'ASSIGNED': return `assigned it to ${userName(Number(ev.to_value))}`;
    case 'STATUS_CHANGED': return `moved it from ${label(ev.from_value ?? '')} to ${label(ev.to_value ?? '')}`;
    case 'PRIORITY_CHANGED': return `changed priority from ${label(ev.from_value ?? '')} to ${label(ev.to_value ?? '')}`;
    case 'EDITED': return 'edited the details';
    case 'COMMENTED': return <>commented: <q>{ev.to_value}</q></>;
    default: return ev.kind.toLowerCase();
  }
}
