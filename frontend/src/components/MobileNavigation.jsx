import { useEffect, useRef } from 'react';
import { Sidebar } from './Sidebar';

export function MobileNavigation({ open, onClose, onLogout, loggingOut }) {
  const dialog = useRef(null);
  useEffect(() => {
    const element = dialog.current;
    if (open) element.showModal();
    else if (element.open) element.close();
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);
  return (
    <dialog
      id="mobile-navigation"
      ref={dialog}
      className="mobile-navigation"
      aria-label="Mobile navigation"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <Sidebar onClose={onClose} onLogout={onLogout} loggingOut={loggingOut} />
    </dialog>
  );
}
