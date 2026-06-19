// ── Right Bar — Kernel Status ─────────────────────────────────────────────────
// Renders live DataFrame stats (Rows / Columns / Nulls / Memory) by running
// a lightweight Python snippet in the shared Pyodide kernel.
//
// Public API:
//   renderKernelStatus(varName?)  — query kernel and update the panel
//   initRightBar()                — build icon + panel, attach to #right-bar

import { compile } from '../compiler/compiler.js';

// ── Python stats query ────────────────────────────────────────────────────────
// compile() runs code via exec(_user_code, _ns) where _ns = _dp_kernel_ns.
// Inside that exec context, globals() returns _ns itself, so we can reach
// variables by name — but _dp_kernel_ns is NOT a key in _ns, so we must
// NOT reference it by name. Use globals().get(varName) instead.
function _buildPython(varName) {
  return `
import json as _j, pandas as _pd
try:
    _df = globals().get(${JSON.stringify(varName)})
    if isinstance(_df, _pd.DataFrame) and len(_df) > 0:
        print(_j.dumps({
            'rows':      int(_df.shape[0]),
            'cols':      int(_df.shape[1]),
            'nulls':     int(_df.isnull().sum().sum()),
            'memory_mb': round(float(_df.memory_usage(deep=True).sum()) / 1048576, 2),
        }))
    else:
        print(_j.dumps({}))
except Exception as _rb_err:
    import sys as _sys
    print(_j.dumps({'__error__': str(_rb_err)}), file=_sys.stderr)
    print(_j.dumps({}))
`.trim();
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function _textOutput(outputs) {
  return outputs.find(o => o.type === 'text')?.content?.trim() ?? '';
}

// ── DOM field IDs (stable, used by both build + update) ──────────────────────
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
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  const hasData = data && typeof data.rows === 'number';
  set(ID.rows,   hasData ? data.rows.toLocaleString()          : '--');
  set(ID.cols,   hasData ? String(data.cols)                   : '--');
  set(ID.nulls,  hasData ? data.nulls.toLocaleString()         : '--');
  set(ID.memory, hasData ? data.memory_mb.toFixed(2) + ' MB'  : '--');

  // Status dot: green when df is loaded, dim when empty
  const dot = document.getElementById(ID.dot);
  if (dot) dot.classList.toggle('rb-stats-dot--active', hasData);
}

// ── Public: query kernel and refresh the panel ───────────────────────────────
export async function renderKernelStatus(varName = 'df') {
  try {
    const outputs = await compile(_buildPython(varName), 'python');
    const text    = _textOutput(outputs);
    // Surface any Python-level errors that the snippet reported via stderr
    const errBlock = outputs.find(o => o.type === 'error');
    if (errBlock) {
      console.warn('[right_bar] renderKernelStatus Python error:', errBlock.content);
    }
    _applyData(text ? JSON.parse(text) : {});
  } catch (e) {
    console.warn('[right_bar] renderKernelStatus failed:', e);
    _applyData({});
  }
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
    const opening = panel.hidden;
    panel.hidden = !opening;

    if (opening) {
      // Position the panel just to the left of the right bar
      const rb       = document.getElementById('right-bar');
      const btnRect  = btn.getBoundingClientRect();
      const rbRect   = rb ? rb.getBoundingClientRect() : { left: window.innerWidth };
      const panelW   = 200;
      const left     = Math.max(4, rbRect.left - panelW - 6);
      const top      = Math.min(btnRect.top, window.innerHeight - 180);
      panel.style.left = left + 'px';
      panel.style.top  = top  + 'px';

      // Always re-query kernel when opening
      renderKernelStatus();
    }
  });

  // Dismiss on outside click
  document.addEventListener('click', (e) => {
    if (panel.hidden) return;
    if (!btn.contains(e.target) && !panel.contains(e.target)) {
      panel.hidden = true;
    }
  });

  return btn;
}

// ── Public: initialise right bar (idempotent) ─────────────────────────────────
export function initRightBar() {
  const rbTop = document.querySelector('#right-bar .rb-top');
  if (!rbTop || document.getElementById(ID.btn)) return; // already init'd

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

// ── React to kernel mutations dispatched by compiler.js ───────────────────────
// Guard against re-entrancy: the stats query itself triggers kernel-mutation
// (via afterKernelMutation in _runPython), which would cause an infinite loop.
let _statsRefreshing = false;
document.addEventListener('kernel-mutation', ({ detail: { varName = 'df' } }) => {
  if (_statsRefreshing) return;
  _statsRefreshing = true;
  renderKernelStatus(varName)
    .catch(() => {})
    .finally(() => { _statsRefreshing = false; });
});
