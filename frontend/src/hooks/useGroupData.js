import { useCallback, useEffect, useRef, useState } from 'react';
export function useGroupResource(key, load, revision = 0) {
  const [cycle, setCycle] = useState(0),
    [state, setState] = useState({
      key: null,
      revision: null,
      data: null,
      error: null,
      loading: true,
    });
  const abort = useRef(null),
    generation = useRef(0);
  const reload = useCallback(() => {
    ++generation.current;
    abort.current?.abort();
    setState((s) => ({ ...s, loading: true, error: null }));
    setCycle((c) => c + 1);
  }, []);
  useEffect(() => {
    const controller = new AbortController(),
      current = ++generation.current;
    abort.current = controller;
    load(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted && current === generation.current)
          setState({ key, revision, data, error: null, loading: false });
      },
      (error) => {
        if (!controller.signal.aborted && current === generation.current)
          setState((s) => ({
            key,
            revision,
            data: s.key === key ? s.data : null,
            error,
            loading: false,
          }));
      },
    );
    return () => {
      controller.abort();
    };
  }, [key, load, cycle, revision]);
  return {
    data: state.key === key ? state.data : null,
    error: state.key === key ? state.error : null,
    loading: state.key !== key || state.revision !== revision || state.loading,
    reload,
  };
}
export function useGroupPage(key, load, revision = 0) {
  const [cycle, setCycle] = useState(0),
    [state, setState] = useState({
      key: null,
      revision: null,
      rows: [],
      pagination: null,
      loading: true,
      error: null,
      more: false,
    });
  const generation = useRef(0),
    controller = useRef(null),
    pending = useRef(false);
  const reload = useCallback(() => {
    ++generation.current;
    controller.current?.abort();
    pending.current = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    setCycle((c) => c + 1);
  }, []);
  const invalidate = useCallback(() => {
    ++generation.current;
    controller.current?.abort();
  }, []);
  useEffect(() => {
    const abort = new AbortController(),
      current = ++generation.current;
    controller.current = abort;
    pending.current = false;
    load({}, abort.signal).then(
      (result) => {
        if (!abort.signal.aborted && current === generation.current)
          setState({ key, revision, ...result, loading: false, error: null, more: false });
      },
      (error) => {
        if (!abort.signal.aborted && current === generation.current)
          setState({
            key,
            revision,
            rows: [],
            pagination: null,
            loading: false,
            error,
            more: false,
          });
      },
    );
    return () => {
      abort.abort();
      invalidate();
    };
  }, [key, load, revision, cycle, invalidate]);
  async function loadMore() {
    if (
      pending.current ||
      state.key !== key ||
      state.revision !== revision ||
      state.loading ||
      !state.pagination?.nextAfter
    )
      return;
    pending.current = true;
    const abort = new AbortController(),
      current = generation.current;
    controller.current = abort;
    setState((s) => ({ ...s, more: true, error: null }));
    try {
      const result = await load({ after: state.pagination.nextAfter }, abort.signal);
      if (abort.signal.aborted || current !== generation.current) return;
      setState((s) => {
        const ids = new Set(s.rows.map((row) => row.id)),
          rows = [...s.rows];
        for (const row of result.rows)
          if (!ids.has(row.id)) {
            ids.add(row.id);
            rows.push(row);
          }
        return {
          key,
          revision,
          rows,
          pagination: result.pagination,
          loading: false,
          error: null,
          more: false,
        };
      });
    } catch (error) {
      if (!abort.signal.aborted && current === generation.current)
        setState((s) => ({ ...s, more: false, error }));
    } finally {
      if (current === generation.current) pending.current = false;
    }
  }
  return {
    rows: state.key === key && state.revision === revision && !state.loading ? state.rows : [],
    pagination: state.key === key ? state.pagination : null,
    error: state.key === key ? state.error : null,
    loading: state.key !== key || state.revision !== revision || state.loading,
    more: state.key === key && state.more,
    reload,
    loadMore,
  };
}
