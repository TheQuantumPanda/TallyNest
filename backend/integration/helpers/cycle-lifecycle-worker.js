import mongoose from 'mongoose';
import { createCycleLifecycleService } from '../../src/services/cycle-lifecycle.service.js';
import { ownerA } from '../../tests/helpers/transaction-api.js';
const database = process.env.TALLYNEST_LIFECYCLE_DB;
if (!/^tallynest_lifecycle_test_\d+_[a-f0-9]{12}$/.test(database ?? ''))
  throw new Error('Disposable database required');
await mongoose.connect(`mongodb://127.0.0.1:27017/${database}`);
try {
  const api = createCycleLifecycleService({
    internalEnabled: true,
    fault: async (stage) => {
      if (process.env.TALLYNEST_LIFECYCLE_MODE === 'interrupt' && stage === 'after_cycle_write') {
        process.send({ stage });
        await new Promise(() => {});
      }
    },
  });
  if (process.env.TALLYNEST_LIFECYCLE_MODE === 'recover')
    await api.recover(ownerA, process.env.TALLYNEST_LIFECYCLE_GROUP);
  else
    await api.openNext(
      ownerA,
      process.env.TALLYNEST_LIFECYCLE_GROUP,
      JSON.parse(process.env.TALLYNEST_LIFECYCLE_REQUEST),
    );
} finally {
  await mongoose.disconnect();
  if (process.connected) process.disconnect();
}
