import mongoose from 'mongoose';
// A direct probe precedes Mongoose initialization so startup cannot replace staged validators.
export async function assertNoCycleMaintenance(uri) {
  const client = new mongoose.mongo.MongoClient(uri, {
    serverSelectionTimeoutMS: 10000,
    appName: 'tallynest-startup-check',
  });
  try {
    await client.connect();
    if (await client.db().collection('cyclemigrationruns').findOne({ offlineHeld: true }))
      throw new Error('Offline settlement-cycle maintenance is held');
  } finally {
    await client.close();
  }
}
