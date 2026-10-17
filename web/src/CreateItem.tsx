import { FormEvent, useRef, useState } from 'react';
import { api, ApiError, canWrite, Item, label, newIdempotencyKey, PRIORITIES, Team, TYPES } from './api';

type Props = { teams: Team[]; onCreated: (item: Item) => void; onCancel: () => void };

export function CreateItem({ teams, onCreated, onCancel }: Props) {
  const writable = teams.filter(t => canWrite(t.role));
  const [form, setForm] = useState({
    title: '', description: '', type: 'TASK', priority: 'MEDIUM', teamId: writable[0]?.id ?? 0, dueDate: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key for this form. If the request is retried or double-submitted,
  // the server sees the same key and returns the first result instead of creating a duplicate.
  const idempotencyKey = useRef(newIdempotencyKey());

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const item = await api<Item>('/items', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey.current },
        body: { ...form, dueDate: form.dueDate || null },
      });
      onCreated(item);
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <button className="ghost" onClick={onCancel}>← Back to list</button>
      <form className="card edit-form narrow" onSubmit={submit}>
        <h2>New work item</h2>
        {error && <div className="banner error">{error}</div>}
        <label>Title<input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required /></label>
        <label>Description<textarea rows={4} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></label>
        <div className="row">
          <label>Type
            <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
              {TYPES.map(t => <option key={t} value={t}>{label(t)}</option>)}
            </select>
          </label>
          <label>Priority
            <select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
              {PRIORITIES.map(p => <option key={p} value={p}>{label(p)}</option>)}
            </select>
          </label>
        </div>
        <div className="row">
          <label>Team
            <select value={form.teamId} onChange={e => setForm({ ...form, teamId: Number(e.target.value) })}>
              {writable.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label>Due date<input type="date" value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })} /></label>
        </div>
        <div className="row">
          <button className="primary" disabled={busy}>{busy ? 'Creating…' : 'Create item'}</button>
          <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </section>
  );
}
