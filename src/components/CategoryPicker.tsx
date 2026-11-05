import type { Suggestion } from '../lib/suggest';
import type { Category, CategorySource } from '../lib/types';
import { CategorySelect, Icon } from './ui';

/**
 * Category control with the app's suggestion built in:
 * - uncategorised with a suggestion: "Suggested: X" + Approve, or pick another
 * - auto-categorised: the dropdown plus a small "auto" tag explaining why
 */
export function CategoryPicker({
  categories,
  value,
  source,
  suggestion,
  onApprove,
  onChange,
  placeholder = 'Uncategorised',
}: {
  categories: Category[];
  value: string | null;
  source?: CategorySource;
  suggestion: Suggestion | null;
  onApprove(categoryId: string): void;
  onChange(categoryId: string | null): void;
  /** Label for "no category" when there's no suggestion. */
  placeholder?: string;
}) {
  const suggested = !value && suggestion ? categories.find((c) => c.id === suggestion.categoryId) : undefined;
  const auto =
    value && (source === 'auto' || source === 'rule' || source === 'transfer') && suggestion?.categoryId === value
      ? suggestion
      : null;
  return (
    <div className="picker">
      {suggested && (
        <div className="suggestion">
          <span className="suggestion-text">
            <span>
              Suggested: <b>{suggested.name}</b>
            </span>
            <small>{suggestion!.reason}</small>
          </span>
          <button className="btn small primary" onClick={() => onApprove(suggested.id)} aria-label={`Approve ${suggested.name}`}>
            <Icon name="check" size={18} /> Approve
          </button>
        </div>
      )}
      <div className="picker-row">
        <CategorySelect
          categories={categories}
          value={value}
          onChange={onChange}
          noneLabel={suggested ? 'Or choose a different category…' : placeholder}
        />
      </div>
      {auto && (
        <span className="auto-tag">
          <span className="tag">{auto.source === 'auto' ? 'auto' : auto.source}</span> {auto.reason}
        </span>
      )}
    </div>
  );
}
