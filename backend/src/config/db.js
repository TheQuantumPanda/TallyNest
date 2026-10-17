import mongoose from 'mongoose';

export async function connectDB(mongoUri) {
  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 10000,
    autoCreate: false,
    autoIndex: false,
  });
}

export async function disconnectDB() {
  await mongoose.disconnect();
}
