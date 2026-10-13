export const TRANSACTION_TYPES = Object.freeze(['income', 'expense']);

export const CURRENCIES = Object.freeze({
  INR: Object.freeze({ minorDigits: 2, symbol: '₹' }),
});
export const DEFAULT_CURRENCY = 'INR';

// A single definition supplies both validation and future display labels.
export const TRANSACTION_CATEGORIES = Object.freeze(
  [
    ['food_dining', 'Food & Dining', ['expense']],
    ['shopping', 'Shopping', ['expense']],
    ['transportation', 'Transportation', ['expense']],
    ['housing', 'Housing', ['expense']],
    ['utilities', 'Utilities', ['expense']],
    ['healthcare', 'Healthcare', ['expense']],
    ['education', 'Education', ['expense']],
    ['entertainment', 'Entertainment', ['expense']],
    ['subscriptions', 'Subscriptions', ['expense']],
    ['travel', 'Travel', ['expense']],
    ['salary', 'Salary', ['income']],
    ['freelance', 'Freelance', ['income']],
    ['business', 'Business', ['income']],
    ['investments', 'Investments', ['income']],
    ['gifts', 'Gifts', ['income']],
    ['other', 'Other', ['income', 'expense']],
  ].map(([id, label, types]) => Object.freeze({ id, label, types: Object.freeze(types) })),
);

export function isCategoryForType(categoryId, type) {
  return TRANSACTION_CATEGORIES.some(
    (category) => category.id === categoryId && category.types.includes(type),
  );
}
