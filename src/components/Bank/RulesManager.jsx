import { useState } from 'react';
import { Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import Button from '../Shared/Button.jsx';
import CategoryBadge from '../Costs/CategoryBadge.jsx';
import EmptyState from '../Shared/EmptyState.jsx';
import { useBankRules } from '../../context/BankRulesContext.jsx';
import { useCosts } from '../../context/CostContext.jsx';
import { countRuleMatches } from '../../utils/bankRulesEngine.js';
import { CATEGORIES, CATEGORY_KEYS } from '../../utils/constants.js';
import styles from './RulesManager.module.css';

/**
 * FF-2 Phase B — founder-editable categorization rules. Plain language only
 * ("if a transaction contains X → category Y"); never exposes regex. Built-in
 * keyword rules still apply underneath as a fallback.
 */
export default function RulesManager() {
  const { rules, loading, addRule, updateRule, deleteRule } = useBankRules();
  const { costs } = useCosts();
  const [contains, setContains] = useState('');
  const [category, setCategory] = useState('fixed');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // "test a rule" sample = existing cost names + notes (bank costs store the raw desc in notes).
  const sample = costs.map((c) => `${c.name || ''} ${c.notes || ''}`);

  async function handleAdd(e) {
    e.preventDefault();
    if (!contains.trim()) return;
    setBusy(true); setError(null);
    try {
      await addRule({ contains, category });
      setContains('');
    } catch (err) { setError(err.message); }
    setBusy(false);
  }

  async function move(rule, dir) {
    const idx = rules.findIndex((r) => r._docId === rule._docId);
    const swap = rules[idx + dir];
    if (!swap) return;
    // swap priorities
    await updateRule(rule._docId, { priority: swap.priority ?? (idx + dir + 1) });
    await updateRule(swap._docId, { priority: rule.priority ?? (idx + 1) });
  }

  return (
    <div className={styles.wrap}>
      <p className={styles.intro}>
        Your rules run <strong>before</strong> the built-in keyword matching. If a transaction&rsquo;s
        description contains your text, it gets your category. Everything else still uses the
        built-in Greek/English keywords.
      </p>

      <form className={styles.addRow} onSubmit={handleAdd}>
        <span className={styles.addLabel}>If it contains</span>
        <input
          className={styles.input}
          value={contains}
          onChange={(e) => setContains(e.target.value)}
          placeholder="e.g. ANTHROPIC, STARLINK, ΔΕΗ"
          aria-label="Text to match"
        />
        <span className={styles.addLabel}>→</span>
        <select className={styles.select} value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
          {CATEGORY_KEYS.map((k) => <option key={k} value={k}>{CATEGORIES[k].label}</option>)}
        </select>
        <Button variant="primary" size="sm" type="submit" disabled={busy || !contains.trim()}>
          <Plus size={14} /> Add rule
        </Button>
      </form>
      {error && <div className={styles.errorBox}>{error}</div>}

      {loading ? (
        <p className={styles.muted}>Loading rules…</p>
      ) : rules.length === 0 ? (
        <EmptyState
          title="No custom rules yet"
          description="The built-in keyword rules are doing the work."
        />
      ) : (
        <ul className={styles.list}>
          {rules.map((r, i) => {
            const matches = countRuleMatches(r, sample);
            return (
              <li key={r._docId} className={styles.ruleRow}>
                <div className={styles.reorder}>
                  <button className={styles.iconBtn} onClick={() => move(r, -1)} disabled={i === 0} aria-label="Move up"><ArrowUp size={13} /></button>
                  <button className={styles.iconBtn} onClick={() => move(r, 1)} disabled={i === rules.length - 1} aria-label="Move down"><ArrowDown size={13} /></button>
                </div>
                <span className={styles.ruleText}>contains &ldquo;<strong>{r.contains}</strong>&rdquo;</span>
                <span className={styles.arrow}>→</span>
                <CategoryBadge category={r.category} />
                <span className={styles.matchCount} title="Matches in your current cost history">
                  matches {matches}
                </span>
                <button className={styles.deleteBtn} onClick={() => deleteRule(r._docId)} aria-label="Delete rule"><Trash2 size={14} /></button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
