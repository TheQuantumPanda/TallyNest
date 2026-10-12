import mongoose from 'mongoose';

function hidePassword(_doc, value) {
  delete value.passwordHash;
  delete value.__v;
  return value;
}

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
  // Hashing is owned by the password service; plaintext never reaches the model.
  passwordHash: { type: String, required: true, select: false,
    match: /^\$2[ab]\$12\$[./A-Za-z0-9]{53}$/ },
}, {
  timestamps: true,
  toJSON: { transform: hidePassword },
  toObject: { transform: hidePassword },
});

userSchema.index({ email: 1 }, { unique: true });

export const User = mongoose.model('User', userSchema);
