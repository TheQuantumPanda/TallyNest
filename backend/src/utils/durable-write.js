// Standalone majority is one member; replica sets wait for majority+journal.
// Timeouts can mean an unknown commit outcome, which the engine safely retries.
export const durableWriteOptions = () => ({
  writeConcern: { w: 'majority', j: true, wtimeout: 2000 },
});
