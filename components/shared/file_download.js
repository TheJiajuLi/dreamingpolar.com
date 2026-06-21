// ── Browser file download helper ─────────────────────────────────────────────
//
// downloadBlob(content, filename, mimeType, isBase64)
//   content  — string (text) or base64-encoded string (binary)
//   filename — suggested download filename
//   mimeType — e.g. 'text/csv;charset=utf-8'
//   isBase64 — true for xlsx/binary content; false for text

const MIME = {
  csv:  'text/csv;charset=utf-8',
  json: 'application/json;charset=utf-8',
  xml:  'application/xml;charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export function downloadBlob(content, filename, mimeType, isBase64 = false) {
  let blob;
  if (isBase64) {
    // Decode base64 → Uint8Array → Blob (for xlsx and other binary formats)
    const binary = atob(content);
    const bytes  = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    blob = new Blob([bytes], { type: mimeType });
  } else {
    // Text formats: BOM for UTF-8 so Excel opens csv correctly without garbling CJK
    const bom = mimeType.startsWith('text/csv') ? '﻿' : '';
    blob = new Blob([bom + content], { type: mimeType });
  }

  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke after a short delay to let the download start
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export { MIME };
