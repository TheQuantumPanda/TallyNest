import { useCallback, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { groupInvitationsService } from '../services/groupInvitations';
import { useGroupResource } from '../hooks/useGroupData';
import { GroupFeedback } from '../components/groups/GroupFeedback';
import { Button } from '../components/ui/Button';
import { Notice } from '../components/ui/Notice';
import { groupError } from '../utils/groups';
import { displayUtc } from '../utils/recurring';
function Invitation({ token }) {
  const navigate = useNavigate(),
    [pending, setPending] = useState(false),
    [error, setError] = useState(''),
    busy = useRef(false);
  const load = useCallback((signal) => groupInvitationsService.inspect(token, signal), [token]),
    resource = useGroupResource(token, load);
  async function join() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      const group = await groupInvitationsService.accept(token);
      navigate(`/app/groups/${group.id}`, { replace: true, state: null });
    } catch (err) {
      if (err.response?.data?.code === 'ALREADY_MEMBER' && resource.data)
        navigate(`/app/groups/${resource.data.group.id}`, { replace: true, state: null });
      else if (err.response?.status === 404)
        navigate('/app/join', { replace: true, state: { unavailable: true } });
      else if (err.response?.data?.code === 'GROUP_CONFLICT')
        setError(
          'The group changed or is not admitting members now. Cycle groups admit new members only after a cycle closes and before the next opens. Ask the owner to confirm the current state, then review this invitation and retry.',
        );
      else setError(groupError(err));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  if (
    resource.error &&
    (resource.error.response?.status === 404 || resource.error.name === 'ZodError')
  )
    return <Navigate to="/app/join" replace state={{ unavailable: true }} />;
  return (
    <section className="groups-page">
      <div className="group-panel group-invitation">
        <span className="eyebrow">PRIVATE GROUP INVITATION</span>
        <h1>{resource.data?.group.name || 'Review invitation'}</h1>
        <GroupFeedback {...resource} retry={resource.reload} />
        {resource.data && (
          <>
            <p>
              Currency: {resource.data.group.currency} · Expires{' '}
              {displayUtc(resource.data.expiresAt)}
            </p>
            <p>
              Joining adds your registered account as a member. This link is a bearer capability;
              share it only with intended people.
            </p>
            <Button
              loading={pending}
              disabled={resource.loading || !!resource.error}
              onClick={join}
            >
              Join group
            </Button>
          </>
        )}
        {error && <Notice>{error}</Notice>}
        <Link to="/app/groups" replace>
          Back to groups
        </Link>
      </div>
    </section>
  );
}
function Unavailable() {
  return (
    <section className="groups-page group-panel">
      <h1>Invitation unavailable</h1>
      <p>
        This link is invalid, expired, revoked or exhausted. Request a new link from the group
        owner.
      </p>
      <Link to="/app/groups" replace>
        Back to groups
      </Link>
    </section>
  );
}
export function InvitationLanding() {
  const { token } = useParams();
  return token ? <Invitation key={token} token={token} /> : <Unavailable />;
}
