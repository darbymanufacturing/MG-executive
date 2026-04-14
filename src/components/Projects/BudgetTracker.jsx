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

export default function BudgetTracker({ project }) {
  const { costs } = useCosts();
  const { revenueData } = useRevenue();
  const { updateProject } = useProjects();

  const { revenue, expenses, net, transactions } = budgetFromCity(costs, revenueData, project.linkedCity);
  const planned = project.plannedBudget || 0;
  const pct = planned > 0 ? Math.min((expenses / planned) * 100, 100) : 0;
  const barColor = pct >= 90 ? '#E84545' : pct >= 70 ? '#F5A623' : '#00C896';
  const overBudget = planned > 0 && expenses > planned;

  return (
    <div className={styles.container}>
      {overBudget && (
        <div className={styles.overBanner}>
          ⚠ Budget exceeded — expenses surpass planned budget
        </div>
      )}

      <div className={styles.grid}>
        <div className={styles.statRow}>
          <span className={styles.statLabel}>Planned</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {planned > 0 ? (
              <span className={styles.statValue}>{fmt(planned)}</span>
            ) : (
              <input
                type="number"
                className={sharedStyles.input}
                style={{ width: 120 }}
                placeholder="Set budget…"
                onBlur={(e) => {
                  const val = Number(e.target.value);
                  if (val > 0) updateProject(project._docId, { plannedBudget: val });
                }}
              />
            )}
          </div>
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
          <span className={styles.statLabel}>Revenue</span>
          <span className={styles.statValue} style={{ color: '#00C896' }}>{fmt(revenue)}</span>
        </div>
        <div className={styles.statRow}>
          <span className={styles.statLabel}>Expenses</span>
          <span className={styles.statValue} style={{ color: pct >= 90 ? '#E84545' : pct >= 70 ? '#F5A623' : 'var(--color-text-primary)' }}>
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

      {/* Linked city selector */}
      <div className={styles.cityRow}>
        <span className={styles.cityLabel}>Data source (city):</span>
        <select
          className={sharedStyles.select}
          style={{ width: 'auto' }}
          value={project.linkedCity || ''}
          onChange={(e) => updateProject(project._docId, { linkedCity: e.target.value || null })}
        >
          <option value="">None</option>
          {CITIES.filter(Boolean).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Notes */}
      <textarea
        className={sharedStyles.input}
        style={{ resize: 'vertical', minHeight: 60, marginTop: 8 }}
        placeholder="Budget notes — assumptions, caveats, forward-looking context…"
        defaultValue={project.budgetNotes || ''}
        onBlur={(e) => {
          if (e.target.value !== (project.budgetNotes || '')) {
            updateProject(project._docId, { budgetNotes: e.target.value });
          }
        }}
      />

      {/* Linked transactions */}
      {transactions.length > 0 && (
        <div className={styles.transactions}>
          <p className={styles.txHeader}>Linked Transactions</p>
          <table className={styles.txTable}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Amount</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              {transactions.slice(0, 20).map((tx, i) => (
                <tr key={i}>
                  <td>{tx.date}</td>
                  <td>{tx.label}</td>
                  <td style={{ color: tx.type === 'Revenue' ? '#00C896' : 'var(--color-text-primary)' }}>
                    {fmt(tx.amount)}
                  </td>
                  <td>{tx.type}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {transactions.length > 20 && (
            <p className={styles.txMore}>+{transactions.length - 20} more transactions</p>
          )}
        </div>
      )}
    </div>
  );
}
