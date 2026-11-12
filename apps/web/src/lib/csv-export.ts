/**
 * CSV output is untrusted spreadsheet content, even for an authorized export:
 * spreadsheet applications may execute leading = + - @ cells as formulas.
 * Keep numbers numeric, but treat all user-provided text as literal text.
 */
export type CsvCell = string | number | null | undefined;

function escapeCsvCell(value: CsvCell): string {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error('CSV_EXPORT_INVALID_NUMBER');
  }
  const text = value == null ? '' : String(value);
  // Leading control/whitespace before a formula marker is also dangerous.
  // Prefix an apostrophe before the *entire* value so even trimming consumers
  // do not promote the input to a formula. Quoting alone is not sufficient.
  const safe = typeof value === 'string' && /^[\s\u0000-\u001f]*[=+\-@]/u.test(text)
    ? "'" + text
    : text;
  return '"' + safe.replace(/"/g, '""') + '"';
}

export function serializeCsv(headers: string[], rows: CsvCell[][]): string {
  if (headers.length === 0 || rows.some((row) => row.length !== headers.length)) {
    throw new Error('CSV_EXPORT_COLUMN_MISMATCH');
  }
  return [headers, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\r\n') + '\r\n';
}

export function downloadCsv(filename: string, headers: string[], rows: CsvCell[][]): void {
  const safeFilename = filename.replace(/[\x00-\x1f\x7f/\\]/g, '_').slice(0, 150) || 'export.csv';
  // UTF-8 BOM helps Excel recognize multilingual project names and evidence.
  const blob = new Blob(['\uFEFF', serializeCsv(headers, rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = safeFilename;
  try {
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    // Do not revoke synchronously: the browser may not have consumed the URL yet.
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}
