import { processDueSchedules } from '../services/recurring-engine.service.js';
export function startRecurringJob({ process = processDueSchedules, intervalMs = 60000,
  report = result => console.info('Recurring batch', result) } = {}) {
  let stopped = false, timer, inFlight;
  async function tick() {
    try { const result = await process({ limit: 20 }); report(result); }
    catch { console.error('Recurring batch failed'); }
    if (!stopped) timer = setTimeout(() => { inFlight = tick(); }, intervalMs);
    timer?.unref();
  }
  inFlight = tick();
  return async () => { stopped = true; clearTimeout(timer); await inFlight; };
}
