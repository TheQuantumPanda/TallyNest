import { User } from '../models/user.model.js';

export const userRepository = {
  findByEmail(email) {
    return User.findOne({ email }).exec();
  },
  findByEmailWithPassword(email) {
    return User.findOne({ email }).select('+passwordHash').exec();
  },
  findById(id) {
    return User.findById(id).exec();
  },
  create(data) {
    return User.create(data);
  },
};

export async function ensureUserIndexes() {
  // Await creation before registration traffic, including first startup.
  await User.init();
}
