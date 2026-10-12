import { CircleAlert } from 'lucide-react';
export function Notice({ children, tone = 'error' }) {
  return (
    <div className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <CircleAlert size={18} aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}
