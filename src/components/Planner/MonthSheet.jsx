import { ChevronLeft } from 'lucide-react';
import { PLANNER_METRICS, PLANNER_METRIC_LABELS } from '../../utils/financialPlanner.js';
import { formatEUR } from '../../utils/formatters.js';
import styles from './Planner.module.css';

const sumItems = (items) => (items || []).reduce((s, it) => s + (Number(it?.amount) || 0), 0);

const LABEL_CLASS = {
  revenue: styles.labelRevenue,
  expenses: styles.labelExpenses,
};

// One ITEM/AMOUNT mini-table: colored sub-header pill, grey header row, striped
// body rows (scrolling past ~420px), black TOTAL row. Shared by every table on
// the sheet (revenue, software, staff, others, dividends). Like the Excel sheet,
// rows are editable: pass onEditItem to make rows (with a cost id) open the cost
// editor, and onAdd to show a "+ Add" control in the sub-header pill.
function SectionTable({ subLabel, subClassName, items, totalLabel, total, onEditItem, onAdd }) {
  const list = items || [];
  return (
    <div className={styles.table}>
      <div className={`${styles.subPill} ${subClassName}`}>
        <span>{subLabel}</span>
        {onAdd && (
          <button
            type="button"
            className={styles.addBtn}
            onClick={onAdd}
            aria-label={`Add ${subLabel} item`}
          >
            + Add
          </button>
        )}
      </div>
      <div className={styles.itemAmountHeader}>
        <span>ITEM</span>
        <span>AMOUNT</span>
      </div>
      <div className={styles.rowsScroll}>
        {list.length === 0 ? (
          <div className={`${styles.row} ${styles.emptyRow}`}>
            <span className={styles.itemName}>No entries</span>
            <span className={styles.itemAmount} />
          </div>
        ) : (
          list.map((item, idx) => {
            const editable = !!(onEditItem && item?.id);
            const Row = editable ? 'button' : 'div';
            return (
              <Row
                key={item?.id ?? item?.name ?? item?.label ?? idx}
                {...(editable ? { type: 'button', onClick: () => onEditItem(item.id), title: 'Edit this entry' } : {})}
                className={`${styles.row} ${editable ? styles.rowEditable : ''}`}
              >
                <span className={styles.itemName}>
                  {item?.name ?? item?.label ?? 'Item'}
                  {item?.isEstimate ? <span className={styles.estMarker}> · est</span> : null}
                </span>
                <span className={styles.itemAmount}>{formatEUR(Number(item?.amount) || 0)}</span>
              </Row>
            );
          })
        )}
      </div>
      <div className={styles.totalRow}>
        <span>{totalLabel}</span>
        <span>{formatEUR(total ?? 0)}</span>
      </div>
    </div>
  );
}

/**
 * Single-month sheet — the Excel replica's month tab. Expense/dividend rows are
 * editable (click → cost editor) and each bucket has "+ Add", like typing into
 * the spreadsheet; revenue is synced from trip data, so it stays read-only.
 * The per-month opening balance lives only on the Yearly Summary panel.
 */
export default function MonthSheet({ month, onBack, onEditItem, onAddItem }) {
  if (!month) {
    return (
      <div className={styles.monthSheet}>
        <button type="button" className={styles.backBtn} onClick={onBack}>
          <ChevronLeft size={16} />
          Year view
        </button>
        <p className={styles.emptyNotice}>No data for this month.</p>
      </div>
    );
  }

  const {
    name,
    revenueItems,
    expenseGroups = {},
    dividendItems,
    totals = {},
    summary = {},
  } = month;

  const { software = [], staff = [], others = [] } = expenseGroups || {};

  const revenueTotal = totals.revenue ?? sumItems(revenueItems);
  const softwareTotal = totals.software ?? sumItems(software);
  const staffTotal = totals.staff ?? sumItems(staff);
  const othersTotal = totals.others ?? sumItems(others);
  const dividendsTotal = totals.dividends ?? sumItems(dividendItems);

  const hasDividends = Array.isArray(dividendItems) && dividendItems.length > 0;

  return (
    <div className={styles.monthSheet}>
      <button type="button" className={styles.backBtn} onClick={onBack}>
        <ChevronLeft size={16} />
        Year view
      </button>
      <h2 className={styles.monthTitle}>{name}</h2>

      <div className={styles.sheetGrid}>
        <section className={styles.sectionBlock}>
          <div className={`${styles.sectionPill} ${styles.pillGreen}`}>REVENUE</div>
          <SectionTable
            subLabel="REVENUE"
            subClassName={styles.subGreen}
            items={revenueItems}
            totalLabel="TOTAL REVENUE"
            total={revenueTotal}
          />
        </section>

        <section className={styles.sectionBlock}>
          <div className={`${styles.sectionPill} ${styles.pillRed}`}>EXPENSES</div>
          <SectionTable
            subLabel="SOFTWARE"
            subClassName={styles.subSoftware}
            items={software}
            totalLabel="TOTAL SOFTWARE"
            total={softwareTotal}
            onEditItem={onEditItem}
            onAdd={onAddItem ? () => onAddItem('software', month.key) : undefined}
          />
          <SectionTable
            subLabel="STAFF"
            subClassName={styles.subStaff}
            items={staff}
            totalLabel="TOTAL STAFF"
            total={staffTotal}
            onEditItem={onEditItem}
            onAdd={onAddItem ? () => onAddItem('staff', month.key) : undefined}
          />
          <SectionTable
            subLabel="OTHERS"
            subClassName={styles.subOthers}
            items={others}
            totalLabel="TOTAL OTHERS"
            total={othersTotal}
            onEditItem={onEditItem}
            onAdd={onAddItem ? () => onAddItem('others', month.key) : undefined}
          />
        </section>
      </div>

      <div className={styles.summaryPanelMonth}>
        <div className={styles.blackPill}>SUMMARY</div>
        <div className={styles.summaryBody}>
          {PLANNER_METRICS.map((metricKey) => (
            <div key={metricKey} className={styles.summaryRow}>
              <span className={`${styles.summaryLabel} ${LABEL_CLASS[metricKey] ?? ''}`}>
                {PLANNER_METRIC_LABELS[metricKey]}
              </span>
              <span
                className={`${styles.summaryValue} ${
                  metricKey === 'opening' || metricKey === 'closing' ? styles.greyValue : ''
                }`}
              >
                {formatEUR(summary?.[metricKey] ?? 0)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {(hasDividends || onAddItem) && (
        <SectionTable
          subLabel="DIVIDENDS (owner draw)"
          subClassName={styles.subGrey}
          items={dividendItems}
          totalLabel="TOTAL DIVIDENDS"
          total={dividendsTotal}
          onEditItem={onEditItem}
          onAdd={onAddItem ? () => onAddItem('dividends', month.key) : undefined}
        />
      )}
    </div>
  );
}
