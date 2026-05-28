export const costSchema = {
  name:      { required: true, type: 'string', maxLength: 120, label: 'Cost name' },
  amount:    { required: true, type: 'number', min: 0, label: 'Amount' },
  category:  { required: true, type: 'string', label: 'Category' },
  frequency: { required: true, type: 'string',
               oneOf: ['monthly', 'yearly', 'one-time'],
               label: 'Frequency' },
  startDate: { required: true, type: 'date', label: 'Start date' },
  endDate:   { type: 'date', onOrAfter: 'startDate', label: 'End date' },
  notes:     { type: 'string', maxLength: 500, label: 'Notes' },
};
