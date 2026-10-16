import { useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Users, ArrowUpRight } from 'lucide-react';
import { groupsService } from '../services/groups';
import { useGroupPage } from '../hooks/useGroupData';
import { GroupFeedback, GroupPageMore } from '../components/groups/GroupFeedback';
import { GroupForm } from '../components/groups/GroupForm';
import { Button } from '../components/ui/Button';
import { PageTransition } from '../components/ui/PageTransition';
export function GroupsPage() {
  const load = useCallback((query, signal) => groupsService.list(query, signal), []),
    page = useGroupPage('my-groups', load),
    [creating, setCreating] = useState(null),
    navigate = useNavigate();
  return (
    <PageTransition className="groups-page">
      <header className="page-heading transaction-page-heading">
        <div>
          <span className="eyebrow">
            <Users size={15} /> COLLABORATIVE WORKSPACE
          </span>
          <h1>
            Shared costs.<span className="heading-dot"> Clear records.</span>
          </h1>
          <p>Private groups, exact splits and an accountable history.</p>
        </div>
        <Button onClick={(e) => setCreating({ trigger: e.currentTarget })}>Create group</Button>
      </header>
      <GroupFeedback {...page} retry={page.reload} />
      {!page.loading && !page.error && !page.rows.length && (
        <section className="group-panel group-empty">
          <h2>Your first group starts here</h2>
          <p>
            Create a group, invite registered members, and record real shared expenses. Your
            personal finances stay separate.
          </p>
          <Button onClick={(e) => setCreating({ trigger: e.currentTarget })}>
            Create your first group
          </Button>
        </section>
      )}
      <div className="group-grid">
        {page.rows.map((group) => (
          <Link className="group-card" to={`/app/groups/${group.id}`} key={group.id}>
            <div className="group-section-heading">
              <span className="category-pill">
                {group.membership.role === 'owner' ? 'Owner' : 'Member'}
              </span>
              <ArrowUpRight size={20} />
            </div>
            <h2>{group.name}</h2>
            <p>{group.description || 'A private space for shared expenses.'}</p>
            <div className="group-card-footer">
              <span>INR</span>
              <span>
                {group.financialBusy
                  ? 'Recovery pending'
                  : group.settlementMode
                    ? 'Settlement mode'
                    : group.financialHistoryLocked
                      ? 'History protected'
                      : 'Ready to collaborate'}
              </span>
            </div>
          </Link>
        ))}
      </div>
      <GroupPageMore page={page} />
      {creating && (
        <GroupForm
          returnFocus={creating.trigger}
          onClose={() => {
            setCreating(null);
            page.reload();
          }}
          onSaved={(group) => navigate(`/app/groups/${group.id}`)}
        />
      )}
    </PageTransition>
  );
}
