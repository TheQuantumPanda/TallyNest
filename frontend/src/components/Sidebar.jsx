import { NavLink } from 'react-router-dom';
import {
  ArrowUpRight,
  LayoutGrid,
  LockKeyhole,
  LogOut,
  ReceiptText,
  Users,
  UserRound,
  X,
} from 'lucide-react';
import { Brand } from './Brand';
import { AccountAvatar } from './AccountAvatar';
import { Button } from './ui/Button';
import { useAuth } from '../hooks/useAuth';

export function Sidebar({ onClose, onLogout, loggingOut }) {
  const { user } = useAuth();
  return (
    <div className="sidebar-content">
      <div className="sidebar-brand">
        <Brand compact />
        {onClose && (
          <button className="icon-button" onClick={onClose} aria-label="Close navigation">
            <X size={21} />
          </button>
        )}
      </div>
      <span className="workspace-label">PERSONAL WORKSPACE</span>
      <nav aria-label="Main navigation" className="nav-list">
        <NavLink to="/app" end onClick={onClose}>
          <LayoutGrid size={19} aria-hidden="true" />
          Overview
          <span className="nav-indicator" />
        </NavLink>
        <NavLink to="/app/account" onClick={onClose}>
          <UserRound size={19} aria-hidden="true" />
          My account
          <span className="nav-indicator" />
        </NavLink>
      </nav>
      <div className="planned-navigation">
        <span className="workspace-label">ON THE HORIZON</span>
        <div>
          <ReceiptText size={18} aria-hidden="true" />
          <span>Expense tracking</span>
          <LockKeyhole size={12} aria-hidden="true" />
        </div>
        <div>
          <Users size={18} aria-hidden="true" />
          <span>Shared finances</span>
          <LockKeyhole size={12} aria-hidden="true" />
        </div>
        <p>Planned for a future release.</p>
      </div>
      <div className="sidebar-bottom">
        <div className="sidebar-note">
          <ArrowUpRight size={19} aria-hidden="true" />
          <p>
            A little more clarity.<small>One step at a time.</small>
          </p>
        </div>
        <div className="sidebar-account">
          <AccountAvatar name={user.name} />
          <span>
            {user.name}
            <small>{user.email}</small>
          </span>
        </div>
        <Button variant="ghost" onClick={onLogout} loading={loggingOut} className="logout-button">
          <LogOut size={17} aria-hidden="true" />
          {loggingOut ? 'Signing out…' : 'Sign out'}
        </Button>
      </div>
    </div>
  );
}
