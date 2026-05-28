/**
 * Export costs + config to a JSON backup file.
 */
export function exportToJSON(costs, config) {
  const payload = JSON.stringify({ costs, config, exportedAt: new Date().toISOString() }, null, 2);
  const blob = new Blob([payload], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `omni-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Import a JSON backup file produced by exportToJSON.
 * Returns { costs, config } or throws on invalid format.
 */
export function importFromJSON(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (!Array.isArray(data.costs)) throw new Error('Invalid backup file — no costs array found.');
        resolve(data);
      } catch (err) {
        reject(new Error('Could not parse file: ' + err.message));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsText(file);
  });
}

// Column headers that match parseCostsCSV's EXPECTED_HEADERS exactly (round-trip compatible)
const CSV_HEADERS   = ['Name', 'Category', 'Frequency', 'Amount (EUR)', 'Start Date', 'End Date', 'Notes'];
const CSV_FIELD_MAP = {
  'Name':         'name',
  'Category':     'category',
  'Frequency':    'frequency',
  'Amount (EUR)': 'amount',
  'Start Date':   'startDate',
  'End Date':     'endDate',
  'Notes':        'notes',
};

/**
 * Export costs as CSV (headers match the import parser for a lossless round-trip).
 */
export function exportCostsCSV(costs) {
  const headerRow = CSV_HEADERS.map((h) => `"${h}"`).join(',');
  const rows = costs.map((c) =>
    CSV_HEADERS.map((h) => {
      const val = c[CSV_FIELD_MAP[h]] ?? '';
      return `"${String(val).replace(/"/g, '""')}"`;
    }).join(',')
  );
  const csv  = [headerRow, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `omni-costs-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Download a blank CSV template for cost import.
 * Headers are identical to exportCostsCSV for round-trip compatibility.
 */
export function downloadCostTemplate() {
  const headerRow = CSV_HEADERS.map((h) => `"${h}"`).join(',');
  const example = [
    '"Monthly Parking Fee"', '"fixed"', '"monthly"', '"150"',
    '"2025-01-01"', '""', '"Parking lot near port"',
  ];
  const csv  = [headerRow, example.join(',')].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'omni-cost-template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * PDF export utility — captures the #dashboard-export element via html2canvas,
 * then writes it to a jsPDF document in landscape A4.
 */
export async function exportDashboardToPDF(filename = 'omni-dashboard.pdf') {
  try {
    const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
      import('jspdf'),
      import('html2canvas'),
    ]);

    const el = document.getElementById('dashboard-export');
    if (!el) {
      console.warn('exportDashboardToPDF: #dashboard-export element not found');
      return;
    }

    const canvas = await html2canvas(el, {
      scale:           2,
      useCORS:         true,
      backgroundColor: '#0f0f0f',
      logging:         false,
    });

    const imgData = canvas.toDataURL('image/png');
    const pdf     = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageW   = pdf.internal.pageSize.getWidth();
    const pageH   = pdf.internal.pageSize.getHeight();

    const imgW = pageW;
    const imgH = (canvas.height * pageW) / canvas.width;
    let yPos   = 0;

    while (yPos < imgH) {
      if (yPos > 0) pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, -yPos, imgW, imgH);
      yPos += pageH;
    }

    pdf.save(filename);
  } catch (err) {
    console.error('PDF export failed:', err);
    alert('PDF export failed. Check the browser console for details.');
  }
}
