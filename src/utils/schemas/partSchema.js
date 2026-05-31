// #364 — field names match PartForm.jsx state (partName, reorderPoint, stockOnHand)
export const partSchema = {
  partName:     { required: true, type: 'string', maxLength: 120, label: 'Part name' },
  sku:          { type: 'string', maxLength: 64, label: 'SKU' },
  stockOnHand:  { required: true, type: 'number', min: 0, label: 'Stock on hand' },
  reorderPoint: { type: 'number', min: 0, label: 'Reorder point' },
  unitCost:     { type: 'number', min: 0, label: 'Unit cost' },
  supplier:     { type: 'string', maxLength: 120, label: 'Supplier' },
};
