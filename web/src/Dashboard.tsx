import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError, Item, label, Page, PRIORITIES, STATUSES, Team } from './api';
import { useQuery } from './useQuery';

const VIEWS = [
  { id: 'mine', name: 'Assigned to me' },
  { id: 'unassigned_urgent', name: 'Unassigned urgent' },
  { id: 'awaiting_approval', name: 'Awaiting my approval' },
  { id: 'all', name: 'All items' },
];

type Props = {
  teams: Team[];
  userName: (id: number | null) => string | null;
  reloadSignal: number;
  canCreate: boolean;
  onOpen: (id: number) => void;
  onNew: () => void;
};

export function Dashboard({ teams, userName, reloadSignal, canCreate, onOpen, onNew }: Props) {
  const [view, setView] = useState('mine');
  const [filters, setFilters] = useState({ q: '', status: '', priority: '', team: '' });
  const [searchText, setSearchText] = useState('');

  // All filtering happens on the server; the browser only ever holds one page at a time
  const params = new URLSearchParams({ limit: '20' });
  if (view !== 'all') params.set('view', view);
  for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
  const query = params.toString();

  const firstPage = useQuery(`items?${query}&r=${reloadSignal}`, () => api<Page<Item>>(`/items?${query}`), 15000);

  // Extra pages loaded with "Load more"
  const [more, setMore] = useState<Item[]>([]);
  const [moreCursor, setMoreCursor] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  useEffect(() => { setMore([]); setMoreCursor(null); setMoreError(null); }, [query, reloadSignal]);

  const firstItems = firstPage.data?.items ?? [];
  const seen = new Set(firstItems.map(i => i.id));
  const items = [...firstItems, ...more.filter(i => !seen.has(i.id))];
  const nextCursor = more.length > 0 ? moreCursor : firstPage.data?.nextCursor ?? null;

  async function loadMore() {
    if (nextCursor == null) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await api<Page<Item>>(`/items?${query}&cursor=${nextCursor}`);
      setMore(prev => [...prev, ...page.items]);
      setMoreCursor(page.nextCursor);
    } catch (e) {
      setMoreError((e as ApiError).message);
    } finally {
      setLoadingMore(false);
    }
  }

  function search(e: FormEvent) {
    e.preventDefault();
    setFilters(f => ({ ...f, q: searchText.trim() }));
  }

  const teamName = (id: number) => teams.find(t => t.id === id)?.name ?? `Team ${id}`;

  return (
    <section>
      <div className="row space-between">
        <nav className="tabs">
          {VIEWS.map(v => (
            <button key={v.id} className={v.id === view ? 'tab active' : 'tab'} onClick={() => setView(v.id)}>
              {v.name}
            </button>
          ))}
        </nav>
        {canCreate && <button className="primary" onClick={onNew}>+ New item</button>}
      </div>

      <div className="filters">
        <form onSubmit={search} className="search">
          <input placeholder="Search title or description" value={searchText} onChange={e => setSearchText(e.target.value)} />
          <button>Search</button>
        </form>
        <select value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
          <option value="">Any status</option>
          {STATUSES.map(s => <option key={s} value={s}>{label(s)}</option>)}
        </select>
        <select value={filters.priority} onChange={e => setFilters(f => ({ ...f, priority: e.target.value }))}>
          <option value="">Any priority</option>
          {PRIORITIES.map(p => <option key={p} value={p}>{label(p)}</option>)}
        </select>
        <select value={filters.team} onChange={e => setFilters(f => ({ ...f, team: e.target.value }))}>
          <option value="">All my teams</option>
          {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <button className="ghost" onClick={() => { setFilters({ q: '', status: '', priority: '', team: '' }); setSearchText(''); }}>
          Clear
        </button>
      </div>

      {firstPage.error && <div className="banner error">{firstPage.error.message}</div>}

      <div className="card table-card">
        <table>
          <thead>
            <tr>
              <th>#</th><th>Title</th><th>Type</th><th>Priority</th><th>Status</th><th>Team</th><th>Assignee</th><th>Due</th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => (
              <tr key={item.id} onClick={() => onOpen(item.id)} className="clickable">
                <td className="muted">{item.id}</td>
                <td className="title-cell">{item.title}</td>
                <td>{label(item.type)}</td>
                <td><span className={`badge p-${item.priority.toLowerCase()}`}>{label(item.priority)}</span></td>
                <td><span className={`badge s-${item.status.toLowerCase()}`}>{label(item.status)}</span></td>
                <td>{teamName(item.team_id)}</td>
                <td>{userName(item.assignee_id) ?? <span className="muted">Unassigned</span>}</td>
                <td>{item.due_date ? item.due_date.slice(0, 10) : <span className="muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {firstPage.loading && items.length === 0 && <p className="empty">Loading…</p>}
        {!firstPage.loading && items.length === 0 && !firstPage.error && <p className="empty">Nothing here.</p>}
      </div>

      <div className="row center">
        {moreError && <span className="error-text">{moreError}</span>}
        {nextCursor != null && (
          <button onClick={loadMore} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Load more'}</button>
        )}
        <span className="muted small">Showing {items.length}{nextCursor != null ? '+' : ''} items</span>
      </div>
    </section>
  );
}
