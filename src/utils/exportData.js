import { CURRENT_VERSION } from './constants.js';

/** Download costs + config as a JSON backup file */
export function exportToJSON(costs, config) {
  const payload = {
    version: CURRENT_VERSION,
    exportedAt: new Date().toISOString(),
    config,
    costs,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `xslide-costs-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Parse and validate an imported JSON backup */
export function importFromJSON(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (!data.costs || !Array.isArray(data.costs)) {
          reject(new Error('Invalid backup file: missing costs array.'));
          return;
        }
        resolve(data);
      } catch {
        reject(new Error('Failed to parse file. Make sure it is a valid JSON backup.'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsText(file);
  });
}

/** Export dashboard section to PDF using html2canvas + jsPDF */
export async function exportDashboardToPDF(elementId, filename) {
  const { default: html2canvas } = await import('html2canvas');
  const { default: jsPDF } = await import('jspdf');

  const element = document.getElementById(elementId);
  if (!element) return;

  const canvas = await html2canvas(element, {
    backgroundColor: '#000000',
    scale: 2,
    useCORS: true,
  });

  const imgData = canvas.toDataURL('image/png');
  const pdf = new jsPDF({
    orientation: canvas.width > canvas.height ? 'landscape' : 'portrait',
    unit: 'px',
    format: [canvas.width / 2, canvas.height / 2],
  });

  pdf.addImage(imgData, 'PNG', 0, 0, canvas.width / 2, canvas.height / 2);
  pdf.save(filename || `xslide-dashboard-${new Date().toISOString().split('T')[0]}.pdf`);
}
