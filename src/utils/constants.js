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
    color: '#CCCCCC',
    textColor: '#000000',
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
  fleetSize: 10,
  companyName: 'XSlide',
  currency: 'EUR',
  targetCostPerScooter: null,
  locations: [],
};

export const STORAGE_KEYS = {
  COSTS: 'smfc_costs',
  CONFIG: 'smfc_config',
  VERSION: 'smfc_version',
};

export const CURRENT_VERSION = '1.0.0';

export const CHART_COLORS = {
  'one-off':     '#A0521D',
  fixed:         '#C97D49',
  variable:      '#CCCCCC',
  investment:    '#7A3E16',
  loan:          '#1E88E5',
  'credit-card': '#8E24AA',
};

export const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export const REVENUE_CHART_COLORS = {
  revenue: '#4CAF50',
  profit:  '#66BB6A',
  loss:    '#F44336',
  trips:   '#42A5F5',
};
