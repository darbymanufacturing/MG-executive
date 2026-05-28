export const scooterSchema = {
  scooterId:     { required: true, type: 'string', maxLength: 64, label: 'Scooter ID' },
  model:         { required: true, type: 'string', maxLength: 80, label: 'Model' },
  city:          { required: true, type: 'string', label: 'City' },
  status:        { required: true, type: 'string', label: 'Status' },
  purchaseDate:  { type: 'date', label: 'Purchase date' },
  purchasePrice: { type: 'number', min: 0, label: 'Purchase price' },
  notes:         { type: 'string', maxLength: 500, label: 'Notes' },
};
