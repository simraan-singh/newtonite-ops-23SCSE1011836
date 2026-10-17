// Everything the UI knows about talking to the server lives in this file.

export type Role = 'VIEWER' | 'MEMBER' | 'LEAD' | 'ADMIN';
export type Status = 'OPEN' | 'IN_PROGRESS' | 'AWAITING_APPROVAL' | 'RESOLVED' | 'CLOSED';

export type Item = {
  id: number;
  title: string;
  description: string;
  type: string;
  priority: string;
  status: Status;
  team_id: number;
  assignee_id: number | null;
  created_by: number;
  due_date: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};

export type ActivityEvent = {
  id: string;
  item_id: number;
  actor_id: number;
  actor_name: string;
  kind: string;
  from_value: string | null;
  to_value: string | null;
  created_at: string;
};

export type Team = { id: number; name: string; role: Role };
export type User = { id: number; name: string };
export type Session = { token: string; user: User };
export type Page<T> = { items: T[]; nextCursor: number | null };

export const TYPES = ['INCIDENT', 'CUSTOMER_ISSUE', 'PAYMENT', 'COMPLIANCE', 'TASK'];
export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
export const STATUSES: Status[] = ['OPEN', 'IN_PROGRESS', 'AWAITING_APPROVAL', 'RESOLVED', 'CLOSED'];

// Copy of the server's workflow, used ONLY to decide which buttons to show.
// The server checks every move again and is the real source of truth.
export const TRANSITIONS: Record<Status, Status[]> = {
  OPEN: ['IN_PROGRESS'],
  IN_PROGRESS: ['AWAITING_APPROVAL'],
  AWAITING_APPROVAL: ['RESOLVED', 'IN_PROGRESS'],
  RESOLVED: ['CLOSED'],
  CLOSED: [],
};

const RANK: Record<Role, number> = { VIEWER: 1, MEMBER: 2, LEAD: 3, ADMIN: 4 };
export const canWrite = (role?: Role) => !!role && RANK[role] >= 2;
export const canApprove = (role?: Role) => !!role && RANK[role] >= 3;

export const label = (value: string) =>
  value.toLowerCase().split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');

export class ApiError extends Error {
  constructor(public status: number, message: string, public body: any) {
    super(message);
  }
}

// ---- session (kept in localStorage so a page refresh keeps you logged in) ----
const SESSION_KEY = 'ops-session';

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveSession(session: Session | null) {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // storage blocked: the app still works until the tab is closed
  }
  token = session?.token ?? null;
}

let token: string | null = loadSession()?.token ?? null;
let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

// ---- one function for every request ----
export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch('/api' + path, {
      method: options.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Is it running?', null);
  }
  const data = await res.json().catch(() => null);
  if (res.status === 401 && token) onUnauthorized(); // token expired → back to login
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`, data);
  return data as T;
}

// A fresh random key per "Create" form, so a double-click or retry never creates two items
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
