import { useCallback, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import AsterismMark from '../components/Shared/AsterismMark.jsx';
import YearGrid from '../components/Planner/YearGrid.jsx';
import YearlyPanel from '../components/Planner/YearlyPanel.jsx';
import MonthSheet from '../components/Planner/MonthSheet.jsx';
import CostFormModal from '../components/Costs/CostFormModal.jsx';
import { useMetrics } from '../context/MetricsContext.jsx';
import { useCosts } from '../context/CostContext.jsx';
import { buildPlannerModel, plannerYears, chainedOpenings } from '../utils/financialPlanner.js';
import styles from './Planner.module.css';

// "+ Add" in a month-sheet bucket prefills the cost form with a category that
// belongs to that bucket (changeable in the form). Mirrors the engine's mapping.
const BUCKET_DEFAULT_CATEGORY = {
  software: 'SW subscriptions, Telco charges',
  staff: 'Employees',
  others: 'Other admin expenses',
  dividends: 'CEO',
};

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
  const { config, updateConfig, addCost, updateCost, getCostById } = useCosts();

  // Years present in the data (recomputes when the async data lands). The
  // original call passed NO arguments, so this was always [currentYear] and the
  // switcher had nothing to switch to (reviewer finding, HIGH).
  const years = useMemo(() => {
    const list = plannerYears(scopedCosts, scopedRevenue);
    return Array.isArray(list) && list.length ? list : [new Date().getFullYear()];
  }, [scopedCosts, scopedRevenue]);

  const currentCalendarYear = new Date().getFullYear();
  const initialYear = years.includes(currentCalendarYear)
    ? currentCalendarYear
    : years[years.length - 1];

  const [year, setYear] = useState(initialYear);
  const [selectedMonth, setSelectedMonth] = useState(null);
  // Cost editor modal: { mode:'edit', cost } | { mode:'add', prefill } | null
  const [modal, setModal] = useState(null);

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

  // Each year's January opens on the previous December's closing (CASH-VIEW §3);
  // only the earliest data year is seeded by the manual config.plannerOpening input.
  const openings = useMemo(() => chainedOpenings({
    costs: scopedCosts,
    revenue: scopedRevenue,
    openings: config?.plannerOpening,
  }), [scopedCosts, scopedRevenue, config?.plannerOpening]);

  const openingBalance = openings[year]?.opening ?? (Number(config?.plannerOpening?.[year]) || 0);
  const openingDerived = openings[year]?.derived ?? false;

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

  // ── Editing (Excel-style): click an expense/dividend row → cost editor;
  //    "+ Add" in a bucket → prefilled create. Writes go through the normal
  //    cost write path, and the planner model recomputes live.
  const handleEditItem = useCallback((costId) => {
    const cost = getCostById(costId);
    if (cost) setModal({ mode: 'edit', cost });
  }, [getCostById]);

  const handleAddItem = useCallback((bucket, monthKey) => {
    setModal({
      mode: 'add',
      prefill: {
        category: BUCKET_DEFAULT_CATEGORY[bucket] || 'Other admin expenses',
        frequency: 'one-time',
        startDate: `${monthKey}-01`,
      },
    });
  }, []);

  const handleModalSave = useCallback((data) => {
    if (modal?.mode === 'edit' && modal.cost?.id) updateCost(modal.cost.id, data);
    else addCost(data);
  }, [modal, updateCost, addCost]);

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
            openingDerived={openingDerived}
          />
        </div>
      ) : (
        <MonthSheet
          month={months[selectedMonth]}
          onBack={() => setSelectedMonth(null)}
          onEditItem={handleEditItem}
          onAddItem={handleAddItem}
        />
      )}

      <CostFormModal
        isOpen={!!modal}
        onClose={() => setModal(null)}
        onSave={handleModalSave}
        initialData={modal?.mode === 'edit' ? modal.cost : modal?.prefill ?? null}
        locations={config?.locations || []}
      />
    </div>
  );
}
