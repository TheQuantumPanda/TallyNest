import { useState } from 'react';
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { Menu, ShieldCheck } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { SessionState } from '../components/auth/SessionState';
import { AccountAvatar } from '../components/AccountAvatar';
import { Sidebar } from '../components/Sidebar';
import { MobileNavigation } from '../components/MobileNavigation';
import { Notice } from '../components/ui/Notice';
import { authErrorMessage } from '../utils/authErrors';

export function AppLayout() {
  const { status, user, reason, restore, logout } = useAuth();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState('');
  if (status === 'loading') return <SessionState />;
  if (status === 'error') return <SessionState error onRetry={restore} />;
  if (status !== 'authenticated')
    return (
      <Navigate
        to={
          /^\/app\/join\/[A-Za-z0-9_-]{43}$/.test(location.pathname)
            ? '/login#join=' + location.pathname.split('/').at(-1)
            : '/login'
        }
        replace
        state={{
          ...(!location.pathname.startsWith('/app/join/')
            ? { from: location.pathname + location.search }
            : {}),
          reason,
        }}
      />
    );

  async function signOut() {
    if (loggingOut) return;
    setLoggingOut(true);
    setError('');
    try {
      await logout();
      setMobileOpen(false);
    } catch (err) {
      setError(authErrorMessage(err, 'logout'));
      setMobileOpen(false);
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <div className="app-layout">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="desktop-sidebar">
        <Sidebar onLogout={signOut} loggingOut={loggingOut} />
      </aside>
      <MobileNavigation
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        onLogout={signOut}
        loggingOut={loggingOut}
      />
      <div className="app-main">
        <header className="app-header">
          <div className="header-heading">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              aria-controls="mobile-navigation"
              aria-haspopup="dialog"
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen(true)}
            >
              <Menu size={22} />
            </button>
            <span>
              Workspace <span className="breadcrumb-slash">/</span>
              <strong>
                {location.pathname === '/app/account'
                  ? 'My account'
                  : location.pathname === '/app/transactions'
                    ? 'Transactions'
                    : location.pathname === '/app/budgets'
                      ? 'Budgets'
                      : location.pathname === '/app/recurring'
                        ? 'Recurring'
                        : location.pathname.startsWith('/app/groups')
                          ? 'Groups'
                          : location.pathname.startsWith('/app/join')
                            ? 'Join group'
                            : 'Overview'}
              </strong>
            </span>
          </div>
          <div className="header-account">
            <span className="session-label">
              <ShieldCheck size={15} aria-hidden="true" /> Signed in
            </span>
            <Link
              to="/app/account"
              className="header-identity"
              aria-label="View my account"
              title={user.email}
            >
              <span className="header-email">{user.email}</span>
              <AccountAvatar name={user.name} />
            </Link>
          </div>
        </header>
        <main id="main-content" tabIndex={-1} className="workspace-main">
          {error && <Notice>{error}</Notice>}
          <Outlet />
        </main>
        <footer className="app-footer">
          <span>TallyNest</span>
          <span>Your money. In perspective.</span>
        </footer>
      </div>
    </div>
  );
}
