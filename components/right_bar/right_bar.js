// ── Right Bar — DataFrame Stats ──────────────────────────────────────────────
// Pure-JS stats from dataset_store. ZERO Python. ZERO Pyodide.
//
// 🚨 DO NOT add `import { compile }` or any other import from compiler.js.
//    Doing so will trigger the Pyodide boot animation when this button is
//    clicked — this has regressed three times already. The _assertNoPython()
//    guard below will fire console.error the moment this rule is violated.

import { getDataset } from '../shared/dataset_store.js';

// ── 🚨 REGRESSION GUARD ──────────────────────────────────────────────────────
// typeof on an undeclared identifier never throws — returns 'undefined'.
// If compile / getPyodide are NOT imported, these checks are silent no-ops.
// If they ARE accidentally imported (the regression), they fire immediately.
function _assertNoPython(caller) {
  if (typeof compile !== 'undefined') {        // eslint-disable-line no-undef
    console.error(
      `🚨 REGRESSION [${caller}]: compile() is in scope in right_bar.js. ` +
      'Remove any compiler.js import from this file. Stats must use dataset_store only.'
    );
  }
  if (typeof getPyodide !== 'undefined') {     // eslint-disable-line no-undef
    console.error(
      `🚨 REGRESSION [${caller}]: getPyodide() is in scope in right_bar.js. ` +
      'Remove any compiler.js import from this file immediately.'
    );
  }
}

// ── DOM field IDs ─────────────────────────────────────────────────────────────
const ID = {
  rows:   'rb-stat-rows',
  cols:   'rb-stat-cols',
  nulls:  'rb-stat-nulls',
  memory: 'rb-stat-memory',
  dot:    'rb-stats-dot',
  panel:  'rb-stats-panel',
  btn:    'rb-stats-btn',
};

// ── Update panel fields ───────────────────────────────────────────────────────
function _applyData(data) {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const has = data && typeof data.rows === 'number';
  set(ID.rows,   has ? data.rows.toLocaleString()         : '--');
  set(ID.cols,   has ? String(data.cols)                  : '--');
  set(ID.nulls,  has ? data.nulls.toLocaleString()        : '--');
  set(ID.memory, has ? data.memory_mb.toFixed(2) + ' MB'  : '--');
  const dot = document.getElementById(ID.dot);
  if (dot) dot.classList.toggle('rb-stats-dot--active', has);
}

// ── Public: compute stats from dataset_store and refresh panel ────────────────
// Intentionally synchronous and pure-JS.
// Must NEVER call compile(), getPyodide(), or any async Python path.
export function renderKernelStatus() {
  _assertNoPython('renderKernelStatus');

  const ds = getDataset();
  if (!ds || !ds.rows.length) { _applyData({}); return; }

  // Count nulls: null / undefined / empty-string all count
  let nulls = 0;
  for (const row of ds.rows) {
    for (const col of ds.columns) {
      const v = row[col];
      if (v === null || v === undefined || v === '') nulls++;
    }
  }

  // Memory estimate: UTF-8 byte length of the JSON-serialised rows
  const memBytes = new TextEncoder().encode(JSON.stringify(ds.rows)).length;

  _applyData({
    rows:      ds.rows.length,
    cols:      ds.columns.length,
    nulls,
    memory_mb: memBytes / 1048576,
  });
}

// ── Build floating stats panel ────────────────────────────────────────────────
function _buildPanel() {
  const panel = document.createElement('div');
  panel.id        = ID.panel;
  panel.className = 'rb-stats-panel';
  panel.hidden    = true;
  panel.innerHTML = `
    <div class="rb-stats-header">DATAFRAME · df</div>
    <div class="rb-stats-row">
      <span class="rb-stats-label">Rows</span>
      <span class="rb-stats-val rb-val-blue" id="${ID.rows}">--</span>
    </div>
    <div class="rb-stats-row">
      <span class="rb-stats-label">Columns</span>
      <span class="rb-stats-val rb-val-blue" id="${ID.cols}">--</span>
    </div>
    <div class="rb-stats-row">
      <span class="rb-stats-label">Nulls</span>
      <span class="rb-stats-val rb-val-green" id="${ID.nulls}">--</span>
    </div>
    <div class="rb-stats-row">
      <span class="rb-stats-label">Memory</span>
      <span class="rb-stats-val" id="${ID.memory}">--</span>
    </div>
  `;
  document.body.appendChild(panel);
  return panel;
}

// ── Build the icon button in the right bar ────────────────────────────────────
function _buildBtn(panel) {
  const btn = document.createElement('button');
  btn.id        = ID.btn;
  btn.className = 'rb-btn rb-stats-btn';
  btn.title     = 'DataFrame — Rows / Columns / Nulls / Memory';
  btn.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <line x1="3"  y1="9"  x2="21" y2="9"/>
      <line x1="3"  y1="15" x2="21" y2="15"/>
      <line x1="9"  y1="3"  x2="9"  y2="21"/>
    </svg>
    <span class="rb-stats-dot" id="${ID.dot}" aria-hidden="true"></span>
  `;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    _assertNoPython('rb-stats-btn click');  // 🚨 fires if compile leaked in

    const opening = panel.hidden;
    panel.hidden = !opening;

    if (opening) {
      const rb      = document.getElementById('right-bar');
      const btnRect = btn.getBoundingClientRect();
      const rbRect  = rb ? rb.getBoundingClientRect() : { left: window.innerWidth };
      const left    = Math.max(4, rbRect.left - 200 - 6);
      const top     = Math.min(btnRect.top, window.innerHeight - 180);
      panel.style.left = left + 'px';
      panel.style.top  = top  + 'px';
      renderKernelStatus();
    }
  });

  document.addEventListener('click', (e) => {
    if (panel.hidden) return;
    if (!btn.contains(e.target) && !panel.contains(e.target)) panel.hidden = true;
  });

  return btn;
}

// ── Public: initialise right bar (idempotent) ─────────────────────────────────
export function initRightBar() {
  const rbTop = document.querySelector('#right-bar .rb-top');
  if (!rbTop || document.getElementById(ID.btn)) return;
  const panel = _buildPanel();
  const btn   = _buildBtn(panel);
  rbTop.appendChild(btn);
}

// ── Auto-init ─────────────────────────────────────────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initRightBar);
} else {
  initRightBar();
}

// ── Live update when dataset changes ─────────────────────────────────────────
// Replaces the old kernel-mutation listener. dataset-updated is pure JS,
// dispatched by dataset_store.js — zero Python involved.
document.addEventListener('dataset-updated', () => {
  const panel = document.getElementById(ID.panel);
  if (panel && !panel.hidden) renderKernelStatus();
});
