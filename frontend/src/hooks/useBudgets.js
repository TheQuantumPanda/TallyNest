import { useCallback, useEffect, useRef, useState } from 'react';
import { budgetService } from '../services/budgets';
import { monthSchema } from '../utils/budgets';

export function useBudgets(month) {
  const [cycle, setCycle] = useState(0);
  const [state, setState] = useState({ month: null, summary: null, error: null });
  const generation = useRef(0);
  const limitsController = useRef(null);
  const valid = monthSchema.safeParse(month).success;
  const cancel = useCallback(() => {
    ++generation.current;
    limitsController.current?.abort();
  }, []);
  const reload = useCallback(() => {
    cancel();
    setState({ month: null, summary: null, error: null });
    setCycle((value) => value + 1);
  }, [cancel]);
  useEffect(() => {
    const current = ++generation.current;
    const controller = new AbortController();
    if (valid)
      budgetService.summary(month, controller.signal).then(
        (summary) => {
          if (current === generation.current && !controller.signal.aborted)
            setState({ month, summary, error: null });
        },
        (error) => {
          if (current === generation.current && !controller.signal.aborted)
            setState({ month, summary: null, error });
        },
      );
    return () => {
      controller.abort();
      cancel();
    };
  }, [month, valid, cycle, cancel]);
  useEffect(() => {
    window.addEventListener('focus', reload);
    return () => window.removeEventListener('focus', reload);
  }, [reload]);
  async function reviewLimits() {
    if (!valid || (limitsController.current && !limitsController.current.signal.aborted)) return;
    const current = generation.current,
      controller = new AbortController();
    limitsController.current = controller;
    setState((previous) => ({ ...previous, limits: null, reviewing: true, limitsError: null }));
    try {
      const limits = await budgetService.list(month, controller.signal);
      if (current === generation.current && !controller.signal.aborted)
        setState((previous) => ({ ...previous, limits, reviewing: false }));
    } catch (error) {
      if (current === generation.current && !controller.signal.aborted)
        setState((previous) => ({ ...previous, reviewing: false, limitsError: error }));
    } finally {
      if (current === generation.current) limitsController.current = null;
    }
  }
  return {
    summary: valid && state.month === month ? state.summary : null,
    error: valid && state.month === month ? state.error : null,
    loading: valid && state.month !== month,
    valid,
    reload,
    reviewLimits,
    limits: state.month === month ? state.limits : null,
    reviewing: state.month === month && state.reviewing,
    limitsError: state.month === month ? state.limitsError : null,
  };
}
