import { Link } from 'react-router-dom';

export function Brand({ compact = false }) {
  return (
    <Link to="/app" className="brand" aria-label="TallyNest home">
      <img src="/brand-mark.svg" alt="" aria-hidden="true" className="brand-mark" />
      <span>TallyNest{!compact && <small>Your money. In perspective.</small>}</span>
    </Link>
  );
}
