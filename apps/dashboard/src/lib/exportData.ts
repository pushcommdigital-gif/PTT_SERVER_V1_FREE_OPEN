type Row = Record<string, unknown>;

export interface ExportCol {
  key: string;
  label: string;
}

function cellValue(row: Row, key: string): string {
  const v = row[key];
  if (v == null) return '';
  return String(v);
}

function downloadBlob(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function escapeCsvCell(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function exportCsv(rows: Row[], cols: ExportCol[], filename: string): void {
  const header = cols.map((c) => escapeCsvCell(c.label)).join(',');
  const body = rows
    .map((row) => cols.map((c) => escapeCsvCell(cellValue(row, c.key))).join(','))
    .join('\n');
  downloadBlob(`${header}\n${body}`, filename, 'text/csv;charset=utf-8;');
}

export function exportTxt(rows: Row[], cols: ExportCol[], filename: string): void {
  const header = cols.map((c) => c.label).join('\t');
  const body = rows
    .map((row) => cols.map((c) => cellValue(row, c.key)).join('\t'))
    .join('\n');
  downloadBlob(`${header}\n${body}`, filename, 'text/plain;charset=utf-8;');
}

export function printTable(rows: Row[], cols: ExportCol[], title: string): void {
  const headerCells = cols.map((c) => `<th>${c.label}</th>`).join('');
  const bodyRows = rows
    .map(
      (row) =>
        `<tr>${cols.map((c) => `<td>${cellValue(row, c.key)}</td>`).join('')}</tr>`,
    )
    .join('');

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>
    body { font-family: sans-serif; font-size: 12px; }
    h2 { margin-bottom: 8px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; }
    th { background: #f0f0f0; font-weight: 600; }
    tr:nth-child(even) { background: #fafafa; }
    @media print { button { display: none; } }
  </style>
</head>
<body>
  <h2>${title}</h2>
  <p style="color:#666;font-size:11px;">Exported ${new Date().toLocaleString()}</p>
  <table>
    <thead><tr>${headerCells}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>
  <br/>
  <button onclick="window.print()">Print</button>
</body>
</html>`;

  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  // Small delay lets the browser render before print dialog
  setTimeout(() => win.print(), 400);
}

export async function shareOrDownload(text: string, filename: string): Promise<void> {
  if (navigator.share) {
    try {
      await navigator.share({ title: filename, text });
      return;
    } catch {
      // User cancelled or API unavailable — fall through
    }
  }
  downloadBlob(text, filename, 'text/plain;charset=utf-8;');
}
