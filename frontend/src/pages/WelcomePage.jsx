import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CircleDashed,
  Layers3,
  LockKeyhole,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { PageTransition } from '../components/ui/PageTransition';

const roadmap = [
  {
    number: '01',
    title: 'A secure place to begin',
    description: 'Your account and personal workspace are ready.',
    active: true,
  },
  {
    number: '02',
    title: 'Bring your finances together',
    description: 'Your income and expenses, organized in a personal ledger.',
    active: true,
  },
  {
    number: '03',
    title: 'Find your perspective',
    description: 'Insights and shared finances will follow.',
  },
];

export function WelcomePage() {
  const { user } = useAuth();
  const firstName = user.name.trim().split(/\s+/)[0];
  return (
    <PageTransition className="welcome-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">A CLEARER PLACE TO BEGIN</span>
          <h1>
            Make yourself at home, <span>{firstName}.</span>
          </h1>
          <p>A little space to get organized. A fresh perspective on what’s next.</p>
        </div>
        <span className="workspace-pill">
          <span className="status-dot" /> YOUR WORKSPACE
        </span>
      </div>
      <div className="welcome-grid">
        <section className="welcome-hero surface">
          <div className="hero-topline">
            <span className="hero-icon">
              <Layers3 size={23} aria-hidden="true" />
            </span>
            <span className="small-label">THE FOUNDATION IS READY</span>
          </div>
          <h2>
            Your next chapter
            <br />
            starts with <em>clarity.</em>
          </h2>
          <p>
            Your account is set up. Start recording the income and expenses that shape your day.
          </p>
          <Link className="text-link" to="/app/transactions">
            Open your transactions
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
          <div className="hero-art" aria-hidden="true">
            <span />
            <span />
            <span />
            <div>
              <Sparkles size={28} />
            </div>
          </div>
          <div className="hero-bottom">
            <span className="status-dot" /> Account ready
            <span className="hero-line" />A thoughtful starting point
          </div>
        </section>
        <section className="account-summary surface">
          <span className="section-label">
            YOUR ACCOUNT
            <ArrowUpRight size={18} aria-hidden="true" />
          </span>
          <div className="summary-monogram" aria-hidden="true">
            {[...firstName][0]?.toUpperCase()}
          </div>
          <h2>{user.name}</h2>
          <p>{user.email}</p>
          <div className="summary-state">
            <Check size={16} aria-hidden="true" />
            <span>Account created</span>
          </div>
          <Link className="subtle-link" to="/app/account">
            View account details <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </section>
      </div>
      <section className="roadmap-section">
        <div className="section-heading">
          <h2>A workspace taking shape</h2>
          <span>WHAT’S HERE · WHAT’S NEXT</span>
        </div>
        <div className="roadmap-grid">
          {roadmap.map((item) => (
            <article
              className={`roadmap-card ${item.active ? 'roadmap-active' : ''}`}
              key={item.number}
            >
              <div className="roadmap-top">
                <span>{item.number}</span>
                {item.active ? (
                  <Check size={19} aria-hidden="true" />
                ) : (
                  <CircleDashed size={19} aria-hidden="true" />
                )}
              </div>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
              <span className="roadmap-status">{item.active ? 'AVAILABLE NOW' : 'PLANNED'}</span>
            </article>
          ))}
        </div>
      </section>
      <div className="workspace-note">
        <LockKeyhole size={16} aria-hidden="true" />
        <p>Your personal ledger is ready. Insights and shared finances are planned for later.</p>
      </div>
    </PageTransition>
  );
}
