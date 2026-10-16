import { RecordForm } from './RecordForm';
import { Field } from '../ui/Field';
import { GroupSelect } from './GroupFeedback';
import { groupExpensesService } from '../../services/groupExpenses';
import { expenseForm, expenseValues, expenseCategories } from '../../utils/groups';
import { formatINR } from '../../utils/transactions';
export function GroupExpenseForm({ groupId, expense, members, userId, ...props }) {
  return (
    <RecordForm
      {...props}
      reviewMembers={members}
      title={expense ? 'Edit shared expense' : 'Add shared expense'}
      initial={expenseValues(expense, members, userId)}
      record={expense}
      idempotent={!expense}
      validate={(values, base) => expenseForm(values, members, base)}
      fetchLatest={expense ? () => groupExpensesService.get(groupId, expense.id) : undefined}
      submit={(data, row, key) =>
        expense
          ? groupExpensesService.update(groupId, row, data)
          : groupExpensesService.create(groupId, data, key)
      }
      warning="The first expense permanently protects this group's history: it prevents group deletion and member departure. Allocations are obligations, not bank payments."
    >
      {({ values, errors, set }) => {
        const preview = expenseForm(values, members, expense);
        return (
          <>
            <Field
              label="Expense title"
              id="shared-title"
              value={values.title}
              onChange={(e) => set('title', e.target.value)}
              error={errors.title}
              maxLength={200}
            />
            <div className="transaction-form-grid">
              <Field
                label="Total amount (INR)"
                id="shared-amount"
                inputMode="decimal"
                value={values.amount}
                onChange={(e) => set('amount', e.target.value)}
                error={errors.amount}
              />
              <Field
                label="Expense date (UTC)"
                id="shared-date"
                type="date"
                value={values.date}
                onChange={(e) => set('date', e.target.value)}
                error={errors.date}
              />
            </div>
            <div className="transaction-form-grid">
              <GroupSelect
                error={errors.payer}
                label="Payer"
                id="shared-payer"
                value={values.payer}
                onChange={(e) => set('payer', e.target.value)}
              >
                {members.map((m) => (
                  <option value={m.id} key={m.id}>
                    {m.name}
                  </option>
                ))}
              </GroupSelect>
              <GroupSelect
                error={errors.category}
                label="Category"
                id="shared-category"
                value={values.category}
                onChange={(e) => set('category', e.target.value)}
              >
                {expenseCategories.map((c) => (
                  <option value={c.id} key={c.id}>
                    {c.label}
                  </option>
                ))}
              </GroupSelect>
            </div>
            <GroupSelect
              label="Split method"
              id="shared-method"
              value={values.method}
              onChange={(e) => set('method', e.target.value)}
            >
              <option value="equal">Equal</option>
              <option value="exact">Exact amounts</option>
              <option value="percentage">Percentage</option>
            </GroupSelect>
            <div
              className="group-participants"
              role="group"
              aria-label="Beneficiaries"
              tabIndex={-1}
              aria-invalid={Boolean(errors.split)}
              aria-describedby={errors.split ? 'group-split-error' : undefined}
            >
              <p>Select the members who benefit from this expense.</p>
              {members.map((m) => (
                <div className="group-participant" key={m.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={values.participants.includes(m.id)}
                      onChange={(e) =>
                        set(
                          'participants',
                          e.target.checked
                            ? [...values.participants, m.id]
                            : values.participants.filter((id) => id !== m.id),
                        )
                      }
                    />
                    {m.name}
                  </label>
                  {values.method !== 'equal' && values.participants.includes(m.id) && (
                    <Field
                      label={`${m.name} ${values.method === 'exact' ? 'amount (INR)' : 'percentage'}`}
                      id={`allocation-${m.id}`}
                      inputMode="decimal"
                      value={values.allocations[m.id] || ''}
                      onChange={(e) =>
                        set('allocations', { ...values.allocations, [m.id]: e.target.value })
                      }
                    />
                  )}
                </div>
              ))}
            </div>
            {errors.split && (
              <p id="group-split-error" role="alert" className="field-error">
                {errors.split}
              </p>
            )}
            {preview.shares && (
              <section className="split-preview" aria-label="Exact split preview">
                <h3>Allocation preview</h3>
                {preview.shares.map((s) => (
                  <p key={s.user}>
                    <span>{members.find((m) => m.id === s.user)?.name}</span>
                    <strong>{formatINR(s.amountMinor)}</strong>
                  </p>
                ))}
                <p className="group-muted">
                  Exact paise; remainders follow stable member IDs. The saved server allocation is
                  authoritative.
                </p>
              </section>
            )}
            <Field
              label="Notes (optional)"
              id="shared-notes"
              value={values.notes}
              onChange={(e) => set('notes', e.target.value)}
              error={errors.notes}
              maxLength={2000}
            />
          </>
        );
      }}
    </RecordForm>
  );
}
