import { useState } from 'react';
import { RecordForm } from './RecordForm';
import { GroupSelect } from './GroupFeedback';
import { Field } from '../ui/Field';
import { groupSettlementsService } from '../../services/groupSettlements';
import { FREEZE_WARNING, capacity } from '../../utils/groups';
import { positiveMinor, decimalAmount, formatINR } from '../../utils/transactions';
export function SettlementForm({ group, balances, members, userId, suggestion, ...props }) {
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
    if (!group.settlementMode && !acknowledged)
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
      submit={(data, _row, key) => groupSettlementsService.create(group.id, data, key)}
      warning={
        group.settlementMode
          ? 'Only recipient-confirmed records affect balances. This creates a proposal, never a payment.'
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
          {!group.settlementMode && (
            <label className="group-check">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
              />
              I understand that this permanently freezes shared expense modifications.
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
