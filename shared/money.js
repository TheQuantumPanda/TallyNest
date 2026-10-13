import { CURRENCIES, DEFAULT_CURRENCY } from './transaction.constants.js';

function currencyDefinition(currency) {
  if (typeof currency !== 'string' || !Object.hasOwn(CURRENCIES, currency))
    throw new RangeError('Unsupported currency');
  return CURRENCIES[currency];
}

function safeMinor(amountMinor) {
  if (!Number.isSafeInteger(amountMinor))
    throw new RangeError('Amount must be a safe integer in minor units');
}

// Decimal input is text, never a floating-point major-unit number. No rounding.
// Zero is useful for display; transaction validation separately requires > 0.
export function majorToMinor(amount, currency = DEFAULT_CURRENCY) {
  const { minorDigits } = currencyDefinition(currency);
  if (typeof amount !== 'string' || !/^(0|[1-9]\d*)(\.\d+)?$/.test(amount) || amount.length > 32) {
    throw new TypeError('Amount must be an unsigned decimal string');
  }
  const [whole, fraction = ''] = amount.split('.');
  if (fraction.length > minorDigits) throw new RangeError('Unsupported monetary precision');
  const minor =
    BigInt(whole) * 10n ** BigInt(minorDigits) + BigInt(fraction.padEnd(minorDigits, '0'));
  if (minor > BigInt(Number.MAX_SAFE_INTEGER))
    throw new RangeError('Amount exceeds safe integer range');
  return Number(minor);
}

export function minorToMajor(amountMinor, currency = DEFAULT_CURRENCY) {
  const { minorDigits } = currencyDefinition(currency);
  safeMinor(amountMinor);
  const value = BigInt(amountMinor);
  const absolute = value < 0n ? -value : value;
  const scale = 10n ** BigInt(minorDigits);
  return `${value < 0n ? '-' : ''}${absolute / scale}.${String(absolute % scale).padStart(minorDigits, '0')}`;
}

// Deliberately locale-independent: stable output on every host.
export function formatMoney(amountMinor, currency = DEFAULT_CURRENCY) {
  const { symbol } = currencyDefinition(currency);
  const decimal = minorToMajor(amountMinor, currency);
  return decimal.startsWith('-') ? `-${symbol}${decimal.slice(1)}` : `${symbol}${decimal}`;
}
