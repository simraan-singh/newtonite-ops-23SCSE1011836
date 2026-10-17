import { useEffect, useState } from 'react';
import { api, canWrite, loadSession, saveSession, setUnauthorizedHandler, Session, Team, User } from './api';
import { useQuery } from './useQuery';
import { Login } from './Login';
import { Dashboard } from './Dashboard';
import { ItemDetail } from './ItemDetail';
import { CreateItem } from './CreateItem';

export function App() {
  const [session, setSession] = useState<Session | null>(loadSession);

  const logout = () => {
    saveSession(null);
    setSession(null);
  };

  useEffect(() => setUnauthorizedHandler(logout), []);

  if (!session) {
    return (
      <Login
        onLogin={s => {
          saveSession(s);
          setSession(s);
        }}
      />
    );
  }
  return <Main session={session} onLogout={logout} />;
}

type Screen = { page: 'list' } | { page: 'item'; id: number } | { page: 'new' };

function Main({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [screen, setScreen] = useState<Screen>({ page: 'list' });
  const [listVersion, setListVersion] = useState(0); // bump to make the list reload
  const teams = useQuery('teams', () => api<Team[]>('/teams'));
  const users = useQuery('users', () => api<User[]>('/users'));

  const teamList = teams.data ?? [];
  const userName = (id: number | null) =>
    id == null ? null : users.data?.find(u => u.id === id)?.name ?? `User #${id}`;

  const backToList = () => {
    setListVersion(v => v + 1);
    setScreen({ page: 'list' });
  };

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={backToList}>Ops Desk</button>
        <div className="topbar-right">
          <span className="muted">
            {session.user.name}
            {teamList.length > 0 && ' · ' + teamList.map(t => `${t.name} (${t.role.toLowerCase()})`).join(', ')}
          </span>
          <button className="ghost" onClick={onLogout}>Log out</button>
        </div>
      </header>

      <main className="content">
        {teams.error && <div className="banner error">{teams.error.message}</div>}

        {/* The list stays mounted (just hidden) so filters survive opening an item */}
        <div hidden={screen.page !== 'list'}>
          <Dashboard
            teams={teamList}
            userName={userName}
            reloadSignal={listVersion}
            canCreate={teamList.some(t => canWrite(t.role))}
            onOpen={id => setScreen({ page: 'item', id })}
            onNew={() => setScreen({ page: 'new' })}
          />
        </div>

        {screen.page === 'item' && (
          <ItemDetail
            id={screen.id}
            me={session.user}
            teams={teamList}
            userName={userName}
            onBack={backToList}
          />
        )}

        {screen.page === 'new' && (
          <CreateItem
            teams={teamList}
            onCancel={() => setScreen({ page: 'list' })}
            onCreated={item => {
              setListVersion(v => v + 1);
              setScreen({ page: 'item', id: item.id });
            }}
          />
        )}
      </main>
    </div>
  );
}
