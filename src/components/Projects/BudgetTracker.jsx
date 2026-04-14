import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useCosts } from '../../context/CostContext.jsx';
import { useRevenue } from '../../context/RevenueContext.jsx';
import { useProjects } from '../../context/ProjectContext.jsx';
import { budgetFromCity } from '../../utils/budgetFromCity.js';
import { CITIES } from './constants.js';
import styles from './BudgetTracker.module.css';
import sharedStyles from './Projects.module.css';

function fmt(n) {
  return `€${Number(n || 0).toLocaleString('el-GR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function TxTable({ rows, emptyText }) {
  if (!rows.length) return <p className={styles.txEmpty}>{emptyText}</p>;
  return (
    <table className={styles.txTable}>
      <thead>
        <tr>
          <th>Date</th>
          <th>Description</th>
          <th>Amount</th>
          <th>Category</th>
          <th>Frequency</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((tx, i) => (
          <tr key={i}>
            <td>{tx.date || '—'}</td>
            <td>{tx.label}</td>
            <td style={{ color: tx.type === 'Revenue' ? '#00C896' : 'var(--color-text-primary)', fontVariantNumeric: 'tabular-nums' }}>
              {tx.type === 'Revenue' ? '+' : ''}{fmt(tx.amount)}
            </td>
            <td>{tx.category || '—'}</td>
            <td>{tx.frequency || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CollapsibleSection({ title, count, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={styles.collapsible}>
      <button className={styles.collapseToggle} onClick={() => setOpen((v) => !v)}>
        <span>{title}</span>
        {count != null && <span className={styles.collapseCount}>{count}</span>}
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {open && <div className={styles.collapseBody}>{children}</div>}
    </div>
  );
}

export default function BudgetTracker({ project }) {
  const { costs } = useCosts();
  const { revenueData } = useRevenue();
  const { updateProject } = useProjects();

  const { revenue, expenses, net, revTransactions, costTransactions } =
    budgetFromCity(costs, revenueData, project.linkedCity);

  const planned   = project.plannedBudget || 0;
  const pct       = planned > 0 ? Math.min((expenses / planned) * 100, 100) : 0;
  const barColor  = pct >= 90 ? '#E84545' : pct >= 70 ? '#F5A623' : '#00C896';
  const overBudget = planned > 0 && expenses > planned;

  return (
    <div className={styles.container}>
      {overBudget && (
        <div className={styles.overBanner}>
          ⚠ Budget exceeded — expenses surpass planned budget
        </div>
      )}

      {/* ── Stats grid ── */}
      <div className={styles.grid}>
        <div className={styles.statRow}>
          <span className={styles.statLabel}>Planned</span>
          {planned > 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className={styles.statValue}>{fmt(planned)}</span>
              <button
                className={styles.resetBudgetBtn}
                onClick={() => updateProject(project._docId, { plannedBudget: null })}
                title="Change planned budget"
              >
                Edit
              </button>
            </div>
          ) : (
            <input
              type="number"
              className={sharedStyles.input}
              style={{ width: 130 }}
              placeholder="Set budget…"
              onBlur={(e) => {
                const val = Number(e.target.value);
                if (val > 0) updateProject(project._docId, { plannedBudget: val });
              }}
            />
          )}
        </div>

        {planned > 0 && (
          <div className={styles.barRow}>
            <div className={styles.barTrack}>
              <div className={styles.barFill} style={{ width: `${pct}%`, background: barColor }} />
            </div>
            <span className={styles.barPct} style={{ color: barColor }}>{Math.round(pct)}%</span>
          </div>
        )}

        <div className={styles.statRow}>
          <span className={styles.statLabel}>
            Revenue
            {!project.linkedCity && <span className={styles.statHint}> — link a city to see actuals</span>}
          </span>
          <span className={styles.statValue} style={{ color: '#00C896' }}>{fmt(revenue)}</span>
        </div>

        <div className={styles.statRow}>
          <span className={styles.statLabel}>
            Expenses
            <span className={styles.statHint}> — all fleet costs</span>
          </span>
          <span className={styles.statValue} style={{
            color: pct >= 90 ? '#E84545' : pct >= 70 ? '#F5A623' : 'var(--color-text-primary)',
          }}>
            {fmt(expenses)}
          </span>
        </div>

        <div className={`${styles.statRow} ${styles.netRow}`}>
          <span className={styles.statLabel}>Net</span>
          <span className={styles.statValue} style={{ color: net >= 0 ? '#00C896' : '#E84545', fontWeight: 700 }}>
            {fmt(net)}
          </span>
        </div>
      </div>

      {/* ── Data source + notes ── */}
      <div className={styles.configRow}>
        <div className={styles.cityRow}>
          <span className={styles.cityLabel}>Revenue source:</span>
          <select
            className={sharedStyles.select}
            style={{ width: 'auto' }}
            value={project.linkedCity || ''}
            onChange={(e) => updateProject(project._docId, { linkedCity: e.target.value || null })}
          >
            <option value="">No city linked</option>
            {CITIES.filter(Boolean).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <textarea
        className={sharedStyles.input}
        style={{ resize: 'vertical', minHeight: 56 }}
        placeholder="Budget notes — assumptions, caveats, forward-looking context…"
        defaultValue={project.budgetNotes || ''}
        onBlur={(e) => {
          if (e.target.value !== (project.budgetNotes || '')) {
            updateProject(project._docId, { budgetNotes: e.target.value });
          }
        }}
      />

      {/* ── Linked transactions (collapsible) ── */}
      <CollapsibleSection
        title={project.linkedCity ? `Revenue — ${project.linkedCity}` : 'Revenue transactions'}
        count={revTransactions.length}
      >
        <TxTable
          rows={revTransactions}
          emptyText={project.linkedCity
            ? `No revenue found for ${project.linkedCity}. Check that revenue rows use "${project.linkedCity}" as the location.`
            : 'Link a city above to see revenue transactions.'}
        />
      </CollapsibleSection>

      <CollapsibleSection
        title="Fleet costs"
        count={costTransactions.length}
      >
        <p className={styles.costsNote}>
          These are all costs in the Cost Manager. Costs are fleet-wide and not filtered by city — use categories and notes to understand what each line is.
        </p>
        <TxTable rows={costTransactions} emptyText="No costs found in Cost Manager." />
      </CollapsibleSection>
    </div>
  );
}
