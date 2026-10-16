import { useRef, useState } from 'react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Notice } from '../ui/Notice';
import { groupError } from '../../utils/groups';
export function GroupAction({
  title,
  description,
  record,
  fetchLatest,
  act,
  unavailable,
  onClose,
  onSaved,
  onFinancialError,
  returnFocus,
  terminal = false,
}) {
  const [row, setRow] = useState(record),
    [pending, setPending] = useState(false),
    [blocked, setBlocked] = useState(false),
    [error, setError] = useState(''),
    busy = useRef(false);
  const finished = terminal && row.status !== 'pending',
    reason = unavailable?.(row);
  async function run() {
    if (busy.current || blocked || finished || reason) return;
    busy.current = true;
    setPending(true);
    try {
      await act(row);
      onSaved();
    } catch (err) {
      setError(groupError(err));
      setBlocked(true);
      onFinancialError?.(err);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  async function reload() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      setRow(await fetchLatest());
      setBlocked(false);
      setError('');
    } catch (err) {
      setError(groupError(err));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <Dialog
      title={title}
      eyebrow="TALLYNEST · GROUPS"
      onClose={onClose}
      busy={pending}
      returnFocus={returnFocus}
    >
      <p className="dialog-description">{description(row)}</p>
      {reason && <Notice tone="info">{reason}</Notice>}
      {finished && (
        <Notice tone="info">
          This record is already {row.status}. Return to the workspace to refresh its history.
        </Notice>
      )}
      {error && <Notice>{error}</Notice>}
      <div className="dialog-actions">
        <Button variant="ghost" disabled={pending} onClick={finished ? onSaved : onClose}>
          {finished ? 'Return to workspace' : 'Cancel'}
        </Button>
        {blocked && (
          <Button variant="ghost" loading={pending} onClick={reload}>
            Reload latest and review
          </Button>
        )}
        <Button
          className="button-danger"
          loading={pending}
          disabled={blocked || finished || !!reason}
          onClick={run}
        >
          {title}
        </Button>
      </div>
    </Dialog>
  );
}
