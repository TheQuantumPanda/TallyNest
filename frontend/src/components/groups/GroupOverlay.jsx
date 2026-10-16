import { useCallback } from 'react';
import { useGroupResource } from '../../hooks/useGroupData';
import { groupsService } from '../../services/groups';
import { groupExpensesService } from '../../services/groupExpenses';
import { groupSettlementsService } from '../../services/groupSettlements';
import { GroupFeedback } from './GroupFeedback';
import { GroupForm } from './GroupForm';
import { GroupExpenseForm } from './GroupExpenseForm';
import { GroupAction } from './GroupAction';
import { Dialog } from '../ui/Dialog';
import { PAYMENT_NOTICE } from '../../utils/groups';
import { formatINR } from '../../utils/transactions';
export function GroupOverlay({
  selected,
  groupId,
  members,
  userId,
  onClose,
  onSaved,
  onFinancialError,
  frozen,
}) {
  const { mode, row } = selected;
  const load = useCallback(
    (signal) =>
      mode.includes('expense') && row
        ? groupExpensesService.get(groupId, row.id, signal)
        : ['confirm', 'reject'].includes(mode)
          ? groupSettlementsService.get(groupId, row.id, signal)
          : groupsService.get(groupId, signal),
    [groupId, mode, row],
  );
  const resource = useGroupResource(`${groupId}:${mode}:${row?.id || ''}`, load);
  const props = { onClose, onSaved, onFinancialError, returnFocus: selected.trigger };
  if (!resource.data)
    return (
      <Dialog
        title="Review group record"
        eyebrow="TALLYNEST · GROUPS"
        onClose={onClose}
        returnFocus={selected.trigger}
      >
        <GroupFeedback {...resource} retry={resource.reload} />
      </Dialog>
    );
  const record = resource.data;
  if (mode === 'add-expense')
    return (
      <GroupExpenseForm
        {...props}
        groupId={groupId}
        locked={frozen || record.settlementMode}
        members={members}
        userId={userId}
      />
    );
  if (mode === 'edit-group') return <GroupForm {...props} group={record} />;
  if (mode === 'edit-expense')
    return (
      <GroupExpenseForm
        {...props}
        groupId={groupId}
        expense={record}
        locked={frozen}
        members={members}
        userId={userId}
      />
    );
  let title, description, act, unavailable;
  if (mode === 'delete-group') {
    title = 'Delete group';
    description = (r) =>
      `Delete ${r.name}? This is available only before financial history exists. Personal financial records are unaffected.`;
    act = (r) => groupsService.remove(r.id);
    unavailable = (r) =>
      r.financialHistoryLocked
        ? 'Financial history permanently blocks deletion. Return to the group workspace; no unlock or archive operation exists.'
        : r.membership.role !== 'owner'
          ? 'Only the owner may delete this group.'
          : null;
  } else if (mode === 'delete-expense') {
    title = 'Delete expense';
    description = (r) =>
      `Delete “${r.title}” (${formatINR(r.amountMinor)})? Its hidden receipt remains, and the group history lock is not removed.`;
    act = (r) => groupExpensesService.remove(groupId, r);
    unavailable = () => (frozen ? 'Settlement mode permanently freezes expense deletion.' : null);
  } else if (mode === 'remove-member') {
    title = 'Remove member';
    description = () => `Remove ${row.name} from this group? No personal records are affected.`;
    act = (r) => groupsService.removeMember(r, row.id);
    unavailable = (r) =>
      r.financialHistoryLocked ? 'Financial history prevents member departure or removal.' : null;
  } else if (mode === 'leave') {
    title = 'Leave group';
    description = () =>
      'Leave this group? The sole owner cannot leave, and financial history prevents member departure.';
    act = (r) => groupsService.leave(r);
    unavailable = (r) =>
      r.financialHistoryLocked || r.membership.role === 'owner'
        ? 'This membership cannot leave under the current history and owner policy.'
        : null;
  } else {
    title = mode === 'confirm' ? 'Confirm settlement' : 'Reject settlement';
    description = (r) =>
      `${formatINR(r.amountMinor)} · ${mode === 'confirm' ? PAYMENT_NOTICE : 'Rejection records a terminal decision and releases pending capacity. It does not unlock expenses.'}`;
    act = (r) => groupSettlementsService.decide(groupId, r, mode);
    unavailable = (r) =>
      r.recipient !== userId ? 'Only the intended recipient may decide this settlement.' : null;
  }
  return (
    <GroupAction
      {...props}
      title={title}
      record={record}
      description={description}
      act={act}
      unavailable={unavailable}
      fetchLatest={() => load()}
      terminal={['confirm', 'reject'].includes(mode)}
    />
  );
}
