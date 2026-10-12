import { LoaderCircle } from 'lucide-react';

export function Button({
  children,
  loading = false,
  disabled = false,
  variant = 'primary',
  className = '',
  ...props
}) {
  return (
    <button
      className={`button button-${variant} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <LoaderCircle className="spin" size={17} aria-hidden="true" />}
      {children}
    </button>
  );
}
