import { useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff, AlertTriangle, RefreshCw } from 'lucide-react';
import Button from '../Shared/Button.jsx';
import CategoryBadge from '../Costs/CategoryBadge.jsx';
import IngestSummary from '../PME/ingest/IngestSummary.jsx';
import { useCosts } from '../../context/CostContext.jsx';
import { useBankRules } from '../../context/BankRulesContext.jsx';
import { inferCategoryFromText, buildRules } from '../../utils/bankRulesEngine.js';
import { CATEGORIES, CATEGORY_KEYS } from '../../utils/constants.js';
import { formatEUR, formatDate } from '../../utils/formatters.js';
import styles from './BankReviewTable.module.css';

/**
 * FF-2 — the review table. One row per transaction; debits become cost entries
 * (inline-editable category, bulk-categorize, needs-attention filter), credits are
 * shown read-only for reconciliation. Commit writes the selected debits via
 * CostContext.importBankCosts (deduped by bank transaction id).
 */
export default function BankReviewTable({ result, onBack, onCommitted }) {
  const { costs, importBankCosts } = useCosts();
  const { rules } = useBankRules();

  // Effective categorization: re-run the engine with the founder's org rules
  // (priority) + built-in defaults, matching on description + branch code.
  const effective = useMemo(() => {
    const all = buildRules(rules);
    const map = {};
    for (const r of result.rows) {
      map[r._bankTxId] = inferCategoryFromText(`${r.rawDesc} ${r.branch || ''}`, all);
    }
    return map;
  }, [result, rules]);

  const existingTxIds = useMemo(
    () => new Set(costs.filter((c) => c._bankTxId).map((c) => c._bankTxId)),
    [costs],
  );

  const debits = useMemo(() => result.rows.filter((r) => r.direction === 'debit'), [result]);
  const credits = useMemo(() => result.rows.filter((r) => r.direction === 'credit'), [result]);
  const newDebits = useMemo(() => debits.filter((r) => !existingTxIds.has(r._bankTxId)), [debits, existingTxIds]);
  const alreadyImported = debits.length - newDebits.length;

  const [overrides, setOverrides] = useState({});            // _bankTxId → category
  const [selected, setSelected] = useState(() => new Set(newDebits.map((r) => r._bankTxId)));
  const [showRaw, setShowRaw] = useState(false);
  const [attnOnly, setAttnOnly] = useState(false);
  const [bulkCat, setBulkCat] = useState('');
  const [committing, setCommitting] = useState(false);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);

  // Reconcile selection whenever costs finish loading after mount.
  // The lazy useState initializer above only runs once; if CostContext resolves
  // after the first render, existingTxIds (and therefore newDebits) changes and
  // already-imported rows must be deselected. The write path deduplicates by
  // _bankTxId so this is a UI-only correctness fix.
  useEffect(() => {
    setSelected(new Set(newDebits.map((r) => r._bankTxId)));
  }, [newDebits]);

  const catOf = (r) => overrides[r._bankTxId] ?? effective[r._bankTxId]?.category ?? r.category;
  const matchedOf = (r) => effective[r._bankTxId]?.matched ?? r.matched;
  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const visibleDebits = attnOnly ? debits.filter((r) => !matchedOf(r)) : debits;
  const attnCount = debits.filter((r) => !matchedOf(r)).length;

  function applyBulk() {
    if (!bulkCat) return;
    setOverrides((o) => {
      const next = { ...o };
      selected.forEach((id) => { next[id] = bulkCat; });
      return next;
    });
  }

  async function handleCommit() {
    setCommitting(true);
    setError(null);
    try {
      const rows = debits
        .filter((r) => selected.has(r._bankTxId))
        .map((r) => ({ ...r, category: catOf(r) }));
      const res = await importBankCosts(rows);
      setSummary({ ...res, label: 'transactions' });
      onCommitted?.(res);
    } catch (err) {
      setError(`Import failed: ${err.message}`);
    }
    setCommitting(false);
  }

  if (summary) {
    return (
      <div className={styles.wrap}>
        <h3 className={styles.doneTitle}>Import complete</h3>
        <IngestSummary result={summary} />
        <div className={styles.actions}>
          <Button variant="secondary" size="sm" onClick={onBack}>Import another file</Button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      {/* Toolbar */}
      <div className={styles.toolbar}>
        <div className={styles.counts}>
          <strong>{newDebits.length}</strong> new
          {alreadyImported > 0 && <> · <span className={styles.muted}>{alreadyImported} already imported</span></>}
          {credits.length > 0 && <> · <span className={styles.income}>{credits.length} income (read-only)</span></>}
        </div>
        <div className={styles.tools}>
          <button className={styles.toolBtn} onClick={() => setShowRaw((v) => !v)} title="Toggle raw bank text">
            {showRaw ? <EyeOff size={14} /> : <Eye size={14} />} {showRaw ? 'Cleaned' : 'Raw'}
          </button>
          <button
            className={`${styles.toolBtn} ${attnOnly ? styles.toolBtnActive : ''}`}
            onClick={() => setAttnOnly((v) => !v)}
            disabled={attnCount === 0}
            title="Show only rows no rule matched"
          >
            <AlertTriangle size={14} /> Needs attention{attnCount > 0 ? ` (${attnCount})` : ''}
          </button>
        </div>
      </div>

      {/* Bulk categorize */}
      <div className={styles.bulkRow}>
        <span className={styles.muted}>{selected.size} selected</span>
        <select className={styles.select} value={bulkCat} onChange={(e) => setBulkCat(e.target.value)}>
          <option value="">Bulk set category…</option>
          {CATEGORY_KEYS.map((k) => <option key={k} value={k}>{CATEGORIES[k].label}</option>)}
        </select>
        <Button variant="secondary" size="sm" onClick={applyBulk} disabled={!bulkCat || selected.size === 0}>Apply</Button>
      </div>

      {/* Debit rows */}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.cbCol}></th>
              <th>Date</th>
              <th>Description</th>
              <th>Branch</th>
              <th className={styles.right}>Amount</th>
              <th>Category</th>
            </tr>
          </thead>
          <tbody>
            {visibleDebits.map((r) => {
              const dup = existingTxIds.has(r._bankTxId);
              return (
                <tr key={r._bankTxId} className={dup ? styles.dupRow : ''}>
                  <td className={styles.cbCol}>
                    <input type="checkbox" checked={selected.has(r._bankTxId)} onChange={() => toggle(r._bankTxId)} />
                  </td>
                  <td className={styles.nowrap}>{formatDate(r.date)}</td>
                  <td>
                    <span className={styles.desc}>{showRaw ? r.rawDesc : (r.cleanDesc || r.rawDesc)}</span>
                    {!matchedOf(r) && <span className={styles.ruleFlag} title="No rule matched — please confirm">~rule</span>}
                    {dup && <span className={styles.dupFlag}>already imported</span>}
                  </td>
                  <td className={styles.muted}>{r.branch || '—'}</td>
                  <td className={`${styles.right} ${styles.debit}`}>−{formatEUR(Math.abs(r.amount))}</td>
                  <td>
                    <div className={styles.catCell}>
                      <CategoryBadge category={catOf(r)} />
                      <select
                        className={styles.catSelect}
                        value={catOf(r)}
                        onChange={(e) => setOverrides((o) => ({ ...o, [r._bankTxId]: e.target.value }))}
                        aria-label="Change category"
                      >
                        {CATEGORY_KEYS.map((k) => <option key={k} value={k}>{CATEGORIES[k].label}</option>)}
                      </select>
                    </div>
                  </td>
                </tr>
              );
            })}
            {visibleDebits.length === 0 && (
              <tr><td colSpan={6} className={styles.emptyCell}>No transactions to show.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Credits (read-only) */}
      {credits.length > 0 && !attnOnly && (
        <details className={styles.credits}>
          <summary>{credits.length} incoming (income — not imported)</summary>
          <table className={styles.table}>
            <tbody>
              {credits.map((r) => (
                <tr key={r._bankTxId} className={styles.creditRow}>
                  <td className={styles.cbCol}></td>
                  <td className={styles.nowrap}>{formatDate(r.date)}</td>
                  <td><span className={styles.desc}>{showRaw ? r.rawDesc : (r.cleanDesc || r.rawDesc)}</span></td>
                  <td className={styles.muted}>{r.branch || '—'}</td>
                  <td className={`${styles.right} ${styles.credit}`}>+{formatEUR(Math.abs(r.amount))}</td>
                  <td><span className={styles.incomeBadge}>income</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      {error && <div className={styles.errorBox}>{error}</div>}

      <div className={styles.actions}>
        <Button variant="secondary" size="sm" onClick={onBack}>Back</Button>
        <Button variant="primary" size="sm" onClick={handleCommit} disabled={committing || selected.size === 0}>
          {committing ? <><RefreshCw size={13} className={styles.spin} /> Importing…</> : `Import ${selected.size} as costs`}
        </Button>
      </div>
    </div>
  );
}
