// Each category carries a `group` (fixed | variable | investment | debt | transfer)
// that drives the financial partition logic (projection split, debt-service, trend
// stacking) so adding a category never requires touching that logic again.
// Keys for categories imported verbatim from the owner's bookkeeping (BudgetBakers
// Wallet) are the human-readable strings themselves — quoted because they contain
// spaces/commas/Greek. Legacy keys ('one-off'…'credit-card') are retained.
export const CATEGORIES = {
  // ---- legacy keys (pre-existing rows, hand-entered + the cost form defaults) ----
  'one-off': {
    label: 'One-Off',
    fullLabel: 'One-Off Costs',
    color: '#A0521D',
    textColor: '#FFFFFF',
    icon: 'Zap',
    group: 'variable',
    description: 'Single purchases, setup costs, licences',
  },
  fixed: {
    label: 'Fixed',
    fullLabel: 'Fixed Costs',
    color: '#C97D49',
    textColor: '#FFFFFF',
    icon: 'Lock',
    group: 'fixed',
    description: 'Recurring costs that stay constant (rent, insurance)',
  },
  variable: {
    label: 'Variable',
    fullLabel: 'Variable Costs',
    // #146 — was #CCCCCC (fails 3:1 contrast on light); slate-500 passes at ~4.6:1 on white
    color: '#64748B',
    textColor: '#FFFFFF',
    icon: 'TrendingUp',
    group: 'variable',
    description: 'Costs that fluctuate with usage (maintenance, charging)',
  },
  investment: {
    label: 'Investment',
    fullLabel: 'Investments',
    color: '#7A3E16',
    textColor: '#FFFFFF',
    icon: 'PiggyBank',
    group: 'investment',
    description: 'Capital expenditure and fleet expansion',
  },
  loan: {
    label: 'Loan',
    fullLabel: 'Loan Repayments',
    color: '#1E88E5',
    textColor: '#FFFFFF',
    icon: 'Landmark',
    group: 'debt',
    description: 'Bank loans, leasing, equipment financing',
  },
  'credit-card': {
    label: 'Credit Card',
    fullLabel: 'Credit Card Payments',
    color: '#8E24AA',
    textColor: '#FFFFFF',
    icon: 'CreditCard',
    group: 'debt',
    description: 'Credit card charges and revolving credit',
  },

  // ---- owner bookkeeping categories (imported verbatim from Wallet, 2026-06-26) ----
  'Accounting and Legal services': {
    label: 'Accounting & Legal', fullLabel: 'Accounting and Legal Services',
    color: '#6366F1', textColor: '#FFFFFF', icon: 'Scale', group: 'fixed',
    description: 'Accountant, legal, professional services',
  },
  'VAT': {
    label: 'VAT', fullLabel: 'VAT',
    color: '#DC2626', textColor: '#FFFFFF', icon: 'Percent', group: 'variable', isTax: true,
    description: 'Value-added tax remittances (ΒΕΒΟΦ)',
  },
  'ΓΕΜΗ': {
    label: 'ΓΕΜΗ', fullLabel: 'ΓΕΜΗ — Business Registry',
    color: '#0891B2', textColor: '#FFFFFF', icon: 'Building2', group: 'fixed', isTax: true,
    description: 'General Commercial Registry (GEMI) fees',
  },
  'Company Registration Fees': {
    label: 'Company Registration', fullLabel: 'Company Registration Fees',
    color: '#0E7490', textColor: '#FFFFFF', icon: 'Stamp', group: 'fixed', isTax: true,
    description: 'Statutory company registration / filing fees',
  },
  'Payroll Fees': {
    label: 'Payroll Fees', fullLabel: 'Payroll Fees',
    color: '#7C3AED', textColor: '#FFFFFF', icon: 'Users', group: 'variable',
    description: 'Payroll processing and related fees',
  },
  'Transaction Fees': {
    label: 'Transaction Fees', fullLabel: 'Bank Transaction Fees',
    color: '#94A3B8', textColor: '#FFFFFF', icon: 'Receipt', group: 'variable',
    description: 'Bank charges, wire/SEPA fees (ΕΞΟΔΑ ΕΝΤΟΛΗΣ)',
  },
  'Bank loans': {
    label: 'Bank Loans', fullLabel: 'Bank Loan Repayments',
    color: '#1D4ED8', textColor: '#FFFFFF', icon: 'Landmark', group: 'debt',
    description: 'Bank loan principal/instalment payments',
  },
  'Loan Interest': {
    label: 'Loan Interest', fullLabel: 'Loan Interest',
    color: '#2563EB', textColor: '#FFFFFF', icon: 'Percent', group: 'debt',
    description: 'Interest portion of loans / credit',
  },
  'Other debts': {
    label: 'Other Debts', fullLabel: 'Other Debt Repayments',
    color: '#3B82F6', textColor: '#FFFFFF', icon: 'HandCoins', group: 'debt',
    description: 'Personal/other loan repayments (e.g. 10k loan)',
  },
  'Transfer, withdraw': {
    label: 'Transfer / Withdraw', fullLabel: 'Transfers & Withdrawals',
    color: '#A8A29E', textColor: '#FFFFFF', icon: 'ArrowLeftRight', group: 'transfer',
    description: 'Internal transfers & cash withdrawals (not a true expense)',
  },
  'Insurance': {
    label: 'Insurance', fullLabel: 'Insurance',
    color: '#0D9488', textColor: '#FFFFFF', icon: 'ShieldCheck', group: 'fixed',
    description: 'Vehicle / business insurance premiums',
  },
  'Customs': {
    label: 'Customs', fullLabel: 'Customs & Duties',
    color: '#B45309', textColor: '#FFFFFF', icon: 'Ship', group: 'variable', isTax: true,
    description: 'Import customs clearance and duties',
  },
  'Logistics services': {
    label: 'Logistics', fullLabel: 'Logistics Services',
    color: '#D97706', textColor: '#FFFFFF', icon: 'Truck', group: 'variable',
    description: 'Shipping, courier, freight (ACS, ELTA)',
  },
  'Electricity Bill': {
    label: 'Electricity', fullLabel: 'Electricity Bill',
    color: '#F59E0B', textColor: '#FFFFFF', icon: 'Zap', group: 'fixed',
    description: 'Electricity / power bills',
  },
  'Space rent': {
    label: 'Space Rent', fullLabel: 'Space Rent',
    color: '#CA8A04', textColor: '#FFFFFF', icon: 'Home', group: 'fixed',
    description: 'Workshop / storage / office rent',
  },
  'Space & Equipment': {
    label: 'Space & Equipment', fullLabel: 'Space & Equipment',
    color: '#A16207', textColor: '#FFFFFF', icon: 'Building', group: 'fixed',
    description: 'Premises fit-out and fixed equipment',
  },
  'Fuel': {
    label: 'Fuel', fullLabel: 'Fuel',
    color: '#EA580C', textColor: '#FFFFFF', icon: 'Fuel', group: 'variable',
    description: 'Vehicle fuel (Honda, Chico, van)',
  },
  'Consumables': {
    label: 'Consumables', fullLabel: 'Consumables',
    color: '#65A30D', textColor: '#FFFFFF', icon: 'Package', group: 'variable',
    description: 'Workshop consumables (tape, nuts, etc.)',
  },
  'Equipment and Tools': {
    label: 'Equipment & Tools', fullLabel: 'Equipment and Tools',
    color: '#16A34A', textColor: '#FFFFFF', icon: 'Wrench', group: 'variable',
    description: 'Tools and workshop equipment',
  },
  'Material': {
    label: 'Material', fullLabel: 'Material',
    color: '#15803D', textColor: '#FFFFFF', icon: 'Boxes', group: 'variable',
    description: 'Raw materials and stock',
  },
  'Parts': {
    label: 'Parts', fullLabel: 'Spare Parts',
    color: '#059669', textColor: '#FFFFFF', icon: 'Cog', group: 'variable',
    description: 'Scooter spare parts',
  },
  'Repairs & maintenance': {
    label: 'Repairs & Maint.', fullLabel: 'Repairs & Maintenance',
    color: '#10B981', textColor: '#FFFFFF', icon: 'Hammer', group: 'variable',
    description: 'Repairs and servicing',
  },
  'Machines and Vehicles': {
    label: 'Machines & Vehicles', fullLabel: 'Machines and Vehicles',
    color: '#92400E', textColor: '#FFFFFF', icon: 'Car', group: 'investment',
    description: 'Vehicle / machine purchases (capex)',
  },
  '3D Scanner Cost': {
    label: '3D Scanner', fullLabel: '3D Scanner Cost',
    color: '#9333EA', textColor: '#FFFFFF', icon: 'ScanLine', group: 'investment',
    description: '3D scanner hardware / service',
  },
  'App Development Fee': {
    label: 'App Development', fullLabel: 'App Development Fee',
    color: '#7C3AED', textColor: '#FFFFFF', icon: 'Code', group: 'fixed',
    description: 'Software / app development (OTORIDE)',
  },
  'Operations & computing services': {
    label: 'Ops & Computing', fullLabel: 'Operations & Computing Services',
    color: '#4F46E5', textColor: '#FFFFFF', icon: 'Server', group: 'fixed',
    description: 'Cloud, compute, AI APIs (Anthropic, Google)',
  },
  'SW subscriptions, Telco charges': {
    label: 'Software & Telco', fullLabel: 'Software Subscriptions & Telco',
    color: '#2563EB', textColor: '#FFFFFF', icon: 'Cloud', group: 'fixed',
    description: 'SaaS subscriptions, internet, mobile (Starlink, Workadu)',
  },
  'Marketing & Sales services': {
    label: 'Marketing & Sales', fullLabel: 'Marketing & Sales Services',
    color: '#DB2777', textColor: '#FFFFFF', icon: 'Megaphone', group: 'variable',
    description: 'Advertising, marketing, sales services',
  },
  'Hospitality Cost': {
    label: 'Hospitality', fullLabel: 'Hospitality Cost',
    color: '#E11D48', textColor: '#FFFFFF', icon: 'Coffee', group: 'variable',
    description: 'Coffee, meals, hosting (POW, meetings)',
  },
  'Travel expenses': {
    label: 'Travel', fullLabel: 'Travel Expenses',
    color: '#F43F5E', textColor: '#FFFFFF', icon: 'Plane', group: 'variable',
    description: 'Flights, transit, travel (Aegean)',
  },
  'Other admin expenses': {
    label: 'Other Admin', fullLabel: 'Other Admin Expenses',
    color: '#78716C', textColor: '#FFFFFF', icon: 'FileText', group: 'fixed',
    description: 'Miscellaneous administrative costs',
  },
  'Other Supplies': {
    label: 'Other Supplies', fullLabel: 'Other Supplies',
    color: '#A8A29E', textColor: '#FFFFFF', icon: 'Package2', group: 'variable',
    description: 'Miscellaneous supplies',
  },
  'CEO': {
    label: 'CEO Draw', fullLabel: 'CEO / Owner Draw',
    color: '#A0521D', textColor: '#FFFFFF', icon: 'Crown', group: 'fixed',
    description: 'Owner salary / management draw (ΜΙΣΘΟΣ ΔΙΑΧ)',
  },
  'Employees': {
    label: 'Employees', fullLabel: 'Employee Wages',
    color: '#9A3412', textColor: '#FFFFFF', icon: 'Users', group: 'variable',
    description: 'Employee wages',
  },
  'Contractors': {
    label: 'Contractors', fullLabel: 'Contractors',
    color: '#C2410C', textColor: '#FFFFFF', icon: 'HardHat', group: 'variable',
    description: 'Contractor / freelance fees (diver, etc.)',
  },
  'Franchise Fee': {
    label: 'Franchise Fee', fullLabel: 'Franchise Fee',
    color: '#8E24AA', textColor: '#FFFFFF', icon: 'Network', group: 'fixed',
    description: 'Hopp franchise fee',
  },
  'Unknown': {
    label: 'Uncategorized', fullLabel: 'Uncategorized',
    color: '#9CA3AF', textColor: '#FFFFFF', icon: 'HelpCircle', group: 'variable',
    description: 'Not yet categorized — needs review',
  },
};

