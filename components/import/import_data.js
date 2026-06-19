// ── Load Data → Kernel ─────────────────────────────────────────────────────────
// Injects a CSV or Excel file as a pandas DataFrame into the shared Pyodide
// kernel namespace. After loading, users can type  df.head()  in any cell.
//
// Excel support: dynamically loads SheetJS from CDN on first .xlsx/.xls file.

import { injectDataFrame } from '../compiler/compiler.js';

const XLSX_CDN = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';

// ── File parsers ──────────────────────────────────────────────────────────────

async function _ensureXlsx() {
  if (window.XLSX) return window.XLSX;
  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = XLSX_CDN;
    s.onload = res;
    s.onerror = () => rej(new Error('Failed to load SheetJS'));
    document.head.appendChild(s);
  });
  return window.XLSX;
}

function _fileToText(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = e => res(e.target.result);
    r.onerror = rej;
    r.readAsText(file);
  });
}

function _fileToBuffer(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = e => res(e.target.result);
    r.onerror = rej;
    r.readAsArrayBuffer(file);
  });
}

async function _fileToCsv(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'csv') return _fileToText(file);

  // Excel
  const XLSX = await _ensureXlsx();
  const buf  = await _fileToBuffer(file);
  const wb   = XLSX.read(buf, { type: 'array' });
  const ws   = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_csv(ws);
}

// ── Toast helper ──────────────────────────────────────────────────────────────

function _toast(msg) {
  const existing = document.querySelector('.import-toast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.className   = 'import-toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => {
    t.classList.add('import-toast--out');
    t.addEventListener('animationend', () => t.remove(), { once: true });
    setTimeout(() => t.remove(), 400);
  }, 3200);
}

// ── Factory ───────────────────────────────────────────────────────────────────
// Returns a button element that:
//   1. Opens a file picker for .csv / .xlsx / .xls
//   2. Parses the file client-side
//   3. Injects as `df` (or custom varName) into the shared Pyodide kernel
//
// onLoad(varName, rows) — optional callback fired after successful injection

export function createLoadDataBtn({ varName = 'df', onLoad } = {}) {
  const btn = document.createElement('button');
  btn.className   = 'sc-btn load-data-btn';
  btn.title       = 'Load CSV / Excel as DataFrame — available as  df  in all cells';
  btn.textContent = '📂';

  btn.addEventListener('click', () => {
    const input    = document.createElement('input');
    input.type     = 'file';
    input.accept   = '.csv,.xlsx,.xls';
    input.style.display = 'none';
    document.body.appendChild(input);

    input.addEventListener('change', async () => {
      const file = input.files[0];
      input.remove();
      if (!file) return;

      btn.disabled    = true;
      btn.textContent = '⌛ Loading…';

      try {
        const csv    = await _fileToCsv(file);
        const result = await injectDataFrame(varName, csv);
        _toast(`✓ "${file.name}" loaded → ${varName}  (${result.rows} rows)  — try: ${varName}.head()`);
        onLoad?.(varName, result.rows, file.name);
      } catch (e) {
        _toast(`✗ Load failed: ${e.message}`);
        console.error('[import_data]', e);
      } finally {
        btn.disabled    = false;
        btn.textContent = '📂';
      }
    });

    input.click();
  });

  return btn;
}
