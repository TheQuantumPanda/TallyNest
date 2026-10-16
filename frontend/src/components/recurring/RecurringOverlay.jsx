import { useEffect, useRef, useState } from 'react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Notice } from '../ui/Notice';
import { RecurringForm } from './RecurringForm';
import { recurringService } from '../../services/recurring';
import { recurringError, displayUtc } from '../../utils/recurring';
import { formatINR } from '../../utils/transactions';

function ScheduleAction({ row, mode, onClose, onSaved, onUnavailable, onReload, returnFocus }) {
  const [pending, setPending] = useState(false),
    [error, setError] = useState(''),
    [conflict, setConflict] = useState(false);
  const busy = useRef(false);
  const deleting = mode === 'delete',
    pausing = mode === 'pause';
  const label = deleting ? 'Delete schedule' : pausing ? 'Pause schedule' : 'Resume schedule';
  async function act() {
    if (busy.current || conflict) return;
    busy.current = true;
    setPending(true);
    setError('');
    try {
      if (deleting) await recurringService.remove(row.id);
      else await recurringService.lifecycle(row, mode);
      onSaved(
        deleting
          ? 'Schedule deleted. Historical transactions remain.'
          : pausing
            ? 'Schedule paused. Its next date is retained.'
            : 'Schedule resumed. Missed eligible entries may catch up.',
      );
    } catch (err) {
      if (err.response?.status === 404) onUnavailable(recurringError(err));
      else {
        setError(recurringError(err));
        if (!deleting && [409, 412, 428].includes(err.response?.status)) setConflict(true);
      }
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
      await onReload();
    } catch (err) {
      setError(recurringError(err));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  const already = !deleting && row.status === (pausing ? 'paused' : 'active');
  return (
    <Dialog title={`${label}?`} onClose={onClose} busy={pending} returnFocus={returnFocus}>
      <p className="dialog-description">
        {row.title} · {formatINR(row.amountMinor)}
        <br />
        Started {displayUtc(row.startDate)}
      </p>
      <p className="delete-description">
        {deleting
          ? 'This removes the schedule only. Historical generated transactions remain. It does not reverse any real-world payment.'
          : pausing
            ? 'Paused schedules retain their next date. Resuming later can generate missed eligible entries; paused dates are not permanently skipped.'
            : 'Resume retains the cursor. Catch-up processing may create missed eligible historical entries, including dates during the pause. A sleeping backend cannot execute on time.'}
      </p>
      {already && (
        <Notice tone="success">
          This schedule is already {row.status}. Close and refresh the list.
        </Notice>
      )}
      {error && <Notice>{error}</Notice>}
      <div className="dialog-actions">
        <Button variant="ghost" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        {conflict && (
          <Button variant="ghost" onClick={reload} loading={pending}>
            Reload latest schedule
          </Button>
        )}
        <Button
          className={deleting ? 'button-danger' : ''}
          onClick={act}
          loading={pending}
          disabled={conflict || already}
        >
          {pending ? 'Working…' : label}
        </Button>
      </div>
    </Dialog>
  );
}
export function RecurringOverlay({ selected, onClose, onSaved, onUnavailable, onReview }) {
  const [record, setRecord] = useState(null),
    [revision, setRevision] = useState(0),
    [cycle, setCycle] = useState(0),
    [error, setError] = useState('');
  const controller = useRef(null);
  const needsRecord = !['add', 'delete'].includes(selected.mode);
  useEffect(() => {
    if (!needsRecord) return;
    const abort = new AbortController();
    controller.current = abort;
    recurringService.get(selected.row.id, abort.signal).then(
      (value) => {
        if (!abort.signal.aborted) {
          setRecord(value);
          setError('');
        }
      },
      (err) => {
        if (!abort.signal.aborted) setError(recurringError(err));
      },
    );
    return () => abort.abort();
  }, [selected, cycle, needsRecord]);
  async function reload() {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const latest = await recurringService.get(selected.row.id, abort.signal);
    if (!abort.signal.aborted) {
      setRecord(latest);
      setRevision((value) => value + 1);
    }
  }
  const props = { onClose, onSaved, returnFocus: selected.trigger };
  if (selected.mode === 'add') return <RecurringForm {...props} onReview={onReview} />;
  if (selected.mode === 'delete')
    return (
      <ScheduleAction {...props} row={selected.row} mode="delete" onUnavailable={onUnavailable} />
    );
  if (!record)
    return (
      <Dialog
        title={selected.mode === 'edit' ? 'Edit schedule' : 'Review schedule'}
        onClose={onClose}
        returnFocus={selected.trigger}
      >
        {error ? (
          <Notice>{error}</Notice>
        ) : (
          <p role="status" className="dialog-description">
            Loading latest schedule…
          </p>
        )}
        <div className="dialog-actions">
          {error && (
            <Button
              onClick={() => {
                setError('');
                setCycle((value) => value + 1);
              }}
            >
              Retry
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </Dialog>
    );
  if (selected.mode === 'edit')
    return (
      <RecurringForm
        key={`${record.id}:${record.version}:${revision}`}
        {...props}
        schedule={record}
        onReload={reload}
      />
    );
  return (
    <ScheduleAction
      key={`${record.id}:${record.version}:${revision}`}
      {...props}
      row={record}
      mode={selected.mode}
      onUnavailable={onUnavailable}
      onReload={reload}
    />
  );
}
