export const costSchema = {
  name:      { required: true, type: 'string', maxLength: 120, label: 'Cost name' },
  // #122 — minimum changed from 0 to 0.01 to reject zero amounts; max matches CostFormModal validation
  amount:    { required: true, type: 'number', min: 0.01, max: 999999999, label: 'Amount' },
  category:  { required: true, type: 'string', label: 'Category' },
  // #122 — expanded oneOf to include all values the UI uses (was missing quarterly/annual/weekly/daily)
  frequency: { required: true, type: 'string',
               oneOf: ['one-time', 'monthly', 'quarterly', 'annual', 'yearly', 'weekly', 'daily'],
               label: 'Frequency' },
  startDate: { required: true, type: 'date', label: 'Start date' },
  endDate:   { type: 'date', onOrAfter: 'startDate', label: 'End date' },
  notes:     { type: 'string', maxLength: 500, label: 'Notes' },
};
