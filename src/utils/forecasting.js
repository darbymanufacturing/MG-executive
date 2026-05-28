/**
 * Linear regression forecasting utilities.
 * Used by RevenueCostTrend to project 3-month dashed lines.
 */

/** Simple ordinary-least-squares regression over an array of numbers. */
function linearRegression(values) {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] ?? 0 };
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((s, v) => s + v, 0) / n;
  let num = 0, den = 0;
  values.forEach((v, i) => {
    num += (i - xMean) * (v - yMean);
    den += (i - xMean) ** 2;
  });
  const slope = den === 0 ? 0 : num / den;
  return { slope, intercept: yMean - slope * xMean };
}

/**
 * Extend a combined trend array with forecasted months.
 *
 * @param {Array}  data        - combinedTrend / allTimeCombinedTrend output
 *                               Each entry has { month, total, revenue, profit, ... }
 * @param {number} monthsAhead - how many future months to project (default 3)
 * @returns {Array} original data + forecast entries with forecastRevenue / forecastCost
 */
export function forecastTrend(data, monthsAhead = 3) {
  if (!data || data.length < 3) return data;

  // Use last 6 points (or all if fewer)
  const window = data.slice(-6);
  const revenues = window.map((d) => d.revenue || 0);
  const costs    = window.map((d) => d.total    || 0);

  const revReg  = linearRegression(revenues);
  const costReg = linearRegression(costs);

  // Extend month labels
  const lastMonth = data[data.length - 1].month; // e.g. "Mar 2025" or "2025-03"
  const forecastMonths = generateNextMonths(lastMonth, monthsAhead);

  // Build forecast points — include last actual as anchor (no gap in dashed line)
  const anchor = {
    ...data[data.length - 1],
    forecastRevenue: revReg.intercept + revReg.slope * (window.length - 1),
    forecastCost:    costReg.intercept + costReg.slope * (window.length - 1),
    isForecasted: false,
  };

  const forecasted = forecastMonths.map((month, i) => {
    const x = window.length + i;
    return {
      month,
      total: null,
      revenue: null,
      profit: null,
      forecastRevenue: parseFloat((revReg.intercept + revReg.slope * x).toFixed(2)),
      forecastCost:    parseFloat((costReg.intercept + costReg.slope * x).toFixed(2)),
      isForecasted: true,
    };
  });

  // Attach anchor values to all historical data too (null = not shown)
  const historical = data.map((d, i) => ({
    ...d,
    forecastRevenue: null,
    forecastCost:    null,
  }));
  // Overwrite last with anchor
  historical[historical.length - 1] = anchor;

  return [...historical, ...forecasted];
}

const MONTH_ABBRS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function generateNextMonths(lastLabel, count) {
  // Parse "Jan 2025" or "2025-01" format
  let year, month; // 0-indexed month

  const ymMatch = lastLabel.match(/^(\d{4})-(\d{2})$/);
  const abbMatch = lastLabel.match(/^([A-Za-z]{3})\s+(\d{4})$/);

  if (ymMatch) {
    year  = parseInt(ymMatch[1], 10);
    month = parseInt(ymMatch[2], 10) - 1;
  } else if (abbMatch) {
    month = MONTH_ABBRS.findIndex((a) => a === abbMatch[1]);
    if (month === -1) return [];
    year  = parseInt(abbMatch[2], 10);
  } else {
    return [];
  }

  const result = [];
  for (let i = 0; i < count; i++) {
    month += 1;
    if (month > 11) { month = 0; year += 1; }
    // Match the same label format as input
    if (ymMatch) {
      result.push(`${year}-${String(month + 1).padStart(2, '0')}`);
    } else {
      result.push(`${MONTH_ABBRS[month]} ${year}`);
    }
  }
  return result;
}
