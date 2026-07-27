import { useCallback, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import AsterismMark from '../components/Shared/AsterismMark.jsx';
import YearGrid from '../components/Planner/YearGrid.jsx';
import YearlyPanel from '../components/Planner/YearlyPanel.jsx';
import MonthSheet from '../components/Planner/MonthSheet.jsx';
import { useMetrics } from '../context/MetricsContext.jsx';
import { useCosts } from '../context/CostContext.jsx';
import { buildPlannerModel, plannerYears } from '../utils/financialPlanner.js';
import styles from './Planner.module.css';

/**
 * Financial Planner — an Excel replica of "Financial Planner 2022 Recoin
 * Digital.xlsx". Year view = two 6-month YearGrid bands + a YearlyPanel
 * summary column; drilling into a month swaps to a read-only MonthSheet.
 *
 * All math lives in utils/financialPlanner.js (buildPlannerModel); this page
 * only wires scoped data + the year switcher + the opening-balance commit.
 */
export default function Planner() {
  const { scopedCosts, scopedRevenue } = useMetrics();
  const { config, updateConfig } = useCosts();

  const years = useMemo(() => {
    const list = plannerYears?.() ?? [];
    return Array.isArray(list) && list.length ? list : [new Date().getFullYear()];
  }, []);

  const currentCalendarYear = new Date().getFullYear();
  const initialYear = years.includes(currentCalendarYear)
    ? currentCalendarYear
    : years[years.length - 1];

  const [year, setYear] = useState(initialYear);
  const [selectedMonth, setSelectedMonth] = useState(null);

  const goPrevYear = useCallback(() => {
    setYear((y) => {
      const idx = years.indexOf(y);
      if (idx <= 0) return years[years.length - 1];
      return years[idx - 1];
    });
    setSelectedMonth(null);
  }, [years]);

  const goNextYear = useCallback(() => {
    setYear((y) => {
      const idx = years.indexOf(y);
      if (idx === -1 || idx >= years.length - 1) return years[0];
      return years[idx + 1];
    });
    setSelectedMonth(null);
  }, [years]);

  const openingBalance = Number(config?.plannerOpening?.[year]) || 0;

  const model = useMemo(() => buildPlannerModel({
    costs: scopedCosts,
    revenue: scopedRevenue,
    year,
    openingBalance,
  }), [scopedCosts, scopedRevenue, year, openingBalance]);

  const handleCommitOpening = useCallback((value) => {
    const num = Number(value) || 0;
    updateConfig({ plannerOpening: { ...(config?.plannerOpening || {}), [year]: num } });
  }, [updateConfig, config, year]);

  const months = model?.months ?? [];
  const trends = model?.trends ?? {};
  const yearly = model?.yearly ?? {};

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <AsterismMark size={28} />
          <span className={styles.wordmark}>omni</span>
        </div>
        <h1 className={styles.title}>YEARLY SUMMARY</h1>
        <div className={styles.yearSwitcher}>
          <button
            type="button"
            className={styles.yearBtn}
            onClick={goPrevYear}
            aria-label="Previous year"
          >
            <ChevronLeft size={18} />
          </button>
          <span className={styles.yearLabel}>{year}</span>
          <button
            type="button"
            className={styles.yearBtn}
            onClick={goNextYear}
            aria-label="Next year"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </header>

      {selectedMonth === null ? (
        <div className={styles.yearView}>
          <div className={styles.gridScroll}>
            <YearGrid months={months} trends={trends} band={0} onSelectMonth={setSelectedMonth} />
            <YearGrid months={months} trends={trends} band={1} onSelectMonth={setSelectedMonth} />
          </div>
          <YearlyPanel
            yearly={yearly}
            year={year}
            openingBalance={openingBalance}
            onCommitOpening={handleCommitOpening}
          />
        </div>
      ) : (
        <MonthSheet month={months[selectedMonth]} onBack={() => setSelectedMonth(null)} />
      )}
    </div>
  );
}
