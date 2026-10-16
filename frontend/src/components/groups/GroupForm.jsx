import { RecordForm } from './RecordForm';
import { Field } from '../ui/Field';
import { groupsService } from '../../services/groups';
import { validateGroup } from '../../utils/groups';
export function GroupForm({ group, ...props }) {
  return (
    <RecordForm
      {...props}
      title={group ? 'Edit group' : 'Create group'}
      record={group}
      initial={{ name: group?.name || '', description: group?.description || '' }}
      validate={validateGroup}
      fetchLatest={group ? () => groupsService.get(group.id) : undefined}
      submit={(data, row) => (group ? groupsService.update(row, data) : groupsService.create(data))}
    >
      {({ values, errors, set }) => (
        <>
          <Field
            label="Group name"
            id="group-name"
            value={values.name}
            onChange={(e) => set('name', e.target.value)}
            error={errors.name}
            maxLength={100}
          />
          <Field
            label="Description (optional)"
            id="group-description"
            value={values.description}
            onChange={(e) => set('description', e.target.value)}
            error={errors.description}
            maxLength={2000}
          />
          <p className="group-muted">
            INR · Up to 100 registered members. Group finances remain separate from personal
            records.
          </p>
        </>
      )}
    </RecordForm>
  );
}
