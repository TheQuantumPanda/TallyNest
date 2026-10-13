import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { ArrowUpRight, ShieldCheck } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { Brand } from '../components/Brand';
import { SessionState } from '../components/auth/SessionState';
import { PageTransition } from '../components/ui/PageTransition';

export function AuthLayout() {
  const { status, restore } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <SessionState />;
  if (status === 'error') return <SessionState error onRetry={restore} />;
  if (status === 'authenticated') {
    const from = location.state?.from;
    return (
      <Navigate
        to={typeof from === 'string' && /^\/app(?:\/|\?|$)/.test(from) ? from : '/app'}
        replace
      />
    );
  }
  return (
    <div className="auth-layout">
      <section className="auth-main">
        <Brand />
        <PageTransition key={location.pathname} className="auth-form-container">
          <Outlet />
        </PageTransition>
        <footer className="auth-footer">
          <span>TallyNest</span>
          <span>Clarity starts here.</span>
        </footer>
      </section>
      <aside className="auth-story" aria-label="About TallyNest">
        <div className="story-label">
          <span className="eyebrow">A DIFFERENT KIND OF WORKSPACE</span>
          <ArrowUpRight size={23} aria-hidden="true" />
        </div>
        <h2>
          Less noise.
          <br />
          More <span>perspective.</span>
        </h2>
        <p>
          A thoughtful place for your financial life.
          <br />
          Built around what matters: you.
        </p>
        <div className="perspective-art" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="orbit orbit-three" />
          <div className="art-core">
            <img src="/brand-mark.svg" alt="" />
          </div>
          <span className="art-spark spark-one" />
          <span className="art-spark spark-two" />
          <div className="art-tag tag-top">
            <span className="status-dot" /> YOUR SPACE
          </div>
          <div className="art-tag tag-bottom">
            A clearer way forward <ArrowUpRight size={17} />
          </div>
        </div>
        <div className="story-bottom">
          <ShieldCheck size={20} aria-hidden="true" />
          <span>
            Your account. Your pace.<small>A secure foundation for what comes next.</small>
          </span>
          <span className="story-index">01 / 01</span>
        </div>
      </aside>
    </div>
  );
}
