import { useState } from 'react';
import { useMaintenance } from '../../../context/MaintenanceContext.jsx';
import Button from '../../Shared/Button.jsx';
import PartsFilters from '../parts/PartsFilters.jsx';
import PartsTable from '../parts/PartsTable.jsx';
import PartForm from '../parts/PartForm.jsx';
import styles from './PartsTab.module.css';

const INITIAL_FILTERS = { search: '', status: '', model: '', supplier: '' };

export default function PartsTab() {
  const { parts, addPart, updatePart, deletePart } = useMaintenance();

  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [showForm, setShowForm] = useState(false);
  const [editingPart, setEditingPart] = useState(null);

  function handleFilterChange(key, val) {
    setFilters((prev) => ({ ...prev, [key]: val }));
  }

  function handleClearFilters() {
    setFilters(INITIAL_FILTERS);
  }

  // Apply filters
  const filtered = parts.filter((p) => {
    if (filters.search) {
      const q = filters.search.toLowerCase();
      const matchesSku = (p.sku || '').toLowerCase().includes(q);
      const matchesName = (p.partName || '').toLowerCase().includes(q);
      if (!matchesSku && !matchesName) return false;
    }
    if (filters.status && p.status !== filters.status) return false;
    if (filters.model && p.model !== filters.model) return false;
    if (filters.supplier) {
      const q = filters.supplier.toLowerCase();
      if (!(p.supplier || '').toLowerCase().includes(q)) return false;
    }
    return true;
  });

  function handleEdit(part) {
    setEditingPart(part);
    setShowForm(true);
  }

  function handleAdd() {
    setEditingPart(null);
    setShowForm(true);
  }

  function handleClose() {
    setShowForm(false);
    setEditingPart(null);
  }

  async function handleSave(data) {
    if (editingPart) {
      await updatePart(editingPart._docId, data);
    } else {
      await addPart(data);
    }
    handleClose();
  }

  async function handleDelete(docId) {
    await deletePart(docId);
  }

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <div className={styles.meta}>
          <span className={styles.count}>
            {filtered.length} {filtered.length === 1 ? 'part' : 'parts'}
            {filtered.length !== parts.length && (
              <span className={styles.total}> of {parts.length}</span>
            )}
          </span>
        </div>
        <Button variant="primary" size="sm" onClick={handleAdd}>
          + Add Part
        </Button>
      </div>

      <PartsFilters
        filters={filters}
        onChange={handleFilterChange}
        onClear={handleClearFilters}
      />

      <PartsTable parts={filtered} onEdit={handleEdit} onDelete={handleDelete} />

      <PartForm
        isOpen={showForm}
        onClose={handleClose}
        onSave={handleSave}
        initialData={editingPart}
      />
    </div>
  );
}
