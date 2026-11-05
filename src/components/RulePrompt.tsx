import { useState } from 'react';
import { suggestPattern } from '../lib/categorise';
import type { Category } from '../lib/types';
import { Sheet } from './ui';

/**
 * Shown after a manual recategorise: "Always put transactions containing X in Y?"
 */
export function RulePrompt({
  description,
  category,
  countMatches,
  onCreate,
  onClose,
}: {
  description: string;
  category: Category;
  /** How many other uncategorised transactions the pattern would also apply to. */
  countMatches(pattern: string): number;
  onCreate(pattern: string, applyToOthers: boolean): void | Promise<void>;
  onClose(): void;
}) {
  const [pattern, setPattern] = useState(() => suggestPattern(description));
  const [apply, setApply] = useState(true);
  const valid = pattern.trim().length >= 2 && description.toLowerCase().includes(pattern.trim().toLowerCase());
  const n = valid ? countMatches(pattern.trim()) : 0;

  return (
    <Sheet
      title="Make this a rule?"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Not now
          </button>
          <button
            className="btn primary"
            disabled={!valid}
            onClick={async () => {
              await onCreate(pattern.trim(), apply && n > 0);
              onClose();
            }}
          >
            Create rule
          </button>
        </>
      }
    >
      <p>
        Always categorise transactions whose description contains this text as <b>{category.name}</b>:
      </p>
      <label className="field">
        <span>Description contains</span>
        <input value={pattern} onChange={(e) => setPattern(e.target.value)} autoCapitalize="characters" />
      </label>
      {!valid && pattern.trim().length >= 2 && (
        <p className="hint warn">This text doesn't appear in “{description}”.</p>
      )}
      <p className="hint">From: {description}</p>
      {n > 0 && (
        <label className="check">
          <input type="checkbox" checked={apply} onChange={(e) => setApply(e.target.checked)} />
          <span>
            Also apply to {n} other uncategorised transaction{n === 1 ? '' : 's'}
          </span>
        </label>
      )}
    </Sheet>
  );
}
