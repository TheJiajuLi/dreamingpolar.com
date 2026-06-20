import { getAllDatasets } from '../shared/dataset_store.js';
import { getCellDatasetInfo } from '../customise_code_block/customise_code_block.js';

function getAiSlot()       { return document.getElementById('bdb-ai-slot'); }
function getCompilerSlot() { return document.getElementById('bdb-compiler-slot'); }
function getDfSlot()       { return document.getElementById('bdb-df-slot'); }

document.addEventListener('screen-opened', ({ detail: { id } }) => {
  if (id === 'ai-chat')                    getAiSlot()?.removeAttribute('hidden');
  if (id === 'coding' || id === 'terminal') getCompilerSlot()?.removeAttribute('hidden');
});

['screen-closed', 'screen-minimized'].forEach(evt => {
  document.addEventListener(evt, ({ detail: { id } }) => {
    if (id === 'ai-chat')                    getAiSlot()?.setAttribute('hidden', '');
    if (id === 'coding' || id === 'terminal') getCompilerSlot()?.setAttribute('hidden', '');
  });
});

document.addEventListener('compiler-status', ({ detail }) => {
  const slot = getCompilerSlot();
  if (!slot) return;
  const spinning = detail.status === 'loading' || detail.status === 'running';
  slot.className = `bdb-slot bdb-compiler-slot ${detail.status}`;
  if (detail.percent != null) slot.style.setProperty('--pct', `${detail.percent}%`);
  const pctLabel = (detail.percent != null && detail.status === 'loading')
    ? `<span class="status-pct">${detail.percent}%</span>` : '';
  slot.innerHTML = spinning
    ? `<span class="status-spinner"><i></i><i></i><i></i></span>${detail.message}${pctLabel}`
    : detail.message;
});

// ── DataFrame stats slot ──────────────────────────────────────────────────────
// Structure (built once in _initDfSlot):
//   #bdb-df-slot
//     span.bdb-df-summary   ← always visible, e.g. "3 datasets · 1,365 rows · 21 cols"
//     div.bdb-df-flyout     ← revealed on CSS :hover, one row per imported dataset

let _summaryEl = null;
let _flyoutEl  = null;

function _cellItems() {
  try { return getCellDatasetInfo(); } catch (_) { return []; }
}

// Rebuild summary text from current cell dataset info.
function _updateSummary() {
  const slot = getDfSlot();
  if (!slot || !_summaryEl) return;

  const items = _cellItems();

  // Fallback: Quick Analysis datasets from dataset_store (no cell association).
  if (!items.length) {
    const allDs = getAllDatasets();
    if (!allDs.length) { slot.setAttribute('hidden', ''); return; }
    const rows = allDs.reduce((s, d) => s + d.rows.length,    0);
    const cols = allDs.reduce((s, d) => s + d.columns.length, 0);
    slot.removeAttribute('hidden');
    const n = allDs.length;
    _summaryEl.textContent = `${n} dataset${n === 1 ? '' : 's'} · ${rows.toLocaleString()} rows · ${cols} cols`;
    return;
  }

  const totalRows = items.reduce((s, i) => s + i.rows,    0);
  const totalCols = items.reduce((s, i) => s + i.columns, 0);
  const n = items.length;
  slot.removeAttribute('hidden');
  _summaryEl.textContent = `${n} dataset${n === 1 ? '' : 's'} · ${totalRows.toLocaleString()} rows · ${totalCols} cols`;
}

// Rebuild flyout rows, marking the currently-focused cell's row as active.
function _refreshFlyout() {
  if (!_flyoutEl) return;
  _flyoutEl.innerHTML = '';

  const items = _cellItems();
  if (!items.length) return;

  // Detect which cell the editor focus is in.
  const activeEl  = document.activeElement;
  const cellEl    = activeEl?.closest?.('.nb-cell');
  const activeCellId = cellEl?.dataset?.nbId ?? null;

  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'bdf-row' + (activeCellId === item.cellId ? ' bdf-row--active' : '');
    row.innerHTML =
      `<span class="bdf-var">${item.varName}</span>` +
      `<span class="bdf-sep">·</span>` +
      `<span class="bdf-rows">${item.rows.toLocaleString()} rows, ${item.columns} cols</span>` +
      `<span class="bdf-cell-tag">cell ${item.cellNum}</span>`;
    _flyoutEl.appendChild(row);
  });
}

function _initDfSlot() {
  const slot = getDfSlot();
  if (!slot || _summaryEl) return; // already initialised

  _summaryEl = document.createElement('span');
  _summaryEl.className = 'bdb-df-summary';

  _flyoutEl = document.createElement('div');
  _flyoutEl.className = 'bdb-df-flyout';

  slot.appendChild(_summaryEl);
  slot.appendChild(_flyoutEl);

  // Refresh active-cell highlight each time the flyout is about to show.
  slot.addEventListener('mouseenter', _refreshFlyout);
}

document.addEventListener('dataset-updated', () => {
  _initDfSlot();
  _updateSummary();
  _refreshFlyout();
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initDfSlot);
} else {
  _initDfSlot();
}
