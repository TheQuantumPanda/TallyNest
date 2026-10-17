import { useRef, useState } from 'react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Notice } from '../ui/Notice';
import { groupError } from '../../utils/groups';
import { cyclesService, lifecycleIntent } from '../../services/cycles';

const copy = {
  first: [
    'Open first cycle',
    'This starts a separate accounting round with zero recorded positions. Membership is snapshotted when it opens.',
  ],
  freeze: [
    'Freeze cycle',
    'This permanently makes this cycle’s expenses read-only. A rejected settlement cannot thaw it.',
  ],
  close: [
    'Close cycle',
    'Every member must have an exact zero net balance, and no settlement may remain pending. This does not forgive or carry forward debt.',
  ],
  next: [
    'Open next cycle',
    'This starts a new accounting round with zero positions and snapshots the current roster. Earlier cycles remain immutable.',
  ],
};
export function CycleTransition({ action, group, cycle, onClose, onSaved, returnFocus }) {
  const [pending, setPending] = useState(false),
    [error, setError] = useState(''),
    [review, setReview] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [discard, setDiscard] = useState(false);
  const intent = useRef(null),
    busy = useRef(false);
  async function submit() {
    if (busy.current || review) return;
    if (!intent.current) intent.current = lifecycleIntent(action, group, cycle);
    busy.current = true;
    setPending(true);
    setError('');
    try {
      const result = await cyclesService.transition(group.id, intent.current);
      onSaved(result);
    } catch (err) {
      setError(groupError(err));
      if (!err.response?.status || err.response.status >= 500) setUncertain(true);
      else if ([409, 412, 428].includes(err.response.status)) setReview(true);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <Dialog
      title={copy[action][0]}
      onClose={() => (uncertain ? setDiscard(true) : onClose())}
      busy={pending}
      returnFocus={returnFocus}
    >
      <p className="group-policy">{copy[action][1]}</p>
      <p className="group-muted">
        Current preconditions are fixed when you confirm. A retry uses the same intent, key, group
        and cycle ETags, and epoch.
      </p>
      {error && <Notice>{error}</Notice>}
      {uncertain && (
        <Notice tone="info">
          The transition may have committed. Retry this exact request or inspect authoritative
          history; do not start a different transition yet.
        </Notice>
      )}
      {review && (
        <Notice tone="info">
          The submitted versions are stale or another operation is pending. Review the latest cycle
          and group before starting a new intent. This request will not be changed automatically.
        </Notice>
      )}
      <div className="dialog-actions">
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() => (uncertain ? setDiscard(true) : onClose())}
        >
          Cancel
        </Button>
        <Button disabled={review} loading={pending} onClick={submit}>
          {uncertain ? 'Retry original intent' : copy[action][0]}
        </Button>
      </div>
      {discard && (
        <section className="discard-notice" role="alert">
          <h3>Discard the retry intent?</h3>
          <p>
            The transition may already have committed. You will need to inspect current records
            before another action.
          </p>
          <Button variant="ghost" onClick={() => setDiscard(false)}>
            Keep retry intent
          </Button>
          <Button className="button-danger" onClick={onClose}>
            Discard and review
          </Button>
        </section>
      )}
    </Dialog>
  );
}
