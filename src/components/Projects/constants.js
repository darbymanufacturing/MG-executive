/** Shared constants for the Projects module. */

export const OWNERS = ['Kostas', 'Panos'];

export const CITIES = ['Nafplion', 'Corinth', 'Corfu', 'Athens', null];

export const PROJECT_TYPES = [
  'Operations',
  'Product',
  'Growth',
  'Infrastructure',
  'Finance',
];

export const CATEGORIES = [
  'Expansion',
  'Operations',
  'Technology',
  'Finance',
  'Legal',
  'Needs Setup',
];

export const STATUS_CONFIG = {
  onTrack: {
    label: 'On Track',
    color: '#00C896',
    dot: '🟢',
  },
  needsAttention: {
    label: 'Needs Attention',
    color: '#F5A623',
    dot: '🟡',
  },
  blocked: {
    label: 'Blocked',
    color: '#E84545',
    dot: '🔴',
  },
};

export const FILTER_OPTIONS = [
  { value: 'all',       label: 'All' },
  { value: 'onTrack',   label: 'Active' },
  { value: 'needsAttention', label: 'Needs Attention' },
  { value: 'blocked',   label: 'Blocked' },
  { value: 'archived',  label: 'Archived' },
];

export const BLOCKER_TYPES = {
  external:   { label: 'External',   dot: '🔴', color: '#E84545' },
  internal:   { label: 'Internal',   dot: '🟡', color: '#F5A623' },
  dependency: { label: 'Dependency', dot: '⚪', color: '#888888' },
};

export const PHASE_STATUS = {
  notStarted:  'Not Started',
  inProgress:  'In Progress',
  done:        'Done',
};

export const ASSIGNEES = ['Kostas', 'Panos'];

export const CALENDAR_EVENT_TYPES = [
  { value: 'all',         label: 'All events' },
  { value: 'phaseTarget', label: 'Phase deadlines' },
  { value: 'phaseActual', label: 'Completions' },
  { value: 'nextAction',  label: 'Next actions' },
  { value: 'blocker',     label: 'Blockers' },
  { value: 'decision',    label: 'Decisions' },
  { value: 'pow',         label: 'POW entries' },
];
