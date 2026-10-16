import { useEffect, useRef, useState } from 'react';
import { RecordReview } from './RecordReview';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Notice } from '../ui/Notice';
import { groupError } from '../../utils/groups';
export function RecordForm({
  title,
  initial,
  record,
  validate,
  submit,
  fetchLatest,
  idempotent = false,
  onClose,
  onSaved,
  onFinancialError,
  children,
  warning,
  returnFocus,
  locked = false,
  reviewMembers,
}) {
  const [frozen, setFrozen] = useState(false);
  const [values, setValues] = useState(initial),
    [base, setBase] = useState(record),
    [errors, setErrors] = useState({}),
    [error, setError] = useState(''),
    [pending, setPending] = useState(false),
    [discard, setDiscard] = useState(false),
    [blocked, setBlocked] = useState(false),
    [latest, setLatest] = useState(null),
    [uncertain, setUncertain] = useState(false);
  const busy = useRef(false),
    intent = useRef(null),
    form = useRef(null);
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);
  useEffect(() => {
    const before = (event) => {
      if (dirty || uncertain || pending) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', before);
    return () => window.removeEventListener('beforeunload', before);
  }, [dirty, uncertain, pending]);
  useEffect(() => {
    const originIndex = window.history.state?.idx;
    let restoring = false;
    const guard = (event) => {
      if (restoring) {
        restoring = false;
        return;
      }
      if (!dirty && !uncertain && !pending) return;
      const targetIndex = event.state?.idx;
      if (typeof originIndex !== 'number' || typeof targetIndex !== 'number') return;
      if (
        pending ||
        !window.confirm(
          uncertain
            ? 'This request may have committed. Discard the draft and inspect the workspace before creating another record?'
            : 'Discard your unsaved draft and leave this page?',
        )
      ) {
        event.stopImmediatePropagation();
        restoring = true;
        window.history.go(originIndex - targetIndex);
      }
    };
    window.addEventListener('popstate', guard, true);
    return () => window.removeEventListener('popstate', guard, true);
  }, [dirty, uncertain, pending]);

  function close() {
    if (dirty || uncertain) setDiscard(true);
    else onClose();
  }
  async function save(event) {
    event.preventDefault();
    if (busy.current || blocked || ((locked || frozen) && !(uncertain && idempotent))) return;
    const result =
      uncertain && idempotent && intent.current?.data
        ? { errors: {}, data: intent.current.data }
        : validate(values, base);
    setErrors(result.errors);
    if (!result.data) {
      form.current.querySelector('[aria-invalid="true"]')?.focus();
      return;
    }
    const fingerprint = JSON.stringify(result.data);
    if (idempotent && (!intent.current || intent.current.fingerprint !== fingerprint))
      intent.current = { fingerprint, key: crypto.randomUUID(), data: result.data };
    busy.current = true;
    setPending(true);
    setError('');
    try {
      const row = await submit(result.data, base, intent.current?.key);
      onSaved(row);
    } catch (err) {
      setError(groupError(err));
      const status = err.response?.status;
      if ((!status || status >= 500) && !record) {
        setUncertain(true);
        if (!idempotent) setBlocked(true);
      }
      if (record && (!status || [409, 412, 428].includes(status) || status >= 500))
        setBlocked(true);
      if (['EXPENSE_DELETED', 'IDEMPOTENCY_CONFLICT'].includes(err.response?.data?.code))
        setBlocked(true);
      if (err.response?.data?.code === 'EXPENSES_FROZEN') {
        setBlocked(true);
        setFrozen(true);
      }
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
      setLatest(await fetchLatest());
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
      onClose={close}
      busy={pending}
      returnFocus={returnFocus}
      eyebrow="TALLYNEST · GROUPS"
    >
      {(locked || frozen) && (
        <Notice tone="info">
          Settlement mode permanently freezes shared expense modifications. Your draft remains
          available for review.
        </Notice>
      )}
      {warning && <p className="group-policy">{warning}</p>}
      {error && <Notice>{error}</Notice>}
      {uncertain && (
        <p className="group-policy">
          {idempotent
            ? 'The submission may already exist. Inputs are held for a safe retry with the same key. Close and review the workspace if recovery is needed; do not start another submission without checking.'
            : 'This request has an unknown outcome and no creation receipt. Close and inspect existing groups or invitation metadata before starting another submission.'}
        </p>
      )}
      {blocked && !frozen && !locked && fetchLatest && (
        <Button variant="ghost" onClick={reload} loading={pending}>
          Reload latest for review
        </Button>
      )}
      {latest && (
        <section className="group-review">
          <h3>Latest server record — review before replacing</h3>
          <RecordReview record={latest} members={reviewMembers} />
          <Button
            variant="ghost"
            onClick={() => {
              setBase(latest);
              setLatest(null);
              setBlocked(false);
            }}
          >
            Reviewed latest; keep my draft
          </Button>
        </section>
      )}
      <form
        ref={form}
        className="transaction-form group-form"
        onSubmit={save}
        noValidate
        aria-label={title}
      >
        <fieldset disabled={pending || uncertain || locked || frozen}>
          {children({
            values,
            errors,
            set: (key, value) => {
              setValues((v) => ({ ...v, [key]: value }));
              setErrors({});
            },
            blocked,
            uncertain,
          })}
        </fieldset>
        <div className="dialog-actions">
          <Button type="button" variant="ghost" disabled={pending} onClick={close}>
            Cancel
          </Button>
          <Button
            type="submit"
            loading={pending}
            disabled={blocked || ((locked || frozen) && !(uncertain && idempotent))}
          >
            {uncertain && idempotent ? 'Retry same submission' : 'Save'}
          </Button>
        </div>
      </form>
      {discard && (
        <section className="discard-notice" role="alert">
          <h3>Discard this draft?</h3>
          <p>
            {uncertain
              ? 'The request may have committed. Closing loses this in-memory draft or retry key; check the ledger and recover pending activity before creating another record.'
              : 'Your unsaved changes will be lost.'}
          </p>
          <div className="dialog-actions">
            <Button variant="ghost" onClick={() => setDiscard(false)}>
              Keep editing
            </Button>
            <Button className="button-danger" onClick={onClose}>
              Discard and close
            </Button>
          </div>
        </section>
      )}
    </Dialog>
  );
}
