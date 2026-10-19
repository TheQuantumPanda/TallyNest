import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Dialog } from '../components/ui/Dialog';

describe('shared dialog', () => {
  it('portals outside transformed layouts, focuses its input, locks scroll and restores focus', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const { unmount } = render(
      <div style={{ transform: 'translateX(100px)' }}>
        <Dialog title="Draft" onClose={() => {}} returnFocus={trigger}>
          <input aria-label="Description" />
        </Dialog>
      </div>,
    );
    expect(screen.getByRole('dialog').parentElement).toBe(document.body);
    expect(screen.getByRole('textbox')).toHaveFocus();
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('');
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it('routes Escape through the caller safety guard and blocks dismissal while busy', () => {
    const close = vi.fn();
    const { rerender } = render(<Dialog title="Confirm" busy onClose={close} />);
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Close dialog' })).toBeDisabled();
    rerender(<Dialog title="Confirm" onClose={close} />);
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(close).toHaveBeenCalledOnce();
  });
});
