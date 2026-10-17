import { FormEvent, useState } from 'react';
import { api, ApiError, Session } from './api';

const DEMO_USERS = [
  ['pay.lead@ops.test', 'Payments Lead'],
  ['pay.member@ops.test', 'Payments Member'],
  ['pay.viewer@ops.test', 'Payments Viewer'],
  ['sup.member@ops.test', 'Support Member'],
  ['admin@ops.test', 'Admin'],
];

export function Login({ onLogin }: { onLogin: (s: Session) => void }) {
  const [email, setEmail] = useState('pay.lead@ops.test');
  const [password, setPassword] = useState('password123');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onLogin(await api<Session>('/auth/login', { method: 'POST', body: { email, password } }));
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <form className="card login-card" onSubmit={submit}>
        <h1>Ops Desk</h1>
        <p className="muted">Sign in to manage operational work items.</p>
        {error && <div className="banner error">{error}</div>}
        <label>
          Email
          <input value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
        </label>
        <button className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>

        <div className="demo-users">
          <span className="muted small">Demo users (password: password123)</span>
          <div className="chips">
            {DEMO_USERS.map(([mail, name]) => (
              <button type="button" key={mail} className="chip" onClick={() => { setEmail(mail); setPassword('password123'); }}>
                {name}
              </button>
            ))}
          </div>
        </div>
      </form>
    </div>
  );
}
