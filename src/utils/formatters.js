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
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

export function formatTrips(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return new Intl.NumberFormat('el-GR').format(Math.round(n));
}

export function formatKm(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return `${new Intl.NumberFormat('el-GR', { maximumFractionDigits: 1 }).format(n)} km`;
}

export function formatMinutes(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  const h = Math.floor(n / 60);
  const m = Math.round(n % 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

/**
 * Returns a human-readable relative time string, e.g. "4 minutes ago", "2 days ago".
 * Pass an ISO timestamp string or a Date object.
 */
export function formatRelativeTime(ts) {
  if (!ts) return '—';
  const date = typeof ts === 'string' ? new Date(ts) : ts;
  if (isNaN(date.getTime())) return '—';
  const diffMs  = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60)        return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60)        return `${diffMin} min ago`;
  const diffH   = Math.floor(diffMin / 60);
  if (diffH < 24)          return `${diffH}h ago`;
  const diffD   = Math.floor(diffH / 24);
  if (diffD < 30)          return `${diffD}d ago`;
  const diffMo  = Math.floor(diffD / 30);
  if (diffMo < 12)         return `${diffMo} mo ago`;
  return `${Math.floor(diffMo / 12)}y ago`;
}
