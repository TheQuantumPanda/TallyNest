import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { groupsService } from '../services/groups';
import { cyclesService } from '../services/cycles';
import { useGroupResource } from '../hooks/useGroupData';
import { useAuth } from '../hooks/useAuth';
import { CycleHistory } from '../components/cycles/CycleHistory';
import { CycleTransition } from '../components/cycles/CycleTransition';
import { CycleRecordOverlay } from '../components/cycles/CycleRecordOverlay';
import { GroupExpenseForm } from '../components/groups/GroupExpenseForm';
import { GroupExpenseList } from '../components/groups/GroupExpenseList';
import { SettlementList } from '../components/groups/SettlementList';
import { SettlementForm } from '../components/groups/SettlementForm';
import { GroupBalances } from '../components/groups/GroupBalances';
import { GroupInvitations } from '../components/groups/GroupInvitations';
import { GroupFeedback } from '../components/groups/GroupFeedback';
import { Button } from '../components/ui/Button';
import { Notice } from '../components/ui/Notice';
import { PageTransition } from '../components/ui/PageTransition';
import { groupError } from '../utils/groups';
import { displayCycleUtc } from '../utils/cycleDates';

function Workspace({ groupId, routeCycleId }) {
  const { user } = useAuth(),
    navigate = useNavigate();
  const [revision, setRevision] = useState(0),
    [tab, setTab] = useState('overview'),
    [transition, setTransition] = useState(null),
    [selected, setSelected] = useState(null),
    [proposal, setProposal] = useState(null),
    [message, setMessage] = useState(''),
    [recoveryError, setRecoveryError] = useState(''),
    [recovering, setRecovering] = useState(false);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  const groupLoad = useCallback((signal) => groupsService.get(groupId, signal), [groupId]);
  const rosterLoad = useCallback((signal) => groupsService.members(groupId, signal), [groupId]);
  const historyLoad = useCallback((signal) => cyclesService.list(groupId, {}, signal), [groupId]);
  const groupResult = useGroupResource(groupId, groupLoad, revision);
  const rosterResult = useGroupResource(groupId, rosterLoad, revision);
  const history = useGroupResource(groupId, historyLoad, revision);
  const head = history.data?.group;
  const currentId = head?.currentCycleId;
  const selectedId = routeCycleId || currentId;
  const cycleLoad = useCallback(
    (signal) =>
      selectedId ? cyclesService.get(groupId, selectedId, signal) : Promise.resolve(null),
    [groupId, selectedId],
  );
  const cycleResult = useGroupResource(`${groupId}:${selectedId || 'none'}`, cycleLoad, revision);
  const cycle = cycleResult.data?.value;
  const balanceLoad = useCallback(
    (signal) =>
      selectedId ? cyclesService.balances(groupId, selectedId, signal) : Promise.resolve(null),
    [groupId, selectedId],
  );
  const balances = useGroupResource(`${groupId}:${selectedId || 'none'}`, balanceLoad, revision);
  const group = groupResult.data;
  const protocolInactive = history.error?.response?.data?.code === 'CYCLE_PROTOCOL_INACTIVE';
  const members = rosterResult.data?.members || [];
  const snapshotMembers = cycle
    ? members.filter((member) => cycle.memberIds.includes(member.id))
    : [];
  const isCurrent = !!cycle && cycle.id === currentId;
  const owner = group?.membership.role === 'owner';
  const busy =
    !!head?.busy ||
    !!group?.financialBusy ||
    history.error?.response?.data?.code === 'FINANCIAL_BUSY';
  const writable = isCurrent && cycle?.state === 'open' && !busy;
  const canSettle = isCurrent && ['open', 'frozen'].includes(cycle?.state) && !busy;
  const blocked =
    groupResult.loading ||
    rosterResult.loading ||
    cycleResult.loading ||
    busy ||
    !!groupResult.error ||
    !!rosterResult.error ||
    !!cycleResult.error;
  function choose(id) {
    navigate(`/app/groups/${groupId}/cycles/${id}`);
    setTab('overview');
  }
  function saved(result) {
    setSelected(null);
    setProposal(null);
    setTransition(null);
    setMessage(
      result?.replayed
        ? 'Original intent reconciled without creating a duplicate.'
        : 'Saved. Authoritative records are reloading.',
    );
    reload();
  }
  async function recover() {
    if (recovering) return;
    setRecovering(true);
    setRecoveryError('');
    try {
      const result = await cyclesService.recover(groupId);
      setMessage(
        result.recovered
          ? 'The original operation was reconciled. Records are reloading.'
          : 'No completed operation was recovered. Review current records.',
      );
      reload();
    } catch (error) {
      setRecoveryError(groupError(error));
    } finally {
      setRecovering(false);
    }
  }
  return (
    <PageTransition className="groups-page cycle-workspace">
      <Link className="group-back" to="/app/groups">
        ← All groups
      </Link>
      <header className="page-heading transaction-page-heading">
        <div>
          <span className="eyebrow">TALLYNEST · ACCOUNTING CYCLES · INR</span>
          <h1>{group?.name || 'Group cycles'}</h1>
          <p>Separate, exact shared accounting rounds. No bank transfer is made here.</p>
        </div>
        <Button variant="ghost" onClick={reload}>
          Refresh records
        </Button>
      </header>
      <GroupFeedback {...groupResult} retry={groupResult.reload} />
      {!protocolInactive && <GroupFeedback {...history} retry={history.reload} />}
      {protocolInactive && (
        <section className="group-panel" aria-labelledby="cycle-protocol-unavailable">
          <h2 id="cycle-protocol-unavailable">Cycle workspace unavailable for this group</h2>
          <p role="alert">{groupError(history.error)}</p>
          <Link to="/app/groups">Return to all groups</Link>
        </section>
      )}
      {message && <Notice tone="success">{message}</Notice>}
      {busy && group && (
        <section className="group-recovery" aria-label="Financial recovery">
          <h2>Financial activity is temporarily blocked</h2>
          <p>
            Only the original actor or owner can reconcile the fixed operation. Recovery does not
            force an unlock.
          </p>
          {recoveryError && <Notice>{recoveryError}</Notice>}
          <Button variant="ghost" loading={recovering} onClick={recover}>
            Recover pending operation
          </Button>
        </section>
      )}
      {history.error?.response?.status === 503 && (
        <Notice>
          Cycle access is held for maintenance or failed readiness. This test workspace cannot
          release the hold.
        </Notice>
      )}
      {group && head && (
        <>
          <CycleHistory
            groupId={groupId}
            selectedId={selectedId}
            currentId={currentId}
            onSelect={choose}
            revision={revision}
          />
          {!currentId && owner && (
            <>
              <Notice tone="info">
                You may create an invitation link now, but a new member can join only between cycles
                after a cycle is closed. This preserves each cycle’s fixed member snapshot.
              </Notice>
              <Button
                disabled={busy}
                onClick={(event) =>
                  setTransition({ action: 'first', trigger: event.currentTarget })
                }
              >
                Open first cycle
              </Button>
            </>
          )}
          {cycle && (
            <section className="group-panel cycle-current">
              <div className="group-section-heading">
                <div>
                  <h2>Cycle {cycle.sequence}</h2>
                  <p>
                    {isCurrent ? 'Current cycle' : 'Historical cycle'} · {cycle.state} · opened{' '}
                    <time dateTime={cycle.openedAt}>{displayCycleUtc(cycle.openedAt)}</time>
                  </p>
                </div>
                <span className="category-pill">{cycle.state}</span>
              </div>
              {cycle.frozenAt && (
                <p className="group-muted">
                  Frozen <time dateTime={cycle.frozenAt}>{displayCycleUtc(cycle.frozenAt)}</time>
                  {cycle.closedAt && (
                    <>
                      {' · Closed '}
                      <time dateTime={cycle.closedAt}>{displayCycleUtc(cycle.closedAt)}</time>
                    </>
                  )}
                </p>
              )}
              {!isCurrent && (
                <Notice tone="info">
                  This is read-only history. Selecting it never changes the current cycle or later
                  balances.
                </Notice>
              )}
              {owner && isCurrent && !busy && (
                <div className="group-actions">
                  {cycle.state === 'open' && (
                    <Button
                      variant="ghost"
                      onClick={(event) =>
                        setTransition({ action: 'freeze', trigger: event.currentTarget })
                      }
                    >
                      Freeze cycle
                    </Button>
                  )}
                  {cycle.state === 'frozen' && (
                    <Button
                      variant="ghost"
                      onClick={(event) =>
                        setTransition({ action: 'close', trigger: event.currentTarget })
                      }
                    >
                      Close cycle
                    </Button>
                  )}
                  {cycle.state === 'closed' && (
                    <Button
                      onClick={(event) =>
                        setTransition({ action: 'next', trigger: event.currentTarget })
                      }
                    >
                      Open next cycle
                    </Button>
                  )}
                </div>
              )}
            </section>
          )}
          {cycle && (
            <>
              <nav className="group-tabs" aria-label="Cycle sections">
                {[
                  'overview',
                  'expenses',
                  'balances',
                  'settlements',
                  'members',
                  ...(owner ? ['invitations'] : []),
                ].map((value) => (
                  <button
                    key={value}
                    aria-current={tab === value ? 'page' : undefined}
                    onClick={() => setTab(value)}
                  >
                    {value}
                  </button>
                ))}
              </nav>
              {tab === 'overview' && (
                <section className="group-panel">
                  <h2>Recorded history for Cycle {cycle.sequence}</h2>
                  <p>
                    Only records assigned to this cycle affect its positions. Pending proposals
                    reserve capacity but do not change balances.
                  </p>
                  <Button variant="ghost" onClick={() => setTab('expenses')}>
                    View shared expenses
                  </Button>
                </section>
              )}
              {tab === 'expenses' && (
                <GroupExpenseList
                  key={selectedId}
                  group={{ ...group, settlementMode: !writable, financialBusy: busy }}
                  cycleId={selectedId}
                  service={cyclesService.expenses}
                  members={snapshotMembers}
                  userId={user.id}
                  revision={revision}
                  disabled={blocked}
                  select={(mode, row, trigger) => setSelected({ mode, row, trigger })}
                />
              )}
              {tab === 'balances' && (
                <>
                  {balances.error?.response?.data?.code !== 'CYCLE_MEMBERSHIP_CHANGED' && (
                    <GroupFeedback {...balances} retry={balances.reload} />
                  )}
                  {balances.error?.response?.data?.code === 'CYCLE_MEMBERSHIP_CHANGED' && (
                    <Notice tone="info">
                      You joined after this cycle’s member snapshot and cannot view its detailed
                      balances.
                    </Notice>
                  )}
                  {balances.data && (
                    <GroupBalances
                      balances={balances.data}
                      members={snapshotMembers}
                      userId={user.id}
                      disabled={!canSettle || blocked}
                      propose={(event, suggestion) =>
                        setProposal({ trigger: event?.currentTarget, suggestion })
                      }
                    />
                  )}
                </>
              )}
              {tab === 'settlements' && (
                <>
                  <div className="group-proposal-bar">
                    <Button
                      disabled={
                        !canSettle ||
                        blocked ||
                        balances.loading ||
                        !!balances.error ||
                        !balances.data
                      }
                      onClick={(event) => setProposal({ trigger: event.currentTarget })}
                    >
                      Propose settlement
                    </Button>
                    <p>
                      Recipient acknowledgement only; confirmed records affect this cycle’s
                      balances.
                    </p>
                  </div>
                  <SettlementList
                    key={selectedId}
                    groupId={groupId}
                    cycleId={selectedId}
                    service={cyclesService.settlements}
                    members={snapshotMembers}
                    userId={user.id}
                    revision={revision}
                    disabled={blocked || !isCurrent || cycle.state !== 'frozen'}
                    select={(mode, row, trigger) => setSelected({ mode, row, trigger })}
                  />
                </>
              )}
              {tab === 'members' && (
                <section className="group-panel">
                  <h2>Cycle member snapshot</h2>
                  <p>
                    Historical shares retain their original member IDs. Invitations can be accepted
                    only after the current cycle closes and before the next opens. Financial history
                    still blocks departure and removal; owner succession is unavailable.
                  </p>
                  <ul className="group-roster">
                    {cycle.memberIds.map((memberId) => (
                      <li key={memberId}>
                        <strong>
                          {members.find((member) => member.id === memberId)?.name ||
                            'Historical member'}
                        </strong>
                        <small className="group-identity">{memberId}</small>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {tab === 'invitations' && owner && (
                <>
                  <Notice tone="info">
                    New members can accept invitations only after the current cycle closes and
                    before the next opens. Creating a link does not add a member to this cycle.
                  </Notice>
                  <GroupInvitations groupId={groupId} revision={revision} onChanged={reload} />
                </>
              )}
            </>
          )}
        </>
      )}
      {transition && head && (
        <CycleTransition
          action={transition.action}
          group={head}
          cycle={cycle}
          returnFocus={transition.trigger}
          onClose={() => setTransition(null)}
          onSaved={saved}
        />
      )}
      {selected?.mode === 'add-expense' && cycle && (
        <GroupExpenseForm
          groupId={groupId}
          cycleId={cycle.id}
          service={cyclesService.expenses}
          members={snapshotMembers}
          userId={user.id}
          onClose={() => setSelected(null)}
          onSaved={saved}
          locked={!writable}
          returnFocus={selected.trigger}
        />
      )}
      {selected && selected.mode !== 'add-expense' && cycle && (
        <CycleRecordOverlay
          selected={selected}
          groupId={groupId}
          cycle={cycle}
          members={snapshotMembers}
          userId={user.id}
          onClose={() => setSelected(null)}
          onSaved={saved}
        />
      )}
      {proposal && cycle && balances.data && (
        <SettlementForm
          group={{ ...group, settlementMode: cycle.state !== 'open' }}
          cycleId={cycle.id}
          frozenCycle={cycle.state !== 'open'}
          service={cyclesService.settlements}
          balances={balances.data}
          members={snapshotMembers}
          userId={user.id}
          suggestion={proposal.suggestion}
          returnFocus={proposal.trigger}
          onClose={() => setProposal(null)}
          onSaved={saved}
        />
      )}
    </PageTransition>
  );
}

export function CycleWorkspace() {
  const { groupId, cycleId } = useParams();
  return <Workspace key={groupId} groupId={groupId} routeCycleId={cycleId} />;
}
