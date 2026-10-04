/**
 * Shared browser-download helpers.
 *
 * These were open-coded in eight places across the dashboard (two byte-identical
 * copies of downloadSvgAsPng and downloadCsv alone), so a fix to the CSV
 * escaping or the object-URL cleanup only ever landed in one of them.
 */

/** Blob → file download, with the object URL always released. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Rasterise an inline SVG chart to PNG at 2× for print-quality figures.
 * Renders onto an opaque white ground so the export is readable in both themes.
 */
export function downloadSvgAsPng(svgEl: SVGElement | null, filename: string) {
  if (!svgEl) return;
  const svgData = new XMLSerializer().serializeToString(svgEl);
  const canvas = document.createElement('canvas');
  const bbox = svgEl.getBoundingClientRect();
  canvas.width = bbox.width * 2;
  canvas.height = bbox.height * 2;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(2, 2);
  const img = new Image();
  img.onload = () => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    const a = document.createElement('a');
    a.download = filename;
    a.href = canvas.toDataURL('image/png');
    a.click();
  };
  img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
}

/** Serialise rows to CSV text. Objects are JSON-encoded rather than "[object Object]". */
export function toCsvText(data: Record<string, unknown>[], columns?: string[]): string {
  if (data.length === 0) return '';
  const headers = columns ?? Object.keys(data[0]);
  const escape = (value: unknown): string => {
    if (value === null || value === undefined) return '""';
    const str = typeof value === 'object' ? JSON.stringify(value) : String(value);
    // Excel executes a leading =/+/-/@ as a formula. Guard text, but leave plain
    // numbers alone so -3 does not export as '-3.
    const isNumeric = /^-?\d+(\.\d+)?$/.test(str);
    const guarded = !isNumeric && /^[=+\-@]/.test(str) ? `'${str}` : str;
    return `"${guarded.replace(/"/g, '""')}"`;
  };
  return [headers.map(escape).join(','), ...data.map(row => headers.map(h => escape(row[h])).join(','))].join('\n');
}

/** Rows → downloaded CSV file, BOM-prefixed so Excel reads Chinese correctly. */
export function downloadCsv(data: Record<string, unknown>[], filename: string, columns?: string[]) {
  if (data.length === 0) return;
  downloadBlob(new Blob(['﻿' + toCsvText(data, columns)], { type: 'text/csv;charset=utf-8' }), filename);
}
