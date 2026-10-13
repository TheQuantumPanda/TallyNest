import { useCallback, useRef, useState } from 'react';
import { useBeforeUnload, useBlocker } from 'react-router-dom';
import { Dialog } from '../ui/Dialog';
import { Field } from '../ui/Field';
import { Button } from '../ui/Button';
import { Notice } from '../ui/Notice';
import { budgetService } from '../../services/budgets';
import { decimalAmount } from '../../utils/transactions';
import { budgetError, expenseCategories, validateBudgetForm } from '../../utils/budgets';

export function BudgetForm({
  budget,
  month,
  category,
  configured,
  onClose,
  onSaved,
  onReload,
  returnFocus,
}) {
  const [initial] = useState(() => ({
    month: budget?.month ?? month,
    category:
      budget?.category ??
      category ??
      expenseCategories.find(
        (item) => !configured.some((row) => row.month === month && row.category === item.id),
      )?.id ??
      'food_dining',
    amount: budget ? decimalAmount(budget.amountMinor) : '',
  }));
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [discard, setDiscard] = useState(null);
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
  const occupied = (id) =>
    configured.some(
      (row) => row.month === values.month && row.category === id && row.id !== budget?.id,
    );
  function update(key, value) {
    setValues((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => ({ ...previous, [key]: undefined }));
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
      setError(budgetError(err));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  async function submit(event) {
    event.preventDefault();
    if (busy.current || conflict) return;
    const result = validateBudgetForm(values, configured, budget);
    setErrors(result.errors);
    setError('');
    if (!result.data) {
      form.current.querySelector(`[name="${Object.keys(result.errors)[0]}"]`)?.focus();
      return;
    }
    busy.current = true;
    setPending(true);
    try {
      if (budget) await budgetService.update(budget, result.data);
      else await budgetService.create(result.data);
      onSaved(budget ? 'Budget updated.' : 'Budget created.');
    } catch (err) {
      setError(budgetError(err));
      if (err.response?.data?.code === 'BUDGET_EXISTS')
        setErrors({ category: 'This category and month already have a budget.' });
      else if (budget && [409, 412, 428].includes(err.response?.status)) setConflict(true);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <Dialog
      title={budget ? 'Edit budget' : 'Add budget'}
      onClose={close}
      busy={pending}
      returnFocus={returnFocus}
    >
      <p className="dialog-description">
        Set an independent monthly limit. Your expenses remain separate, unchanged records.
      </p>
      {error && <Notice>{error}</Notice>}
      {conflict && (
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() => (dirty ? setDiscard('reload') : reload())}
        >
          Reload latest budget
        </Button>
      )}
      {discard && (
        <section className="discard-notice" role="alert">
          <h3>Discard unsaved changes?</h3>
          <p>
            {discard === 'reload'
              ? 'Reloading will replace your draft with the latest saved budget. Review it before saving again.'
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
      <form ref={form} onSubmit={submit} noValidate className="transaction-form budget-form">
        <fieldset disabled={pending}>
          <legend className="sr-only">Budget fields</legend>
          <div className="field">
            <label htmlFor="budget-category">Expense category</label>
            <select
              id="budget-category"
              name="category"
              value={values.category}
              onChange={(event) => update('category', event.target.value)}
              aria-invalid={!!errors.category}
              aria-describedby="budget-category-hint budget-category-error"
            >
              {expenseCategories.map((item) => (
                <option key={item.id} value={item.id} disabled={occupied(item.id)}>
                  {item.label}
                  {occupied(item.id) ? ' · already budgeted' : ''}
                </option>
              ))}
            </select>
            <p id="budget-category-hint" className="field-hint">
              One limit per expense category, currency and month.
            </p>
            <p id="budget-category-error" className="field-error">
              {errors.category}
            </p>
          </div>
          <Field
            autoFocus
            label="Monthly limit (INR)"
            id="budget-amount"
            name="amount"
            inputMode="decimal"
            value={values.amount}
            onChange={(event) => update('amount', event.target.value)}
            error={errors.amount}
            placeholder="0.00"
            hint="Exact paise. Up to 2 decimal places; no rounding."
          />
          <Field
            label="Budget month"
            id="budget-month"
            name="month"
            type="month"
            min="0001-01"
            max="9999-12"
            value={values.month}
            onChange={(event) => update('month', event.target.value)}
            error={errors.month}
            hint="Independent calendar month in UTC. No automatic renewal."
          />
          <p className="budget-currency">
            Currency <strong>INR · Indian rupee</strong>
          </p>
        </fieldset>
        <div className="dialog-actions">
          <Button type="button" variant="ghost" onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" loading={pending} disabled={conflict}>
            {pending ? 'Saving…' : budget ? 'Save changes' : 'Create budget'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
