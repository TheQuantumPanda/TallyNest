import { useState } from 'react';
import { useAuth } from './useAuth';
// Memory only, scoped by authenticated account and resource. A modal/route remount
// must not silently turn an uncertain request into a second creation intent.
const intents = new Map();
export function useCreationIntent(resource) {
  const { user } = useAuth();
  const scope = `${user.id}:${resource}`;
  const pendingIntent = () => (intents.get(scope)?.uncertain ? intents.get(scope) : null);
  const [state, setState] = useState(() => ({ scope, intent: pendingIntent() }));
  const intent = state.scope === scope ? state.intent : pendingIntent();
  function release() {
    intents.delete(scope);
    setState({ scope, intent: null });
  }
  async function create(data, draft, submit) {
    const retained = intents.get(scope);
    const reusable =
      retained && (retained.uncertain || JSON.stringify(retained.data) === JSON.stringify(data));
    const wasUncertain = reusable && retained.uncertain;
    const current = reusable
      ? retained
      : {
          key: crypto.randomUUID(),
          data: JSON.parse(JSON.stringify(data)),
          draft: JSON.parse(JSON.stringify(draft)),
        };
    current.uncertain = true;
    intents.set(scope, current);
    setState({ scope, intent: current });
    try {
      const result = await submit(current.data, current.key);
      if (intents.get(scope) === current) release();
      return result;
    } catch (error) {
      const status = error.response?.status;
      if (
        !wasUncertain &&
        status &&
        status < 500 &&
        !['CREATION_DELETED', 'IDEMPOTENCY_CONFLICT'].includes(error.response?.data?.code)
      ) {
        if (intents.get(scope) === current) {
          current.uncertain = false;
          setState({ scope, intent: null });
        }
      }
      throw error;
    }
  }
  return { intent, create, release };
}
