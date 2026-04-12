/**
 * Export diary entries as a downloadable CSV file.
 */
export function exportDiaryCSV(entries) {
  const headers = ['Date', 'Summary', 'Raw Text', 'Modules Touched', 'Status', 'Actions Count'];

  const rows = entries.map((e) => {
    const date = e.createdAt?.toDate
      ? e.createdAt.toDate().toISOString().slice(0, 10)
      : (e.createdAt || '');
    const modules = [...new Set((e.actions || []).map((a) => a.module))].join('; ');
    return [
      date,
      e.summary || '',
      e.rawText || '',
      modules,
      e.status || '',
      (e.actions || []).length,
    ];
  });

  const csvContent = [headers, ...rows]
    .map((row) =>
      row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')
    )
    .join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `xslide-diary-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
