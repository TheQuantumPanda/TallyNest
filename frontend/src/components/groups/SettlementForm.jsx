import { useState } from 'react';
import { RecordForm } from './RecordForm';
import { GroupSelect } from './GroupFeedback';
import { Field } from '../ui/Field';
import { groupSettlementsService } from '../../services/groupSettlements';
import { FREEZE_WARNING, capacity } from '../../utils/groups';
import { positiveMinor, decimalAmount, formatINR } from '../../utils/transactions';
export function SettlementForm({
  group,
  cycleId,
  frozenCycle = group.settlementMode,
  service = groupSettlementsService,
  balances,
  members,
  userId,
  suggestion,
  ...props
}) {
  const [acknowledged, setAcknowledged] = useState(false),
    debt = capacity(
      balances.members.find((m) => m.user === userId),
      true,
    );
  const eligible = balances.members.filter((m) => m.user !== userId && capacity(m, false) > 0),
    recipient = suggestion?.recipient || eligible[0]?.user || '';
  const validate = (values) => {
    const errors = {};
    let amountMinor;
    try {
      amountMinor = positiveMinor(values.amount);
    } catch {
      errors.amount = 'Enter a positive exact amount with up to two decimals.';
    }
    if (!eligible.some((m) => m.user === values.recipient))
      errors.recipient = 'Select a creditor with available capacity.';
    if (
      amountMinor &&
      (amountMinor > debt ||
        amountMinor >
          capacity(
            eligible.find((m) => m.user === values.recipient),
            false,
          ))
    )
      errors.amount = 'Amount exceeds available debt or credit after pending reservations.';
    if (!frozenCycle && !acknowledged)
      errors.acknowledgement = 'Acknowledge the permanent expense freeze before proposing.';
    return Object.keys(errors).length
      ? { errors }
      : { errors, data: { recipient: values.recipient, amountMinor, currency: 'INR' } };
  };
  return (
    <RecordForm
      {...props}
      title="Propose settlement"
      initial={{
        recipient,
        amount: suggestion
          ? decimalAmount(
              Math.min(
                suggestion.amountMinor,
                debt,
                capacity(
                  eligible.find((m) => m.user === recipient),
                  false,
                ),
              ),
            )
          : '',
      }}
      idempotent
      validate={validate}
      submit={(data, _row, key) =>
        cycleId ? service.create(group.id, cycleId, data, key) : service.create(group.id, data, key)
      }
      warning={
        frozenCycle
          ? 'Only recipient-confirmed records affect balances. This creates a proposal, never a payment.'
          : cycleId
            ? 'The first valid proposal permanently freezes expense modifications in this cycle, including if the proposal is rejected. Other cycles remain separate. No bank payment occurs.'
            : FREEZE_WARNING
      }
    >
      {({ values, errors, set, uncertain }) => (
        <>
          {uncertain && (
            <p className="group-policy">
              Original submission:{' '}
              {members.find((m) => m.id === values.recipient)?.name || values.recipient} ·{' '}
              {formatINR(positiveMinor(values.amount))}. Retrying checks this same submission; its
              pending reservation may already be included below.
            </p>
          )}
          <p className="group-muted">
            Available debt: {formatINR(debt)}. Pending outgoing reservations are already deducted.
          </p>
          <GroupSelect
            id="settlement-recipient"
            label="Recipient"
            value={values.recipient}
            onChange={(e) => set('recipient', e.target.value)}
          >
            {eligible.map((m) => (
              <option value={m.user} key={m.user}>
                {members.find((p) => p.id === m.user)?.name || m.user} · available{' '}
                {formatINR(capacity(m, false))}
              </option>
            ))}
          </GroupSelect>
          {errors.recipient && <p className="field-error">{errors.recipient}</p>}
          <Field
            label="Settlement amount (INR)"
            id="settlement-amount"
            inputMode="decimal"
            value={values.amount}
            error={errors.amount}
            onChange={(e) => set('amount', e.target.value)}
          />
          {!frozenCycle && (
            <label className="group-check">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
              />
              {cycleId
                ? 'I understand this permanently freezes shared expense modifications in this cycle.'
                : 'I understand that this permanently freezes shared expense modifications.'}
            </label>
          )}
          {errors.acknowledgement && (
            <p className="field-error" role="alert">
              {errors.acknowledgement}
            </p>
          )}
          <p className="group-muted">
            Sender is your authenticated account. Recipient confirmation records acknowledgement,
            not external bank verification. There is no reversal endpoint.
          </p>
        </>
      )}
    </RecordForm>
  );
}
