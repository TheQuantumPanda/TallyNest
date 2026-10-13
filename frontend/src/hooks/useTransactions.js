import { useCallback, useEffect, useRef, useState } from 'react';
import { transactionService } from '../services/transactions';

export function useDebouncedValue(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
export function useTransactions(query, enabled) {
  const key = JSON.stringify(query);
  const [cycle, setCycle] = useState(0);
  const [state, setState] = useState({
    key: null,
    rows: [],
    pagination: null,
    error: null,
    more: false,
  });
  const generation = useRef(0);
  const controller = useRef(null);
  const pending = useRef(false);
  const cancel = useCallback(() => {
    ++generation.current;
    controller.current?.abort();
    pending.current = false;
  }, []);
  useEffect(() => {
    const current = ++generation.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    pending.current = false;
    if (enabled)
      transactionService.list(JSON.parse(key), abort.signal).then(
        (result) => {
          if (current === generation.current)
            setState({
              key,
              rows: result.transactions,
              pagination: result.pagination,
              error: null,
              more: false,
            });
        },
        (error) => {
          if (current === generation.current && !abort.signal.aborted)
            setState({ key, rows: [], pagination: null, error, more: false });
        },
      );
    return cancel;
  }, [key, enabled, cycle, cancel]);
  const reload = useCallback(() => {
    ++generation.current;
    controller.current?.abort();
    pending.current = false;
    setState({ key: null, rows: [], pagination: null, error: null, more: false });
    setCycle((value) => value + 1);
  }, []);
  async function loadMore() {
    if (!enabled || pending.current || state.key !== key || !state.pagination?.nextCursor) return;
    pending.current = true;
    const current = generation.current;
    const abort = new AbortController();
    controller.current = abort;
    setState((value) => ({ ...value, more: true, error: null }));
    try {
      const result = await transactionService.list(
        { ...query, cursor: state.pagination.nextCursor },
        abort.signal,
      );
      if (current !== generation.current) return;
      setState((value) => {
        const ids = new Set(value.rows.map((row) => row.id));
        return {
          key,
          rows: [...value.rows, ...result.transactions.filter((row) => !ids.has(row.id))],
          pagination: result.pagination,
          error: null,
          more: false,
        };
      });
    } catch (error) {
      if (current === generation.current && !abort.signal.aborted)
        setState((value) => ({ ...value, error, more: false }));
    } finally {
      if (current === generation.current) pending.current = false;
    }
  }
  const matching = state.key === key;
  return {
    rows: matching && enabled ? state.rows : [],
    pagination: matching ? state.pagination : null,
    error: matching ? state.error : null,
    loading: enabled && !matching,
    more: matching && state.more,
    reload,
    loadMore,
  };
}
