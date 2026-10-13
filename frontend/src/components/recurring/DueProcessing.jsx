import { useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '../ui/Button';
import { Notice } from '../ui/Notice';
import { recurringService } from '../../services/recurring';
import { recurringError } from '../../utils/recurring';

export function DueProcessing({ onProcessed }) {
  const [pending, setPending] = useState(false),
    [result, setResult] = useState(null),
    [error, setError] = useState('');
  const busy = useRef(false);
  async function process() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError('');
    setResult(null);
    try {
      const value = await recurringService.process();
      setResult(value);
      onProcessed();
    } catch (err) {
      setError(recurringError(err));
      onProcessed();
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <section className="surface recurring-processing" aria-label="Due entry processing">
      <div className="recurring-processing-heading">
        <div>
          <span className="eyebrow">CATCH UP, ON YOUR TERMS</span>
          <h2>Check due entries</h2>
          <p>
            One bounded check may create missing historical scheduled entries. The server also
            catches up while awake; a sleeping host cannot execute on time.
          </p>
        </div>
        <Button variant="ghost" onClick={process} loading={pending}>
          <RefreshCw size={16} aria-hidden="true" />
          {pending ? 'Checking…' : 'Check due entries'}
        </Button>
      </div>
      {error && <Notice>{error}</Notice>}
      {result && (
        <div className="recurring-process-result" role="status">
          <dl>
            {[
              ['Generated', result.generated],
              ['Recovered', result.recovered],
              ['Advanced', result.advanced],
              ['Errors', result.errors],
              ['Conflicts', result.conflicts],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <p>
            {result.hasMoreDue
              ? 'More work remains. You can run another bounded check; there is no automatic browser loop.'
              : 'No more due work was found at the end of this check.'}
            {result.errors > 0
              ? ' Some entries could not complete. Try again later; persistent failures need server review.'
              : ''}
          </p>
        </div>
      )}
    </section>
  );
}
