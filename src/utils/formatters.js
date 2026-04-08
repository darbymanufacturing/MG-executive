// EUR formatter using Greek locale (e.g. 1.234,56 €)
const eurFormatter = new Intl.NumberFormat('el-GR', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const eurFormatterNoDecimals = new Intl.NumberFormat('el-GR', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const numberFormatter = new Intl.NumberFormat('el-GR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatEUR(amount, noDecimals = false) {
  if (amount === null || amount === undefined || isNaN(amount)) return '—';
  return noDecimals
    ? eurFormatterNoDecimals.format(amount)
    : eurFormatter.format(amount);
}

export function formatEURCompact(amount) {
  if (amount === null || amount === undefined || isNaN(amount)) return '—';
  if (Math.abs(amount) >= 1_000_000) {
    return `€${(amount / 1_000_000).toFixed(2)}M`;
  }
  if (Math.abs(amount) >= 1_000) {
    return `€${(amount / 1_000).toFixed(1)}K`;
  }
  return formatEUR(amount);
}

export function formatNumber(num) {
  if (num === null || num === undefined || isNaN(num)) return '—';
  return numberFormatter.format(num);
}

export function formatPercent(value) {
  if (value === null || value === undefined || isNaN(value)) return '—';
  return `${Math.round(value)}%`;
}

export function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('el-GR'); // DD/MM/YYYY
}

export function todayISO() {
  return new Date().toISOString().split('T')[0];
}
