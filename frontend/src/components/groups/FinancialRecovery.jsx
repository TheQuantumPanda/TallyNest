import { useRef, useState } from 'react';
import { Button } from '../ui/Button';
import { Notice } from '../ui/Notice';
import { groupsService } from '../../services/groups';
import { groupError } from '../../utils/groups';
export function FinancialRecovery({ group, onRecovered }) {
  const [pending, setPending] = useState(false),
    [error, setError] = useState(''),
    busy = useRef(false);
  async function recover() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError('');
    try {
      await groupsService.recover(group.id);
      onRecovered('Recovery checked. Reloaded financial records show the authoritative result.');
    } catch (err) {
      setError(groupError(err));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <section className="group-recovery" aria-label="Financial recovery">
      <h2>Financial activity is temporarily blocked</h2>
      <p>
        An interrupted request may have left a durable operation pending. Only its original actor or
        the owner can recover it. One explicit attempt replays the recorded operation; it does not
        force an unlock.
      </p>
      {error && <Notice>{error}</Notice>}
      <Button variant="ghost" loading={pending} onClick={recover}>
        {group.membership.role === 'owner'
          ? 'Recover pending operation'
          : 'Recover my interrupted operation'}
      </Button>
      {group.membership.role !== 'owner' && (
        <p>
          If this was not your request, ask its actor or the group owner. The server verifies
          recovery permission.
        </p>
      )}
    </section>
  );
}
