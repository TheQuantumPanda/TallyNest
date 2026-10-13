import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

export function Dialog({ title, children, onClose, busy = false }) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const element = ref.current;
    const trigger = document.activeElement;
    element.showModal();
    element.querySelector('input:not([disabled]), select:not([disabled])')?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      element.close();
      document.body.style.overflow = previous;
      const target = trigger?.isConnected
        ? trigger
        : document.querySelector('.transaction-page-heading .button') ||
          document.querySelector('#main-content');
      target?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="transaction-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(event) => {
        const box = event.currentTarget.getBoundingClientRect();
        if (
          event.target === event.currentTarget &&
          !busy &&
          (event.clientX < box.left ||
            event.clientX > box.right ||
            event.clientY < box.top ||
            event.clientY > box.bottom)
        )
          onClose();
      }}
    >
      <header className="dialog-heading">
        <div>
          <span className="eyebrow">TALLYNEST · PERSONAL</span>
          <h2 id={titleId}>{title}</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Close dialog"
          disabled={busy}
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
