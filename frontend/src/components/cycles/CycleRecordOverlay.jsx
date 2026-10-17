import { useCallback } from 'react';
import { useGroupResource } from '../../hooks/useGroupData';
import { cyclesService } from '../../services/cycles';
import { GroupExpenseForm } from '../groups/GroupExpenseForm';
import { GroupAction } from '../groups/GroupAction';
import { GroupFeedback } from '../groups/GroupFeedback';
import { Dialog } from '../ui/Dialog';
import { formatINR } from '../../utils/transactions';
import { PAYMENT_NOTICE } from '../../utils/groups';

export function CycleRecordOverlay({
  selected,
  groupId,
  cycle,
  members,
  userId,
  onClose,
  onSaved,
  onFinancialError,
}) {
  const { mode, row } = selected;
  const load = useCallback(
    (signal) =>
      mode.includes('expense')
        ? cyclesService.expenses.get(groupId, row.id, signal).then((result) => result.value)
        : cyclesService.settlements.get(groupId, row.id, signal).then((result) => result.value),
    [groupId, mode, row],
  );
  const record = useGroupResource(`${groupId}:${cycle.id}:${mode}:${row.id}`, load);
  if (!record.data)
    return (
      <Dialog title="Review cycle record" onClose={onClose} returnFocus={selected.trigger}>
        <GroupFeedback {...record} retry={record.reload} />
      </Dialog>
    );
  if (record.data.cycleId !== cycle.id)
    return (
      <Dialog title="Unavailable record" onClose={onClose} returnFocus={selected.trigger}>
        <p role="alert">This record belongs to another cycle.</p>
      </Dialog>
    );
  const props = { onClose, onSaved, onFinancialError, returnFocus: selected.trigger };
  if (mode === 'edit-expense')
    return (
      <GroupExpenseForm
        {...props}
        groupId={groupId}
        cycleId={cycle.id}
        expense={record.data}
        members={members}
        userId={userId}
        service={cyclesService.expenses}
        locked={cycle.state !== 'open'}
      />
    );
  if (mode === 'delete-expense')
    return (
      <GroupAction
        {...props}
        title="Delete expense"
        record={record.data}
        fetchLatest={load}
        description={(value) =>
          `Delete “${value.title}” (${formatINR(value.amountMinor)}) from Cycle ${cycle.sequence}? The deletion receipt remains.`
        }
        unavailable={() =>
          cycle.state !== 'open' ? 'Historical expense records cannot be changed.' : null
        }
        act={(value) => cyclesService.expenses.remove(groupId, value)}
      />
    );
  const action = mode === 'confirm' ? 'confirm' : 'reject';
  return (
    <GroupAction
      {...props}
      title={action === 'confirm' ? 'Confirm settlement' : 'Reject settlement'}
      record={record.data}
      fetchLatest={load}
      terminal
      description={(value) =>
        `${formatINR(value.amountMinor)} · ${action === 'confirm' ? PAYMENT_NOTICE : 'Rejection releases reserved capacity and never reopens a frozen cycle.'}`
      }
      unavailable={(value) =>
        value.recipient !== userId
          ? 'Only the intended recipient can decide.'
          : cycle.state !== 'frozen'
            ? 'Only the current frozen cycle accepts decisions.'
            : null
      }
      act={(value) => cyclesService.settlements.decide(groupId, value, action)}
    />
  );
}
