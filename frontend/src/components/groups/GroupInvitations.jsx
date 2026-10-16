import { useCallback, useState } from 'react';
import { groupInvitationsService } from '../../services/groupInvitations';
import { groupsService } from '../../services/groups';
import { useGroupResource } from '../../hooks/useGroupData';
import { RecordForm } from './RecordForm';
import { GroupAction } from './GroupAction';
import { GroupFeedback, GroupSelect } from './GroupFeedback';
import { Field } from '../ui/Field';
import { Button } from '../ui/Button';
import { Notice } from '../ui/Notice';
import { displayUtc } from '../../utils/recurring';
export function GroupInvitations({ groupId, revision, onChanged }) {
  const load = useCallback((signal) => groupInvitationsService.list(groupId, signal), [groupId]);
  const resource = useGroupResource(groupId, load, revision),
    [creating, setCreating] = useState(false),
    [revoking, setRevoking] = useState(null),
    [link, setLink] = useState(''),
    [generatedId, setGeneratedId] = useState(null),
    [message, setMessage] = useState('');
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setMessage('Invitation link copied. Share only with intended members.');
    } catch {
      setMessage('Clipboard access is unavailable. Select and copy the link manually.');
    }
  }
  const refresh = () => {
    resource.reload();
    onChanged();
  };
  return (
    <section className="group-panel">
      <div className="group-section-heading">
        <h2>Private invitations</h2>
        <Button
          disabled={resource.loading || !!resource.error}
          onClick={() => {
            setLink('');
            setGeneratedId(null);
            setMessage('');
            setCreating(true);
          }}
        >
          Generate invitation
        </Button>
      </div>
      <p className="group-muted">
        Manually share a link with registered TallyNest users. Links expire and have bounded uses.
      </p>
      <GroupFeedback {...resource} retry={resource.reload} />
      {message && <Notice tone="info">{message}</Notice>}
      {link && (
        <div className="group-link">
          <Field
            label="One-time invitation link"
            id="generated-link"
            value={link}
            readOnly
            onFocus={(e) => e.target.select()}
          />
          <p>
            You cannot retrieve this token again. Copy it now; it is cleared when you leave this
            section.
          </p>
          <Button variant="ghost" onClick={copy}>
            Copy invitation link
          </Button>
          <Button variant="ghost" onClick={() => setLink('')}>
            Hide link
          </Button>
        </div>
      )}
      {!resource.loading && !resource.error && resource.data?.invitations.length === 0 && (
        <p className="group-empty">No invitation links yet.</p>
      )}
      <ul className="group-roster">
        {resource.data?.invitations.map((invite) => (
          <li key={invite.id}>
            <div>
              <strong>{invite.status}</strong>
              <span className="group-role">
                {invite.usedCount} / {invite.maxUses} used · Expires{' '}
                {displayUtc(invite.expiresAt)}{' '}
              </span>
            </div>
            {invite.status === 'active' && (
              <Button variant="ghost" onClick={() => setRevoking(invite)}>
                Revoke invitation
              </Button>
            )}
          </li>
        ))}
      </ul>
      {creating && (
        <RecordForm
          title="Generate invitation"
          initial={{ maxUses: '1', expiry: '86400' }}
          validate={(values) =>
            /^[1-9]\d?$/.test(values.maxUses) && Number(values.maxUses) <= 20
              ? {
                  errors: {},
                  data: {
                    maxUses: Number(values.maxUses),
                    expiresInSeconds: Number(values.expiry),
                  },
                }
              : { errors: { maxUses: 'Choose 1–20 uses.' } }
          }
          submit={async (data) =>
            groupInvitationsService.create(await groupsService.get(groupId), data)
          }
          onClose={() => {
            setCreating(false);
            refresh();
          }}
          onSaved={(row) => {
            setLink(`${window.location.origin}/app/join/${row.token}`);
            setGeneratedId(row.invitation.id);
            setMessage('Link generated. The secret is shown only now.');
            setCreating(false);
            refresh();
          }}
          warning="Only intended registered users should receive this bearer link. Its secret cannot be retrieved again."
        >
          {({ values, errors, set }) => (
            <>
              <Field
                id="invite-uses"
                label="Maximum uses"
                inputMode="numeric"
                value={values.maxUses}
                onChange={(e) => set('maxUses', e.target.value)}
                error={errors.maxUses}
              />
              <GroupSelect
                id="invite-expiry"
                label="Expires after"
                value={values.expiry}
                onChange={(e) => set('expiry', e.target.value)}
              >
                <option value="60">1 minute</option>
                <option value="3600">1 hour</option>
                <option value="86400">24 hours</option>
                <option value="604800">7 days</option>
              </GroupSelect>
            </>
          )}
        </RecordForm>
      )}
      {revoking && (
        <GroupAction
          title="Revoke invitation"
          record={resource.data.group}
          fetchLatest={() => groupsService.get(groupId)}
          description={() => 'This link will stop admitting new members. Existing members remain.'}
          act={async () =>
            groupInvitationsService.revoke(await groupsService.get(groupId), revoking.id)
          }
          onClose={() => setRevoking(null)}
          onSaved={() => {
            if (generatedId === revoking.id) setLink('');
            setRevoking(null);
            refresh();
            setMessage('Invitation revoked.');
          }}
        />
      )}
    </section>
  );
}
