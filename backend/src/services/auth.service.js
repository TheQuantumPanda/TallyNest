import jwt from 'jsonwebtoken';
import { userRepository } from '../repositories/user.repository.js';
import { hashPassword, verifyPassword } from './password.service.js';
import { jwtSecretSchema, jwtTtlSchema } from '../config/env.js';
import { HttpError } from '../utils/httpError.js';

const issuer = 'smart-finance-manager';
const audience = 'smart-finance-manager-web';

export function toPublicUser(user) {
  return {
    id: String(user._id), name: user.name, email: user.email,
    createdAt: user.createdAt, updatedAt: user.updatedAt,
  };
}

export function createAuthService({ repository = userRepository, jwtSecret, jwtTtlSeconds = 900 }) {
  function requireConfig() {
    if (!jwtSecretSchema.safeParse(jwtSecret).success
      || !jwtTtlSchema.safeParse(jwtTtlSeconds).success) {
      throw new HttpError(503, 'Authentication is unavailable');
    }
  }

  function session(user) {
    return {
      user: toPublicUser(user),
      token: jwt.sign({}, jwtSecret, {
        algorithm: 'HS256', expiresIn: Number(jwtTtlSeconds),
        subject: String(user._id), issuer, audience,
      }),
    };
  }

  return {
    async register({ name, email, password }) {
      requireConfig();
      if (await repository.findByEmail(email)) {
        throw new HttpError(409, 'An account with this email already exists');
      }
      const passwordHash = await hashPassword(password);
      let user;
      try {
        user = await repository.create({ name, email, passwordHash });
      } catch (error) {
        // The unique index is authoritative when concurrent registrations race.
        if (error.code === 11000) {
          throw new HttpError(409, 'An account with this email already exists');
        }
        throw error;
      }
      return session(user);
    },
    async login({ email, password }) {
      requireConfig();
      const user = await repository.findByEmailWithPassword(email);
      const matches = await verifyPassword(password, user?.passwordHash);
      if (!user || !matches) throw new HttpError(401, 'Invalid email or password');
      return session(user);
    },
    verifyAccessToken(token) {
      requireConfig();
      try {
        const payload = jwt.verify(token, jwtSecret, {
          algorithms: ['HS256'], issuer, audience, maxAge: Number(jwtTtlSeconds),
        });
        if (typeof payload !== 'object' || typeof payload.sub !== 'string'
          || !/^[a-fA-F0-9]{24}$/.test(payload.sub)
          || !Number.isInteger(payload.exp) || !Number.isInteger(payload.iat)) {
          throw new Error('Invalid claims');
        }
        return payload.sub;
      } catch {
        throw new HttpError(401, 'Authentication required');
      }
    },
    async getCurrentUser(id) {
      const user = await repository.findById(id);
      if (!user) throw new HttpError(401, 'Authentication required');
      return toPublicUser(user);
    },
  };
}
