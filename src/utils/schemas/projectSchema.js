export const projectSchema = {
  name:        { required: true, type: 'string', maxLength: 120, label: 'Project name' },
  tagline:     { type: 'string', maxLength: 240, label: 'Tagline' },
  owner:       { required: true, type: 'string', label: 'Owner' },
  type:        { type: 'string', label: 'Type' },
  category:    { required: true, type: 'string', label: 'Category' },
  startDate:   { type: 'date', label: 'Start date' },
  targetDate:  { type: 'date', onOrAfter: 'startDate', label: 'Target date' },
  description: { type: 'string', maxLength: 2000, label: 'Description' },
};
