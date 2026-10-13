import { Search, SlidersHorizontal, X } from 'lucide-react';
import { categoriesFor, categoryLabel, DEFAULT_FILTERS } from '../../utils/transactions';

export function TransactionFilters({ values, onChange, errors }) {
  function change(key, value) {
    const next = { ...values, [key]: value };
    if (
      key === 'type' &&
      next.category &&
      !categoriesFor(value).some((item) => item.id === next.category)
    )
      next.category = '';
    onChange(next);
  }
  const active = Object.entries(values).filter(([key, value]) => value !== DEFAULT_FILTERS[key]);
  return (
    <section className="transaction-filters surface" aria-label="Filter transactions">
      <div className="filter-heading">
        <span>
          <SlidersHorizontal size={16} aria-hidden="true" />
          Refine your view
        </span>
        <button
          className="text-button"
          type="button"
          onClick={() => onChange({ ...DEFAULT_FILTERS })}
          disabled={!active.length}
        >
          Reset filters
        </button>
      </div>
      <div className="filter-grid">
        <div className="filter-search">
          <label htmlFor="filter-search">Search title</label>
          <div className="search-wrap">
            <Search size={17} aria-hidden="true" />
            <input
              id="filter-search"
              value={values.search}
              onChange={(event) => change('search', event.target.value)}
              placeholder="Find a transaction…"
              maxLength={80}
            />
          </div>
        </div>
        <div>
          <label htmlFor="filter-type">Type</label>
          <select
            id="filter-type"
            value={values.type}
            onChange={(event) => change('type', event.target.value)}
          >
            <option value="">All types</option>
            <option value="income">Income</option>
            <option value="expense">Expense</option>
          </select>
        </div>
        <div>
          <label htmlFor="filter-category">Category</label>
          <select
            id="filter-category"
            value={values.category}
            onChange={(event) => change('category', event.target.value)}
          >
            <option value="">All categories</option>
            {categoriesFor(values.type).map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="filter-from">From date</label>
          <input
            type="date"
            id="filter-from"
            value={values.from}
            onChange={(event) => change('from', event.target.value)}
            aria-invalid={!!errors.from}
            aria-describedby={errors.from ? 'from-error' : undefined}
          />
          {errors.from && (
            <p className="field-error" id="from-error">
              {errors.from}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="filter-to">To date</label>
          <input
            type="date"
            id="filter-to"
            value={values.to}
            onChange={(event) => change('to', event.target.value)}
            aria-invalid={!!errors.to}
            aria-describedby={errors.to ? 'to-error' : undefined}
          />
          {errors.to && (
            <p className="field-error" id="to-error">
              {errors.to}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="filter-sort">Sort by</label>
          <select
            id="filter-sort"
            value={values.sort}
            onChange={(event) => change('sort', event.target.value)}
          >
            <option value="transactionDate:desc">Date · newest first</option>
            <option value="transactionDate:asc">Date · oldest first</option>
            <option value="amountMinor:desc">Amount · highest first</option>
            <option value="amountMinor:asc">Amount · lowest first</option>
          </select>
        </div>
      </div>
      {active.length > 0 && (
        <div className="active-filters" aria-label="Active filters">
          {active.map(([key, value]) => (
            <button
              key={key}
              type="button"
              onClick={() => change(key, DEFAULT_FILTERS[key])}
              aria-label={`Remove ${key} filter`}
            >
              <span>
                {key === 'category'
                  ? categoryLabel(value)
                  : key === 'sort'
                    ? value.replace(':', ' · ')
                    : `${key}: ${value}`}
              </span>
              <X size={12} aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
      <p className="filter-footnote">Dates use UTC. The end date is included.</p>
    </section>
  );
}
