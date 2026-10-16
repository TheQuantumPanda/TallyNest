import { useState } from 'react';
import { Button } from './Button';
import { Notice } from './Notice';
export function CreationIntentNotice({ creation, onReview }) {
  const [reviewed, setReviewed] = useState(false);
  if (!creation.intent) return null;
  return (
    <Notice tone="info">
      <p>
        This submission may already exist. Its exact payload and retry key are retained in memory,
        including when you close and reopen this form. Retry the identical submission to reconcile
        it.
      </p>
      <p>
        A full reload loses the retry key. Review authoritative records before starting another
        creation; never assume a timeout means nothing was saved.
      </p>
      <Button type="button" variant="ghost" onClick={onReview}>
        Close and review existing records
      </Button>
      <label className="field-hint">
        <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />{' '}
        I reviewed the latest records and understand the previous operation may already exist.
      </label>
      <Button
        type="button"
        variant="ghost"
        disabled={!reviewed}
        onClick={() => {
          creation.release();
          setReviewed(false);
        }}
      >
        Start a new intended creation
      </Button>
    </Notice>
  );
}
