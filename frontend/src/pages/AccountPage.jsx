import { ShieldCheck, UserRound } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { AccountAvatar } from '../components/AccountAvatar';
import { PageTransition } from '../components/ui/PageTransition';

export function AccountPage() {
  const { user } = useAuth();
  const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(
    new Date(user.createdAt),
  );
  return (
    <PageTransition className="account-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">THE PERSON BEHIND THE WORKSPACE</span>
          <h1>Your account.</h1>
          <p>A few details that make this space yours.</p>
        </div>
        <UserRound size={28} aria-hidden="true" />
      </div>
      <section className="profile-card surface">
        <div className="profile-intro">
          <AccountAvatar name={user.name} className="profile-avatar" />
          <div>
            <h2>{user.name}</h2>
            <p>Personal workspace</p>
          </div>
        </div>
        <dl className="profile-details">
          <div>
            <dt>Full name</dt>
            <dd>{user.name}</dd>
          </div>
          <div>
            <dt>Email address</dt>
            <dd>{user.email}</dd>
          </div>
          <div>
            <dt>Member since</dt>
            <dd>{date}</dd>
          </div>
        </dl>
        <div className="profile-security">
          <ShieldCheck size={20} aria-hidden="true" />
          <div>
            <h3>A secure foundation</h3>
            <p>
              You’re signed in to your personal workspace. Sign out when you’re using a shared
              device.
            </p>
          </div>
        </div>
      </section>
      <p className="account-footnote">
        Profile editing and additional account settings are planned for a future release.
      </p>
    </PageTransition>
  );
}
