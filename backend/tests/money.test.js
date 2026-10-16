import test from 'node:test';
import assert from 'node:assert/strict';
import { majorToMinor, minorToMajor, formatMoney } from '../src/utils/money.js';

for (const [decimal, minor] of [
  ['100.50', 10050],
  ['1.00', 100],
  ['0.01', 1],
  ['0', 0],
  ['1.2', 120],
  ['12345.67', 1234567],
  ['90071992547409.91', Number.MAX_SAFE_INTEGER],
]) {
  test(`exact conversion and round trip for ${decimal}`, () => {
    assert.equal(majorToMinor(decimal), minor);
    assert.equal(majorToMinor(minorToMajor(minor)), minor);
  });
}

for (const input of [
  '-1',
  '+1',
  '01',
  '1e2',
  '.5',
  '1.',
  '1.001',
  '1.000',
  ' 1',
  '1 ',
  '1,000',
  'NaN',
  'Infinity',
  '',
  '90071992547409.92',
  '9'.repeat(1000),
  100.5,
  NaN,
  Infinity,
  null,
  {},
  undefined,
]) {
  test(`reject ambiguous, floating, overprecise or overflowing major amount ${String(input).slice(0, 50)}`, () => {
    assert.throws(() => majorToMinor(input));
  });
}

test('stable formatting covers zero, minor units, signed display and integer boundaries', () => {
  assert.equal(formatMoney(0), '₹0.00');
  assert.equal(formatMoney(1), '₹0.01');
  assert.equal(formatMoney(10050), '₹100.50');
  assert.equal(formatMoney(-1), '-₹0.01');
  assert.equal(formatMoney(Number.MAX_SAFE_INTEGER), '₹90071992547409.91');
  assert.equal(formatMoney(Number.MIN_SAFE_INTEGER), '-₹90071992547409.91');
});

test('formatting rejects unsafe integers and implicit coercion', () => {
  for (const invalid of [
    0.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    Number.MIN_SAFE_INTEGER - 1,
    '100',
    null,
  ]) {
    assert.throws(() => minorToMajor(invalid));
    assert.throws(() => formatMoney(invalid));
  }
});

test('all utilities reject unsupported currencies', () => {
  for (const currency of [
    'USD',
    'inr',
    '',
    '__proto__',
    null,
    ['INR'],
    { toString: () => 'INR' },
  ]) {
    assert.throws(() => majorToMinor('1', currency));
    assert.throws(() => minorToMajor(100, currency));
    assert.throws(() => formatMoney(100, currency));
  }
});

test('decimal tenths combine exactly as minor units without floating-point major arithmetic', () => {
  assert.equal(majorToMinor('0.1') + majorToMinor('0.2'), majorToMinor('0.3'));
});
