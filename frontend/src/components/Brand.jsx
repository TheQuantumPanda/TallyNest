import { Link } from 'react-router-dom';

export function Brand({ compact = false }) {
  return (
    <Link to="/app" className="brand" aria-label="Smart Finance Manager home">
      <svg aria-hidden="true" viewBox="0 0 48 48" className="brand-mark">
        <path
          d="M9 30V18L24 9l15 9v12l-15 9z"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        />
        <path d="m16 27 8-13 8 13-8 7z" fill="currentColor" />
      </svg>
      <span>Smart Finance{!compact && <small>YOUR PERSONAL WORKSPACE</small>}</span>
    </Link>
  );
}
