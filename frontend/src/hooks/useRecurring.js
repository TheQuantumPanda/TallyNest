import { useCallback, useEffect, useRef, useState } from 'react';
import { recurringService } from '../services/recurring';

export function useRecurring(status) {
  const [cycle, setCycle] = useState(0);
  const [state, setState] = useState({
    key: null,
    rows: [],
    pagination: null,
    error: null,
    more: false,
  });
  const generation = useRef(0),
    controller = useRef(null),
    pending = useRef(false);
  const cancel = useCallback(() => {
    ++generation.current;
    controller.current?.abort();
    pending.current = false;
  }, []);
  useEffect(() => {
    const current = ++generation.current,
      abort = new AbortController();
    controller.current = abort;
    pending.current = false;
    recurringService.list({ limit: 20, ...(status ? { status } : {}) }, abort.signal).then(
      (result) => {
        if (current === generation.current && !abort.signal.aborted)
          setState({
            key: status,
            rows: result.schedules,
            pagination: result.pagination,
            error: null,
            more: false,
          });
      },
      (error) => {
        if (current === generation.current && !abort.signal.aborted)
          setState({ key: status, rows: [], pagination: null, error, more: false });
      },
    );
    return cancel;
  }, [status, cycle, cancel]);
  const reload = useCallback(() => {
    cancel();
    setState({ key: null, rows: [], pagination: null, error: null, more: false });
    setCycle((value) => value + 1);
  }, [cancel]);
  useEffect(() => {
    window.addEventListener('focus', reload);
    return () => window.removeEventListener('focus', reload);
  }, [reload]);
  async function loadMore() {
    if (pending.current || state.key !== status || !state.pagination?.nextAfter) return;
    pending.current = true;
    const current = generation.current,
      abort = new AbortController();
    controller.current = abort;
    setState((value) => ({ ...value, more: true, error: null }));
    try {
      const result = await recurringService.list(
        { limit: 20, ...(status ? { status } : {}), after: state.pagination.nextAfter },
        abort.signal,
      );
      if (current !== generation.current || abort.signal.aborted) return;
      setState((value) => {
        const ids = new Set(value.rows.map((row) => row.id));
        const rows = [...value.rows];
        for (const row of result.schedules)
          if (!ids.has(row.id)) {
            ids.add(row.id);
            rows.push(row);
          }
        return { key: status, rows, pagination: result.pagination, error: null, more: false };
      });
    } catch (error) {
      if (current === generation.current && !abort.signal.aborted)
        setState((value) => ({ ...value, error, more: false }));
    } finally {
      if (current === generation.current) pending.current = false;
    }
  }
  return {
    rows: state.key === status ? state.rows : [],
    pagination: state.key === status ? state.pagination : null,
    loading: state.key !== status,
    more: state.key === status && state.more,
    error: state.key === status ? state.error : null,
    loadMore,
    reload,
  };
}
