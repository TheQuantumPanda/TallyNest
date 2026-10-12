import { LoaderCircle, WifiOff } from 'lucide-react';
import { Brand } from '../Brand';
import { Button } from '../ui/Button';

export function SessionState({ error = false, onRetry }) {
  return (
    <div className="session-screen">
      <Brand />
      <div className="session-card" role="status" aria-live="polite">
        {error ? (
          <WifiOff size={28} aria-hidden="true" />
        ) : (
          <LoaderCircle className="spin" size={28} aria-hidden="true" />
        )}
        <h1>{error ? 'Let’s reconnect.' : 'Opening your workspace…'}</h1>
        <p>
          {error
            ? 'We couldn’t check your session. Check your connection and try again.'
            : 'Checking your session securely.'}
        </p>
        {error && <Button onClick={() => onRetry()}>Try again</Button>}
      </div>
    </div>
  );
}
