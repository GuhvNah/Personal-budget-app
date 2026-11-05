import { useState } from 'react';
import * as db from '../lib/db';
import { newId } from '../lib/id';
import { planRetro, retroSource } from '../lib/retro';
import { suggestPattern } from '../lib/categorise';
import { hasMerchant, type MatchBy } from '../lib/retro';
import { merchantKeys } from '../lib/suggest';
import type { Category } from '../lib/types';
import { Sheet } from './ui';

export interface ApplyChoice {
  /** Update existing matching transactions (not ones you categorised yourself). */
  applyExisting: boolean;
  /** Rule text to create, or null for no rule. */
  rule: string | null;
  /** What "matching" means for the update: the rule's text if creating one, else the merchant. */
  by: MatchBy;
}

/**
 * Shown after you choose a category for a transaction (or add a rule):
 * - Update existing transactions from the same merchant / matching the rule (on by default)
 * - Also create a rule (off by default)
 */
export function ApplySheet({
  description,
  category,
  plan,
  onConfirm,
  onClose,
}: {
  description: string;
  category: Category;
  /** How many existing transactions would change, and how many of yours would be left alone. */
  plan(by: MatchBy): { change: number; skipped: number };
  onConfirm(choice: ApplyChoice): void | Promise<void>;
  onClose(): void;
}) {
  const merchantOk = hasMerchant(description);
  const [applyExisting, setApplyExisting] = useState(true);
  // With no recognisable merchant, matching others needs a rule.
  const [makeRule, setMakeRule] = useState(!merchantOk);
  const [pattern, setPattern] = useState(() => suggestPattern(description));
  const p = pattern.trim();
  const ruleValid = p.length >= 2 && description.toLowerCase().includes(p.toLowerCase());
  const by: MatchBy | null = makeRule ? (ruleValid ? { pattern: p } : null) : merchantOk ? { merchantOf: description } : null;
  const counts = by ? plan(by) : { change: 0, skipped: 0 };
  const merchant = merchantKeys(description)?.key;
  const what = makeRule ? `matching “${p}”` : `from ${merchant}`;
  const [busy, setBusy] = useState(false);

  return (
    <Sheet
      title="Apply to other transactions?"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Skip
          </button>
          <button
            className="btn primary grow"
            disabled={busy || (makeRule && !ruleValid)}
            onClick={async () => {
              setBusy(true);
              await onConfirm({
                applyExisting: applyExisting && !!by && counts.change > 0,
                rule: makeRule && ruleValid ? p : null,
                by: by ?? { pattern: p },
              });
              onClose();
            }}
          >
            {applyExisting && counts.change > 0
              ? `Update ${counts.change}${makeRule ? ' + create rule' : ''}`
              : makeRule
                ? 'Create rule'
                : 'Done'}
          </button>
        </>
      }
    >
      <p>
        Set to <b>{category.name}</b>: <span className="muted">{description}</span>
      </p>

      <label className="switch-row">
        <input type="checkbox" role="switch" checked={applyExisting} onChange={(e) => setApplyExisting(e.target.checked)} />
        <span>
          <b>Update existing transactions {by ? what : ''}</b>
          <small>
            {!by
              ? makeRule
                ? 'Enter text from the description to match.'
                : "Can't tell the merchant from this description – create a rule to match others."
              : counts.change === 0
                ? `No other transactions to change${counts.skipped ? ` (${counts.skipped} you chose yourself are left as they are)` : ''}.`
                : `${counts.change} will change to ${category.name}${counts.skipped ? ` · ${counts.skipped} you chose yourself are left as they are` : ''}.`}
          </small>
        </span>
      </label>

      <label className="switch-row">
        <input type="checkbox" role="switch" checked={makeRule} onChange={(e) => setMakeRule(e.target.checked)} />
        <span>
          <b>Also create a rule</b>
          <small>Future transactions containing the text go straight to {category.name}.</small>
        </span>
      </label>
      {makeRule && (
        <label className="field">
          <span>Description contains</span>
          <input value={pattern} onChange={(e) => setPattern(e.target.value)} autoCapitalize="characters" />
          {!ruleValid && p.length >= 2 && <small className="hint warn">This text doesn't appear in the description.</small>}
        </label>
      )}
    </Sheet>
  );
}

/**
 * Save an ApplyChoice against stored transactions: create the rule (if any)
 * and move matching transactions that you didn't categorise yourself.
 * Returns how many transactions changed.
 */
export async function commitChoice(
  choice: ApplyChoice,
  categoryId: string,
  excludeId?: string,
): Promise<number> {
  if (choice.rule) {
    await db.putRule({ id: newId(), pattern: choice.rule, categoryId, createdAt: Date.now() });
  }
  if (!choice.applyExisting) return 0;
  const { transactions } = await db.loadAll();
  const { change } = planRetro(transactions, choice.by, categoryId, (t) => t.id === excludeId);
  await db.putTransactions(change.map((t) => ({ ...t, categoryId, categorySource: retroSource(choice.by) })));
  return change.length;
}

/** "Updated 3 transactions · rule created" style summary. */
export function choiceSummary(changed: number, rule: string | null, other = true): string {
  const parts = [];
  if (changed) parts.push(`Updated ${changed}${other ? ' other' : ''} transaction${changed === 1 ? '' : 's'}`);
  if (rule) parts.push(`rule “${rule}” created`);
  const s = parts.join(' · ');
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}
