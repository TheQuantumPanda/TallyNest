import { TRANSACTION_CATEGORIES } from '../constants/transaction.constants.js';

// Convert through Int64, not directly from double to Decimal128: retain all safe
// integer digits. Integrity checking must reject any input conversion truncates.
export function exactMoneyStage() {
  return { $set: { money: { $convert: {
    input: { $convert: { input: '$amountMinor', to: 'long', onError: null, onNull: null } },
    to: 'decimal', onError: null, onNull: null,
  } } } };
}
export function validMoneyExpressions() {
  return [
    { $isNumber: '$amountMinor' }, { $gte: ['$amountMinor', 1] },
    { $lte: ['$amountMinor', Number.MAX_SAFE_INTEGER] },
    { $eq: ['$amountMinor', { $convert: { input: '$money', to: 'double', onError: null, onNull: null } }] },
  ];
}
export function validCategoryExpression(type) {
  return { $and: [
    { $eq: ['$type', type] },
    { $in: ['$category', TRANSACTION_CATEGORIES.filter(category => category.types.includes(type)).map(category => category.id)] },
  ] };
}
