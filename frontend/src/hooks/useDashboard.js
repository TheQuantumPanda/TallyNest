import { useCallback, useEffect, useRef, useState } from 'react';
import { dashboardService } from '../services/dashboard';
export function useDashboard(period) {
  const [cycle, setCycle] = useState(0);
  const [state, setState] = useState({ period: null, summary: null, error: null });
  const generation = useRef(0);
  const cancel = useCallback(() => {
    ++generation.current;
  }, []);
  useEffect(() => {
    const current = ++generation.current;
    const controller = new AbortController();
    dashboardService.summary(period, controller.signal).then(
      (summary) => {
        if (current === generation.current && !controller.signal.aborted)
          setState({ period, summary, error: null });
      },
      (error) => {
        if (current === generation.current && !controller.signal.aborted)
          setState({ period, summary: null, error });
      },
    );
    return () => {
      controller.abort();
      cancel();
    };
  }, [period, cycle, cancel]);
  const reload = useCallback(() => {
    cancel();
    setState({ period: null, summary: null, error: null });
    setCycle((value) => value + 1);
  }, [cancel]);
  useEffect(() => {
    const refresh = () => reload();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [reload]);
  return {
    summary: state.period === period ? state.summary : null,
    error: state.period === period ? state.error : null,
    loading: state.period !== period,
    reload,
  };
}
