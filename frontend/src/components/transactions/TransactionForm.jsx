import { useCreationIntent } from '../../hooks/useCreationIntent';
import { CreationIntentNotice } from '../ui/CreationIntentNotice';
import { useCallback, useRef, useState } from 'react';
import { useBeforeUnload, useBlocker } from 'react-router-dom';
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { Dialog } from '../ui/Dialog';
import { Field } from '../ui/Field';
import { Button } from '../ui/Button';
import { Notice } from '../ui/Notice';
import { transactionService } from '../../services/transactions';
import {
  categoriesFor,
  decimalAmount,
  transactionError,
  validateTransactionForm,
} from '../../utils/transactions';

export function TransactionForm({ transaction, onClose, onSaved, onReload, onReview = onClose }) {
  const creation = useCreationIntent('transaction');
  const [initial] = useState(() =>
    !transaction && creation.intent
      ? creation.intent.draft
      : {
          type: transaction?.type ?? 'expense',
          title: transaction?.title ?? '',
          amount: transaction ? decimalAmount(transaction.amountMinor) : '',
          category: transaction?.category ?? 'food_dining',
          date: transaction?.transactionDate.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
          notes: transaction?.notes ?? '',
        },
  );
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [discard, setDiscard] = useState(null);
  const busy = useRef(false);
  const form = useRef(null);
  const dirty =
    JSON.stringify(values) !== JSON.stringify(initial) || (!transaction && !!creation.intent);
  const blocker = useBlocker(dirty || pending);
  useBeforeUnload(
    useCallback(
      (event) => {
        if (dirty || pending) {
          event.preventDefault();
          event.returnValue = '';
        }
      },
      [dirty, pending],
    ),
  );
  function update(key, value) {
    setValues((previous) => {
      const next = { ...previous, [key]: value };
      if (key === 'type' && !categoriesFor(value).some((item) => item.id === previous.category))
        next.category = categoriesFor(value)[0].id;
      return next;
    });
    setErrors((previous) => ({ ...previous, [key]: undefined }));
  }
  function requestClose() {
    if (dirty) setDiscard('close');
    else onClose();
  }
  async function reload() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setDiscard(null);
    setError('');
    try {
      await onReload();
    } catch (err) {
      setError(transactionError(err));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  async function submit(event) {
    event.preventDefault();
    if (busy.current || conflict) return;
    const validated =
      !transaction && creation.intent
        ? { data: creation.intent.data, errors: {} }
        : validateTransactionForm(values, transaction);
    setErrors(validated.errors);
    setError('');
    if (!validated.data) {
      const key = Object.keys(validated.errors)[0];
      form.current.querySelector(`[name="${key}"]`)?.focus();
      return;
    }
    busy.current = true;
    setPending(true);
    try {
      const saved = transaction
        ? await transactionService.update(transaction, validated.data)
        : await creation.create(validated.data, values, transactionService.create);
      onSaved(
        transaction
          ? 'Transaction updated.'
          : saved?.replayed
            ? 'Transaction recovered by idempotent replay. No duplicate was created.'
            : 'Transaction added.',
      );
    } catch (err) {
      setError(transactionError(err));
      if (transaction && [409, 412, 428].includes(err.response?.status)) setConflict(true);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <Dialog
      title={transaction ? 'Edit transaction' : 'Add transaction'}
      onClose={requestClose}
      busy={pending}
    >
      <p className="dialog-description">
        {transaction
          ? 'Keep the details accurate. Every change stays yours.'
          : 'A small record. A clearer picture of your money.'}
      </p>
      {error && <Notice>{error}</Notice>}
      {!transaction && !pending && <CreationIntentNotice creation={creation} onReview={onReview} />}
      {conflict && (
        <Button
          variant="ghost"
          onClick={() => (dirty ? setDiscard('reload') : reload())}
          disabled={pending}
        >
          Reload latest transaction
        </Button>
      )}
      {discard && (
        <section className="discard-notice" role="alert">
          <h3>Discard unsaved changes?</h3>
          <p>
            {!transaction && creation.intent
              ? 'Closing retains the uncertain retry intent in memory. Reopen Add transaction to reconcile it. A full reload loses the key; review records before creating again.'
              : discard === 'reload'
                ? 'Reloading will replace your draft with the latest saved record.'
                : 'Your changes have not been saved.'}
          </p>
          <div className="dialog-actions">
            <Button variant="ghost" onClick={() => setDiscard(null)}>
              Keep editing
            </Button>
            <Button onClick={() => (discard === 'reload' ? reload() : onClose())}>
              Discard changes
            </Button>
          </div>
        </section>
      )}
      {blocker.state === 'blocked' && (
        <section className="discard-notice" role="alert">
          <h3>Leave this draft?</h3>
          <p>
            {pending
              ? 'A save is still in progress. Please stay until it finishes.'
              : !transaction && creation.intent
                ? 'The uncertain intent remains in memory across SPA navigation. A full reload loses its retry key; review records before creating again.'
                : 'Leaving will discard your unsaved changes.'}
          </p>
          <div className="dialog-actions">
            <Button onClick={() => blocker.reset()}>Stay here</Button>
            {!pending && (
              <Button variant="ghost" onClick={() => blocker.proceed()}>
                Discard and leave
              </Button>
            )}
          </div>
        </section>
      )}
      <form ref={form} onSubmit={submit} noValidate className="transaction-form">
        <fieldset disabled={pending || (!transaction && !!creation.intent)}>
          <legend className="sr-only">Transaction fields</legend>
          <div className="type-selector" role="group" aria-label="Transaction type">
            <button
              type="button"
              name="type"
              aria-pressed={values.type === 'expense'}
              onClick={() => update('type', 'expense')}
            >
              <ArrowUpRight size={18} />
              Expense
            </button>
            <button
              type="button"
              aria-pressed={values.type === 'income'}
              onClick={() => update('type', 'income')}
            >
              <ArrowDownLeft size={18} />
              Income
            </button>
          </div>
          <Field
            autoFocus
            label="Title"
            id="transaction-title"
            name="title"
            value={values.title}
            onChange={(event) => update('title', event.target.value)}
            error={errors.title}
            maxLength={200}
            placeholder="What was it for?"
          />
          <div className="transaction-form-grid">
            <Field
              label="Amount (INR)"
              id="transaction-amount"
              name="amount"
              inputMode="decimal"
              value={values.amount}
              onChange={(event) => update('amount', event.target.value)}
              error={errors.amount}
              hint="Up to 2 decimal places. For example, 100.50."
              placeholder="0.00"
            />
            <div className="field">
              <label htmlFor="transaction-category">Category</label>
              <select
                id="transaction-category"
                name="category"
                value={values.category}
                onChange={(event) => update('category', event.target.value)}
                aria-invalid={!!errors.category}
                aria-describedby={errors.category ? 'category-error' : undefined}
              >
                {categoriesFor(values.type).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
              {errors.category && (
                <p className="field-error" id="category-error">
                  {errors.category}
                </p>
              )}
            </div>
          </div>
          <Field
            label="Transaction date"
            id="transaction-date"
            name="date"
            type="date"
            value={values.date}
            onChange={(event) => update('date', event.target.value)}
            error={errors.date}
            hint="Recorded by calendar date in UTC."
          />
          <div className="field">
            <label htmlFor="transaction-notes">
              Notes <span className="muted">(optional)</span>
            </label>
            <textarea
              id="transaction-notes"
              name="notes"
              value={values.notes}
              onChange={(event) => update('notes', event.target.value)}
              maxLength={2000}
              rows={3}
              aria-invalid={!!errors.notes}
              aria-describedby={errors.notes ? 'notes-error' : undefined}
              placeholder="Anything you’d like to remember"
            />
            {errors.notes && (
              <p className="field-error" id="notes-error">
                {errors.notes}
              </p>
            )}
          </div>
        </fieldset>
        <div className="dialog-actions">
          <Button type="button" variant="ghost" onClick={requestClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" loading={pending} disabled={conflict}>
            {pending
              ? 'Saving…'
              : transaction
                ? 'Save changes'
                : creation.intent
                  ? 'Retry identical submission'
                  : 'Add transaction'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
