export const partSchema = {
  name:              { required: true, type: 'string', maxLength: 120, label: 'Part name' },
  sku:               { type: 'string', maxLength: 64, label: 'SKU' },
  stockOnHand:       { required: true, type: 'number', min: 0, label: 'Stock on hand' },
  lowStockThreshold: { type: 'number', min: 0, label: 'Low-stock threshold' },
  unitCost:          { type: 'number', min: 0, label: 'Unit cost' },
  supplier:          { type: 'string', maxLength: 120, label: 'Supplier' },
};
