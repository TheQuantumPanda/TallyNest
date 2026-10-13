import { useCallback, useRef, useState } from 'react';
import { useBeforeUnload, useBlocker } from 'react-router-dom';
import { Dialog } from '../ui/Dialog';
import { Field } from '../ui/Field';
import { Button } from '../ui/Button';
import { Notice } from '../ui/Notice';
import { recurringService } from '../../services/recurring';
import { categoriesFor } from '../../utils/transactions';
import {
  FREQUENCIES,
  frequencyLabel,
  initialScheduleValues,
  recurringError,
  validateScheduleForm,
} from '../../utils/recurring';

function SelectField({ label, name, value, onChange, error, children }) {
  return (
    <div className="field">
      <label htmlFor={`recurring-${name}`}>{label}</label>
      <select
        id={`recurring-${name}`}
        name={name}
        value={value}
        onChange={onChange}
        aria-invalid={!!error}
        aria-describedby={error ? `recurring-${name}-error` : undefined}
      >
        {children}
      </select>
      {error && (
        <p className="field-error" id={`recurring-${name}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}
export function RecurringForm({ schedule, onClose, onSaved, onReload, returnFocus }) {
  const [initial] = useState(() => initialScheduleValues(schedule));
  const [values, setValues] = useState(initial),
    [errors, setErrors] = useState({}),
    [error, setError] = useState('');
  const [pending, setPending] = useState(false),
    [conflict, setConflict] = useState(false),
    [discard, setDiscard] = useState(null);
  const busy = useRef(false),
    form = useRef(null);
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);
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
    setValues((previous) => ({
      ...previous,
      [key]: value,
      ...(key === 'type' ? { category: categoriesFor(value)[0].id } : {}),
    }));
    setErrors((previous) => ({
      ...previous,
      [key]: undefined,
      ...(key === 'type' ? { category: undefined } : {}),
    }));
  }
  function close() {
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
      setError(recurringError(err));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  async function submit(event) {
    event.preventDefault();
    if (busy.current || conflict) return;
    const result = validateScheduleForm(values, schedule);
    setErrors(result.errors);
    setError('');
    if (!result.data) {
      form.current.querySelector(`[name="${Object.keys(result.errors)[0]}"]`)?.focus();
      return;
    }
    busy.current = true;
    setPending(true);
    try {
      if (schedule) await recurringService.update(schedule, result.data);
      else await recurringService.create(result.data);
      onSaved(
        schedule
          ? 'Schedule updated. Historical entries are unchanged.'
          : 'Schedule created. Due entries are generated through catch-up processing.',
      );
    } catch (err) {
      setError(recurringError(err));
      if (schedule && [409, 412, 428].includes(err.response?.status)) setConflict(true);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <Dialog
      title={schedule ? 'Edit schedule' : 'Add recurring schedule'}
      onClose={close}
      busy={pending}
      returnFocus={returnFocus}
    >
      <p className="dialog-description">
        Schedule personal transaction entries, not bank payments. All dates and times are UTC.
      </p>
      {schedule && (
        <p className="recurring-guidance">
          Changes apply to uncompleted entries only. Changing the start or frequency may change or
          skip uncompleted future dates; historical entries stay unchanged.
        </p>
      )}
      {error && <Notice>{error}</Notice>}
      {conflict && (
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() => (dirty ? setDiscard('reload') : reload())}
        >
          Reload latest schedule
        </Button>
      )}
      {discard && (
        <section className="discard-notice" role="alert">
          <h3>Discard unsaved changes?</h3>
          <p>
            {discard === 'reload'
              ? 'Reload replaces this draft with the latest saved schedule. Review before saving again.'
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
              ? 'A save is in progress. Please stay until it finishes.'
              : 'Leaving will discard unsaved changes.'}
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
      <form ref={form} onSubmit={submit} noValidate className="transaction-form recurring-form">
        <fieldset disabled={pending}>
          <legend className="sr-only">Recurring schedule fields</legend>
          <SelectField
            label="Transaction type"
            name="type"
            value={values.type}
            onChange={(e) => update('type', e.target.value)}
            error={errors.type}
          >
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </SelectField>
          <Field
            label="Title"
            id="recurring-title"
            name="title"
            value={values.title}
            onChange={(e) => update('title', e.target.value)}
            error={errors.title}
            maxLength={200}
          />
          <Field
            label="Amount (INR)"
            id="recurring-amount"
            name="amount"
            inputMode="decimal"
            placeholder="0.00"
            value={values.amount}
            onChange={(e) => update('amount', e.target.value)}
            error={errors.amount}
            hint="Exact paise. Up to 2 decimal places; no rounding."
          />
          <SelectField
            label="Category"
            name="category"
            value={values.category}
            onChange={(e) => update('category', e.target.value)}
            error={errors.category}
          >
            {categoriesFor(values.type).map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Frequency"
            name="frequency"
            value={values.frequency}
            onChange={(e) => update('frequency', e.target.value)}
            error={errors.frequency}
          >
            {FREQUENCIES.map((value) => (
              <option key={value} value={value}>
                {frequencyLabel(value)}
              </option>
            ))}
          </SelectField>
          <Field
            label="Start date and time (UTC)"
            id="recurring-start"
            name="start"
            type="datetime-local"
            min="0001-01-01T00:00"
            max="9999-12-31T23:59:59.999"
            step="0.001"
            value={values.start}
            onChange={(e) => update('start', e.target.value)}
            error={errors.start}
            hint="Enter UTC directly; your browser’s local timezone is not applied."
          />
          <Field
            label="End date and time (UTC, optional)"
            id="recurring-end"
            name="end"
            type="datetime-local"
            min="0001-01-01T00:00"
            max="9999-12-31T23:59:59.999"
            step="0.001"
            value={values.end}
            onChange={(e) => update('end', e.target.value)}
            error={errors.end}
            hint="Inclusive. Leave blank for no end date."
          />
          <div className="field recurring-form-wide">
            <label htmlFor="recurring-notes">Notes (optional)</label>
            <textarea
              id="recurring-notes"
              name="notes"
              rows={3}
              maxLength={2000}
              value={values.notes}
              onChange={(e) => update('notes', e.target.value)}
              aria-invalid={!!errors.notes}
              aria-describedby={errors.notes ? 'recurring-notes-error' : undefined}
            />
            {errors.notes && (
              <p className="field-error" id="recurring-notes-error">
                {errors.notes}
              </p>
            )}
          </div>
          <p className="recurring-guidance recurring-form-wide">
            Monthly schedules keep the original day: January 31 → February 28/29 → March 31. Yearly
            February 29 uses February 28 in non-leap years. New schedules start active; pause them
            from the list.
          </p>
        </fieldset>
        <div className="dialog-actions">
          <Button type="button" variant="ghost" onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" loading={pending} disabled={conflict}>
            {pending ? 'Saving…' : schedule ? 'Save changes' : 'Create schedule'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
