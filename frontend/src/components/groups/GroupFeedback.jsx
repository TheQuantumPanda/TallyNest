import { Notice } from '../ui/Notice';
import { Button } from '../ui/Button';
import { groupError } from '../../utils/groups';
export function GroupFeedback({ loading, error, retry }) {
  return (
    <>
      {loading && (
        <p role="status" className="group-muted">
          Loading current records…
        </p>
      )}
      {error && (
        <div className="group-feedback">
          <Notice>{groupError(error)}</Notice>
          {retry && (
            <Button variant="ghost" onClick={retry}>
              Reload records
            </Button>
          )}
        </div>
      )}
    </>
  );
}
export function GroupPageMore({ page }) {
  return (
    page.pagination?.hasMore && (
      <div className="group-more">
        <Button variant="ghost" loading={page.more} disabled={page.loading} onClick={page.loadMore}>
          Load more
        </Button>
      </div>
    )
  );
}
export function GroupSelect({ label, id, value, onChange, children, error }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        id={id}
        value={value}
        onChange={onChange}
      >
        {children}
      </select>
      {error && (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}
