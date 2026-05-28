export const ticketSchema = {
  scooterId:     { required: true, type: 'string', label: 'Scooter ID' },
  category:      { required: true, type: 'string', label: 'Category' },
  status:        { required: true, type: 'string', label: 'Status' },
  dateEntered:   { required: true, type: 'date', label: 'Date entered' },
  dateCompleted: { type: 'date', onOrAfter: 'dateEntered', label: 'Date completed' },
  assignee:      { type: 'string', maxLength: 120, label: 'Assignee' },
  description:   { type: 'string', maxLength: 1000, label: 'Description' },
  labourMinutes: { type: 'number', min: 0, max: 1440, label: 'Labour minutes' },
};
