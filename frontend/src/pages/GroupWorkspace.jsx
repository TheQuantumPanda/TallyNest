import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { groupsService } from '../services/groups';
import { groupSettlementsService } from '../services/groupSettlements';
import { useGroupResource } from '../hooks/useGroupData';
import { useAuth } from '../hooks/useAuth';
import { GroupFeedback } from '../components/groups/GroupFeedback';
import { GroupMembers } from '../components/groups/GroupMembers';
import { GroupInvitations } from '../components/groups/GroupInvitations';
import { GroupExpenseList } from '../components/groups/GroupExpenseList';
import { GroupBalances } from '../components/groups/GroupBalances';
import { SettlementList } from '../components/groups/SettlementList';
import { SettlementForm } from '../components/groups/SettlementForm';
import { GroupOverlay } from '../components/groups/GroupOverlay';
import { FinancialRecovery } from '../components/groups/FinancialRecovery';
import { Button } from '../components/ui/Button';
import { Notice } from '../components/ui/Notice';
import { PageTransition } from '../components/ui/PageTransition';
function Workspace({ groupId }) {
  const { user } = useAuth(),
    navigate = useNavigate(),
    [tab, setTab] = useState('overview'),
    [revision, setRevision] = useState(0),
    [selected, setSelected] = useState(null),
    [proposal, setProposal] = useState(null),
    [message, setMessage] = useState(''),
    [busyError, setBusyError] = useState(false);
  const load = useCallback((signal) => groupsService.get(groupId, signal), [groupId]),
    loadMembers = useCallback((signal) => groupsService.members(groupId, signal), [groupId]),
    loadBalances = useCallback(
      (signal) => groupSettlementsService.balances(groupId, signal),
      [groupId],
    );
  const resource = useGroupResource(groupId, load, revision),
    roster = useGroupResource(groupId, loadMembers, revision),
    balances = useGroupResource(groupId, loadBalances, revision);
  const refresh = useCallback(() => {
    setBusyError(false);
    setRevision((r) => r + 1);
  }, []);
  useEffect(() => {
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [refresh]);
  function financialError(err) {
    if (
      err.response?.data?.code === 'FINANCIAL_BUSY' ||
      !err.response?.status ||
      err.response.status >= 500
    ) {
      setBusyError(true);
      refresh();
      setBusyError(true);
    }
  }
  function select(mode, row, trigger) {
    setSelected({ mode, row, trigger });
    setMessage('');
  }
  function saved(result) {
    const mode = selected?.mode;
    setSelected(null);
    setProposal(null);
    if (['delete-group', 'leave'].includes(mode)) navigate('/app/groups', { replace: true });
    else {
      setMessage(
        result?.replayed
          ? 'Submission recovered by idempotent replay. No duplicate record was created.'
          : 'Saved. The workspace is refreshing from authoritative group records.',
      );
      refresh();
    }
  }
  const group =
    roster.data?.group && roster.data.group.version > (resource.data?.version ?? -1)
      ? roster.data.group
      : resource.data;
  if (!group)
    return (
      <section className="groups-page">
        <Link to="/app/groups">← All groups</Link>
        <GroupFeedback {...resource} retry={resource.reload} />
      </section>
    );
  const members = roster.data?.members || [],
    owner = group.membership.role === 'owner',
    blocked =
      resource.loading ||
      !!resource.error ||
      roster.loading ||
      !!roster.error ||
      group.financialBusy ||
      busyError;
  const showRecovery =
    group.financialBusy || busyError || balances.error?.response?.data?.code === 'FINANCIAL_BUSY';
  const tabs = [
    'overview',
    'expenses',
    'members',
    'balances',
    'settlements',
    ...(owner ? ['invitations'] : []),
  ];
  return (
    <PageTransition className="groups-page">
      <Link className="group-back" to="/app/groups">
        ← All groups
      </Link>
      <header className="page-heading transaction-page-heading">
        <div>
          <span className="eyebrow">GROUP WORKSPACE · INR</span>
          <h1>{group.name}</h1>
          <p>{group.description || 'Private shared expenses and auditable settlement records.'}</p>
        </div>
        {owner && (
          <div className="group-actions">
            <Button
              variant="ghost"
              disabled={resource.loading || !!resource.error}
              onClick={(e) => select('edit-group', null, e.currentTarget)}
            >
              Edit group
            </Button>
            <Button
              variant="ghost"
              disabled={group.financialHistoryLocked || resource.loading || !!resource.error}
              onClick={(e) => select('delete-group', null, e.currentTarget)}
            >
              Delete group
            </Button>
          </div>
        )}
      </header>
      <Button variant="ghost" disabled={resource.loading} onClick={refresh}>
        Refresh workspace
      </Button>
      <div className="group-state">
        <span className="category-pill">{owner ? 'Owner' : 'Member'}</span>
        <span>
          {group.settlementMode
            ? 'Settlement mode · Expenses frozen'
            : group.financialHistoryLocked
              ? 'Financial history protected'
              : 'No financial history yet'}
        </span>
      </div>
      {group.financialHistoryLocked && (
        <details className="group-policy">
          <summary>Financial-history restrictions</summary>
          <p>
            Financial history permanently prevents group deletion and member departure.{' '}
            {group.settlementMode
              ? 'Settlement mode also permanently blocks all expense creation, editing and deletion. Rejection does not unlock anything.'
              : 'The first valid settlement proposal will permanently freeze expense modifications.'}{' '}
            Confirmed settlements have no reversal endpoint.
          </p>
        </details>
      )}
      {message && !showRecovery && <Notice tone="success">{message}</Notice>}
      <GroupFeedback loading={resource.loading} error={resource.error} retry={resource.reload} />
      {showRecovery && (
        <FinancialRecovery
          group={group}
          onRecovered={(text) => {
            setMessage(text);
            refresh();
          }}
        />
      )}
      <nav className="group-tabs" aria-label="Group sections">
        {tabs.map((value) => (
          <button
            key={value}
            aria-current={tab === value ? 'page' : undefined}
            onClick={() => setTab(value)}
          >
            {value}
          </button>
        ))}
      </nav>
      {['overview', 'balances'].includes(tab) && (
        <>
          <GroupFeedback {...balances} retry={balances.reload} />
          {!balances.loading && !balances.error && !showRecovery && balances.data && (
            <GroupBalances
              balances={balances.data}
              members={members}
              userId={user.id}
              disabled={blocked || balances.loading}
              propose={(event, suggestion) =>
                setProposal({ suggestion, trigger: event?.currentTarget })
              }
            />
          )}
        </>
      )}
      {tab === 'overview' && (
        <section className="group-panel group-overview-note">
          <h2>A shared record, not a shared bank account</h2>
          <p>
            Record who paid and who benefited. Review exact obligations, then propose settlements
            for recipient acknowledgement. Nothing here executes payments or changes your personal
            dashboard.
          </p>
          <Button variant="ghost" onClick={() => setTab('expenses')}>
            Open shared expenses
          </Button>
        </section>
      )}
      {tab === 'expenses' && (
        <GroupExpenseList
          group={group}
          members={members}
          userId={user.id}
          revision={revision}
          select={select}
          disabled={blocked}
        />
      )}
      {tab === 'members' && (
        <>
          <GroupFeedback {...roster} retry={roster.reload} />
          {roster.data && (
            <GroupMembers
              group={group}
              members={members}
              userId={user.id}
              select={select}
              disabled={blocked}
            />
          )}
        </>
      )}
      {tab === 'settlements' && (
        <>
          <div className="group-proposal-bar">
            <Button
              disabled={blocked || balances.loading || !!balances.error || !balances.data}
              onClick={(e) => setProposal({ trigger: e.currentTarget })}
            >
              Propose settlement
            </Button>
            <p>Recipient acknowledgement only. Confirmed records affect group balances.</p>
          </div>
          <SettlementList
            groupId={groupId}
            members={members}
            userId={user.id}
            revision={revision}
            select={select}
            disabled={blocked}
          />
        </>
      )}
      {tab === 'invitations' && owner && (
        <GroupInvitations groupId={groupId} revision={revision} onChanged={refresh} />
      )}
      {selected && (
        <GroupOverlay
          selected={selected}
          frozen={group.settlementMode}
          groupId={groupId}
          members={members}
          userId={user.id}
          onClose={() => setSelected(null)}
          onSaved={saved}
          onFinancialError={financialError}
        />
      )}
      {proposal && balances.data && (
        <SettlementForm
          group={group}
          balances={balances.data}
          members={members}
          userId={user.id}
          suggestion={proposal.suggestion}
          returnFocus={proposal.trigger}
          onClose={() => setProposal(null)}
          onSaved={saved}
          onFinancialError={financialError}
        />
      )}
    </PageTransition>
  );
}
export function GroupWorkspace() {
  const { groupId } = useParams();
  return <Workspace key={groupId} groupId={groupId} />;
}
