export const CATEGORIES = {
  'one-off': {
    label: 'One-Off',
    fullLabel: 'One-Off Costs',
    color: '#A0521D',
    textColor: '#FFFFFF',
    icon: 'Zap',
    description: 'Single purchases, setup costs, licences',
  },
  fixed: {
    label: 'Fixed',
    fullLabel: 'Fixed Costs',
    color: '#C97D49',
    textColor: '#FFFFFF',
    icon: 'Lock',
    description: 'Recurring costs that stay constant (rent, insurance)',
  },
  variable: {
    label: 'Variable',
    fullLabel: 'Variable Costs',
    // #146 — was #CCCCCC (fails 3:1 contrast on light); slate-500 passes at ~4.6:1 on white
    color: '#64748B',
    textColor: '#FFFFFF',
    icon: 'TrendingUp',
    description: 'Costs that fluctuate with usage (maintenance, charging)',
  },
  investment: {
    label: 'Investment',
    fullLabel: 'Investments',
    color: '#7A3E16',
    textColor: '#FFFFFF',
    icon: 'PiggyBank',
    description: 'Capital expenditure and fleet expansion',
  },
  loan: {
    label: 'Loan',
    fullLabel: 'Loan Repayments',
    color: '#1E88E5',
    textColor: '#FFFFFF',
    icon: 'Landmark',
    description: 'Bank loans, leasing, equipment financing',
  },
  'credit-card': {
    label: 'Credit Card',
    fullLabel: 'Credit Card Payments',
    color: '#8E24AA',
    textColor: '#FFFFFF',
    icon: 'CreditCard',
    description: 'Credit card charges and revolving credit',
  },
};

export const CATEGORY_KEYS = Object.keys(CATEGORIES);

export const FREQUENCIES = {
  'one-time': {
    label: 'One-Time',
    shortLabel: 'Once',
    monthlyMultiplier: 0,   // excluded from recurring monthly total
    annualMultiplier: 1,    // counted once in annual total
  },
  monthly: {
    label: 'Monthly',
    shortLabel: '/mo',
    monthlyMultiplier: 1,
    annualMultiplier: 12,
  },
  quarterly: {
    label: 'Quarterly',
    shortLabel: '/qtr',
    monthlyMultiplier: 1 / 3,
    annualMultiplier: 4,
  },
  annual: {
    label: 'Annual',
    shortLabel: '/yr',
    monthlyMultiplier: 1 / 12,
    annualMultiplier: 1,
  },
};

export const FREQUENCY_KEYS = Object.keys(FREQUENCIES);

export const DEFAULT_CONFIG = {
  // fleetSize is the manually-configured fallback scalar used when no live scooter
  // count is available (e.g. before Supabase data loads, or for display-only consumers
  // that don't have access to the scooters collection). Primary consumers
  // (Dashboard, Settings, PulseStrip) now prefer the live fleet-scoped scooter count
  // and fall back to this value only when that count is zero or unavailable.
  fleetSize: 10,
  companyName: 'Omni',
  currency: 'EUR',
  targetCostPerScooter: null,
  locations: [],
  categoryBudgets: {},   // { 'fixed': 2000, 'variable': 1500, ... } monthly EUR
  financial: {
    applyFranchiseFee: true,  // toggle off when migrating to OTORide
    franchiseRate: 0.19,      // Hopp's cut of net-of-VAT revenue
    vatRate: 0.24,            // Greek flat VAT (revenue is stored ex-VAT; VAT held for remittance)
    monthlySimCost: 150,      // flat fleet SIM cost deducted from operating revenue
  },
};

// #144 — prefixes were 'smfc_' (old brand); updated to 'omni_' to match runtime.
// Nothing in the app currently imports STORAGE_KEYS directly — this export is kept
// for forward-compatibility but the keys are now consistent with the runtime prefix.
export const STORAGE_KEYS = {
  COSTS: 'omni_costs',
  CONFIG: 'omni_config',
  VERSION: 'omni_version',
};

export const CURRENT_VERSION = '1.0.0';

// #145 — static fallback kept so existing consumers don't break;
// prefer getChartColors() for theme-aware chart rendering.
export const CHART_COLORS_STATIC = {
  'one-off':     '#A0521D',
  fixed:         '#C97D49',
  variable:      '#64748B',
  investment:    '#7A3E16',
  loan:          '#1E88E5',
  'credit-card': '#8E24AA',
};

/** @deprecated Use getChartColors() for theme-aware charts. */
export const CHART_COLORS = CHART_COLORS_STATIC;

// #145 — reads CSS custom properties at call time so dark-theme overrides are honoured
export function getChartColors() {
  const s = typeof document !== 'undefined' ? getComputedStyle(document.documentElement) : null;
  return [
    s?.getPropertyValue('--accent')?.trim()      || '#A0521D',
    s?.getPropertyValue('--color-info')?.trim()  || '#3B82F6',
    '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#06B6D4',
  ];
}

export const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// #145 — see getChartColors() above for theme-aware variant
export const REVENUE_CHART_COLORS = {
  revenue: '#4CAF50',
  profit:  '#66BB6A',
  loss:    '#F44336',
  trips:   '#42A5F5',
};
