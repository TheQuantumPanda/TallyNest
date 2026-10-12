import { describe, expect, it } from 'vitest';
import { validateAuth } from '../utils/validation';

const valid = {
  name: ' Alex Rivera ',
  email: ' ALEX@EXAMPLE.COM ',
  password: 'correct horse battery',
};
describe('auth validation matches backend requirements', () => {
  it('normalizes name and email but preserves the password', () => {
    expect(validateAuth('register', valid).data).toEqual({
      name: 'Alex Rivera',
      email: 'alex@example.com',
      password: valid.password,
    });
  });
  it.each([
    ['name', ' '],
    ['name', 'a'.repeat(101)],
    ['email', 'invalid'],
    ['email', 'a'.repeat(250) + '@example.com'],
    ['password', 'short'],
    ['password', '😀'.repeat(6)],
    ['password', '😀'.repeat(19)],
    ['password', 'a'.repeat(73)],
  ])('rejects invalid %s input', (key, value) => {
    expect(validateAuth('register', { ...valid, [key]: value }).errors[key]).toBeTruthy();
  });
  it('accepts exactly 12 Unicode characters within the byte limit', () => {
    expect(validateAuth('register', { ...valid, password: '😀'.repeat(12) }).data).not.toBeNull();
  });
  it('requires a nonempty login password without imposing registration minimum length', () => {
    expect(
      validateAuth('login', { email: valid.email, password: '' }).errors.password,
    ).toBeTruthy();
    expect(validateAuth('login', { email: valid.email, password: 'short' }).data).not.toBeNull();
  });
});
