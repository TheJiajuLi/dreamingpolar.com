// ── Load Data → Kernel ─────────────────────────────────────────────────────────
// Injects a CSV or Excel file as a pandas DataFrame into the shared Pyodide
// kernel namespace. After loading, users can type  df.head()  in any cell.
//
// Excel support: dynamically loads SheetJS from CDN on first .xlsx/.xls file.
//
// TWO export paths:
//   createLoadDataBtn   — Power Notebook path: injects into Python kernel via Pyodide
//   createQuickImportBtn — Quick Analysis path: pure JS, stores in dataset_store, no Python

import { injectDataFrame } from '../compiler/compiler.js';
import { setDataset } from '../shared/dataset_store.js';

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

  // JSON and XML are text formats — read as-is so _parseToDataset can attempt
  // metadata extraction without crashing (actual injection uses _readInjectData).
  if (ext === 'json' || ext === 'xml') return _fileToText(file);

  // Excel: SheetJS needs a Uint8Array, not a bare ArrayBuffer.
  // _fileToBuffer returns ArrayBuffer → wrap with new Uint8Array() before passing.
  const XLSX = await _ensureXlsx();
  const buf  = await _fileToBuffer(file);
  const wb   = XLSX.read(new Uint8Array(buf), { type: 'array' });
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

// ── Raw data reader for DataFrame injection ───────────────────────────────────
// Returns { data, fileType } where data is the form expected by injectDataFrame:
//   csv / json / xml → text string
//   xlsx / xls       → Uint8Array (binary, for pd.read_excel via openpyxl)
async function _readInjectData(file, csvText) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'json') return { data: await _fileToText(file), fileType: 'json' };
  if (ext === 'xml')  return { data: await _fileToText(file), fileType: 'xml' };
  if (ext === 'xlsx' || ext === 'xls')
    return { data: new Uint8Array(await _fileToBuffer(file)), fileType: ext };
  return { data: csvText, fileType: 'csv' };   // csv: reuse already-read text
}

// ── Factory ───────────────────────────────────────────────────────────────────
// lazyMode: true  → parse in pure JS only; skip injectDataFrame (no Pyodide boot).
//   onLoad receives (varName, rows, filename, injectData, fileType, columns).
// lazyMode: false → eager path; calls injectDataFrame immediately.
//   onLoad receives (varName, rows, filename).
export function createLoadDataBtn({ varName = 'df', resolveVarName, lazyMode = false, onLoad } = {}) {
  const btn = document.createElement('button');
  btn.className   = 'sc-btn load-data-btn';
  btn.title       = 'Load CSV / Excel / JSON as DataFrame';
  btn.textContent = '📂';

  btn.addEventListener('click', () => {
    const input    = document.createElement('input');
    input.type     = 'file';
    input.accept   = '.csv,.xlsx,.xls,.json,.xml';
    input.style.display = 'none';
    document.body.appendChild(input);

    input.addEventListener('change', async () => {
      const file = input.files[0];
      input.remove();
      if (!file) return;

      btn.disabled    = true;
      btn.textContent = '⌛ Reading…';

      try {
        // csv is used for JS-side metadata (_parseToDataset, setDataset).
        // For JSON/Excel the csv conversion is approximate but sufficient for
        // row/col counts in the bottom bar; actual injection uses raw data.
        const csv           = await _fileToCsv(file);
        const actualVarName = resolveVarName ? resolveVarName(file.name) : varName;
        const dataset       = _parseToDataset(csv, file.name);
        if (dataset) setDataset(dataset);

        const { data: injectData, fileType } = await _readInjectData(file, csv);

        if (lazyMode) {
          const rows        = dataset?.rows.length    ?? Math.max(0, csv.split('\n').length - 1);
          const columns     = dataset?.columns.length ?? 0;
          const columnNames = dataset?.columns        ?? [];
          _toast(`✓ "${file.name}" → ${actualVarName} (${rows.toLocaleString()} rows, ${columns} cols) — click ▶ to load`);
          onLoad?.(actualVarName, rows, file.name, injectData, fileType, columns, columnNames);
        } else {
          const result = await injectDataFrame(actualVarName, injectData, fileType, file.name);
          _toast(`✓ "${file.name}" loaded → ${actualVarName}  (${result.rows} rows)  — try: ${actualVarName}.head()`);
          onLoad?.(actualVarName, result.rows, file.name);
        }
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

// ── CSV/text → { columns, dtypes, rows } ─────────────────────────────────────
// Pure JS parser — no Pyodide needed.

function _parseToDataset(csvText, filename) {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 1) return null;

  // Parse header
  const columns = _splitCsvLine(lines[0]);

  // Parse rows
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = _splitCsvLine(lines[i]);
    if (vals.length === 0) continue;
    const row = {};
    columns.forEach((col, j) => { row[col] = vals[j] ?? ''; });
    rows.push(row);
  }

  // Infer dtypes from first 20 rows
  const dtypes = {};
  for (const col of columns) {
    const samples = rows.slice(0, 20).map(r => r[col]).filter(v => v !== '');
    dtypes[col] = samples.length > 0 && samples.every(v => !isNaN(parseFloat(v)) && isFinite(v))
      ? 'float64' : 'object';
  }

  return { name: filename, columns, dtypes, rows };
}

function _splitCsvLine(line) {
  const fields = [];
  let cur = '', inQ = false;
  for (let i = 0; i <= line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; }
    else if ((c === ',' || c === undefined) && !inQ) {
      fields.push(cur.replace(/^"|"$/g, '').trim());
      cur = '';
    } else { cur += (c ?? ''); }
  }
  return fields;
}

// ── Quick Analysis import button ──────────────────────────────────────────────
// Pure JS path: parses CSV/Excel client-side, stores in dataset_store.
// Does NOT touch Pyodide — instant, works even before Python loads.
//
// onLoad(dataset) — optional callback with the parsed dataset object

export function createQuickImportBtn({ onLoad } = {}) {
  const btn = document.createElement('button');
  btn.className   = 'sc-btn load-data-btn';
  btn.title       = 'Import CSV / Excel — instant, no Python needed';
  btn.textContent = '📂';

  btn.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type    = 'file';
    input.accept  = '.csv,.xlsx,.xls,.txt';
    input.style.display = 'none';
    document.body.appendChild(input);

    input.addEventListener('change', async () => {
      const file = input.files[0];
      input.remove();
      if (!file) return;

      btn.disabled    = true;
      btn.textContent = '⌛ Reading…';

      try {
        const csvText = await _fileToCsv(file);
        const dataset = _parseToDataset(csvText, file.name);
        if (!dataset) throw new Error('Could not parse file');

        setDataset(dataset);   // ← stores + dispatches 'dataset-updated'
        _toast(`✓ "${file.name}" — ${dataset.rows.length.toLocaleString()} rows · ${dataset.columns.length} cols`);
        onLoad?.(dataset);
      } catch (e) {
        _toast(`✗ Import failed: ${e.message}`);
        console.error('[import_data quick]', e);
      } finally {
        btn.disabled    = false;
        btn.textContent = '📂';
      }
    });

    input.click();
  });

  return btn;
}
