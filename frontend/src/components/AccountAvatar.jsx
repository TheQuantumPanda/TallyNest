export function AccountAvatar({ name, className = '' }) {
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => [...word][0])
      .join('')
      .toUpperCase() || 'U';
  return (
    <span aria-hidden="true" className={`account-avatar ${className}`}>
      {initials}
    </span>
  );
}