export const CATEGORY_KEYS = Object.keys(CATEGORIES);

// Government taxes & statutory duties — the categories surfaced on the dedicated /taxes view.
export const TAX_CATEGORY_KEYS = CATEGORY_KEYS.filter((k) => CATEGORIES[k].isTax);

// Category → financial group. Drives the projection split (fixed vs variable),
// debt-service detection, and trend-chart stacking. Falls back to 'variable'.
export const COST_GROUPS = {
  fixed:      { label: 'Fixed',      color: '#C97D49' },
  variable:   { label: 'Variable',   color: '#64748B' },
  investment: { label: 'Investment', color: '#7A3E16' },
  debt:       { label: 'Debt',       color: '#1E88E5' },
  transfer:   { label: 'Transfers',  color: '#A8A29E' },
};
export const COST_GROUP_KEYS = Object.keys(COST_GROUPS);
export const groupForCategory = (key) => CATEGORIES[key]?.group || 'variable';

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
  // #505 / #525 — yearly/weekly/daily were missing; normalizeToMonthly returned 0 for these
  // and parseCostsCSV rejected them because FREQUENCY_SET derived from Object.keys(FREQUENCIES).
  yearly: {
    label: 'Yearly',
    shortLabel: '/yr',
    monthlyMultiplier: 1 / 12,
    annualMultiplier: 1,
  },
  weekly: {
    label: 'Weekly',
    shortLabel: '/wk',
    monthlyMultiplier: 52 / 12,
    annualMultiplier: 52,
  },
  daily: {
    label: 'Daily',
    shortLabel: '/day',
    monthlyMultiplier: 365 / 12,
    annualMultiplier: 365,
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
// Derived from CATEGORIES so every category (incl. owner bookkeeping keys) has a colour.
export const CHART_COLORS_STATIC = Object.fromEntries(
  Object.entries(CATEGORIES).map(([k, v]) => [k, v.color]),
);

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
