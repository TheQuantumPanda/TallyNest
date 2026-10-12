import { Link } from 'react-router-dom';
import { ArrowLeft, Compass } from 'lucide-react';
import { Brand } from '../components/Brand';
import { useAuth } from '../hooks/useAuth';
export function NotFoundPage() {
  const { status } = useAuth();
  return (
    <div className="session-screen">
      <Brand />
      <main className="not-found">
        <Compass size={42} aria-hidden="true" />
        <span className="eyebrow">404 · OFF THE MAP</span>
        <h1>A little out of the way.</h1>
        <p>This page doesn’t exist. Let’s get you back to familiar ground.</p>
        <Link className="button button-primary" to={status === 'authenticated' ? '/app' : '/login'}>
          <ArrowLeft size={18} aria-hidden="true" />
          Back to your workspace
        </Link>
      </main>
    </div>
  );
}
