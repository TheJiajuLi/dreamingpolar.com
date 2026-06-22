import { getAllDatasets } from '../shared/dataset_store.js';
import { getCellDatasetInfo } from '../customise_code_block/customise_code_block.js';
import { installPackage } from '../compiler/compiler.js';

function getAiSlot()       { return document.getElementById('bdb-ai-slot'); }
function getCompilerSlot() { return document.getElementById('bdb-compiler-slot'); }
function getDfSlot()       { return document.getElementById('bdb-df-slot'); }

// AI slot: show only when the AI chat screen is open
document.addEventListener('screen-opened',    ({ detail: { id } }) => { if (id === 'ai-chat') getAiSlot()?.removeAttribute('hidden'); });
document.addEventListener('screen-closed',    ({ detail: { id } }) => { if (id === 'ai-chat') getAiSlot()?.setAttribute('hidden', ''); });
document.addEventListener('screen-minimized', ({ detail: { id } }) => { if (id === 'ai-chat') getAiSlot()?.setAttribute('hidden', ''); });

// ── Compiler status slot ──────────────────────────────────────────────────────
let _lastStatus = {};  // most recent dispatch detail for click popover

// Click popover for the compiler slot
let _statusPopover = null;
let _statusPopoverOpen = false;

function _getOrCreateStatusPopover() {
  if (_statusPopover) return _statusPopover;
  _statusPopover = document.createElement('div');
  _statusPopover.className = 'bdb-status-popover';
  document.body.appendChild(_statusPopover);
  document.addEventListener('click', e => {
    if (_statusPopoverOpen && !_statusPopover.contains(e.target) && !getCompilerSlot()?.contains(e.target)) {
      _closeStatusPopover();
    }
  });
  return _statusPopover;
}

function _closeStatusPopover() {
  _statusPopover?.classList.remove('bdb-status-popover--open');
  _statusPopoverOpen = false;
}

function _openStatusPopover() {
  const slot = getCompilerSlot();
  if (!slot) return;
  const pop = _getOrCreateStatusPopover();
  const { status, message, tip, elapsed, cellIndex, action } = _lastStatus;

  const lines = [];
  const statusLabel = { loading: '加载中', running: '执行中', ready: '就绪', error: '错误' }[status] ?? status;

  lines.push(`<div class="bsp-row bsp-status ${status}"><span class="bsp-dot"></span><strong>${statusLabel}</strong></div>`);
  lines.push(`<div class="bsp-row bsp-msg">${message ?? '—'}</div>`);

  if (elapsed != null) {
    lines.push(`<div class="bsp-row bsp-meta">耗时 ${elapsed < 1000 ? elapsed + ' ms' : (elapsed/1000).toFixed(2) + ' s'}</div>`);
  }
  if (cellIndex != null) {
    lines.push(`<div class="bsp-row bsp-meta">Cell ${cellIndex}</div>`);
  }
  if (tip && tip !== message) {
    lines.push(`<div class="bsp-row bsp-tip">${tip}</div>`);
  }
  if (action === 'scroll-to-cell' && cellIndex != null) {
    lines.push(`<button class="bsp-action" data-action="scroll" data-cell="${cellIndex}">↗ 跳转到输出</button>`);
  }
  if (status === 'error') {
    lines.push(`<button class="bsp-action bsp-action--danger" data-action="clear-error">✕ 忽略</button>`);
  }

  pop.innerHTML = lines.join('');

  // Bind action buttons
  pop.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const a = btn.dataset.action;
      if (a === 'scroll') {
        const cellNum = parseInt(btn.dataset.cell, 10);
        // Scroll the output panel to the matching section
        document.dispatchEvent(new CustomEvent('scroll-to-cell-output', { detail: { cellIndex: cellNum } }));
        _closeStatusPopover();
      } else if (a === 'clear-error') {
        document.dispatchEvent(new CustomEvent('compiler-status', {
          detail: { status: 'ready', message: 'Cleared' }
        }));
        _closeStatusPopover();
      }
    });
  });

  const rect = slot.getBoundingClientRect();
  pop.style.bottom = `${window.innerHeight - rect.top + 6}px`;
  pop.style.left   = `${rect.left}px`;
  pop.classList.add('bdb-status-popover--open');
  _statusPopoverOpen = true;
}

document.addEventListener('compiler-status', ({ detail }) => {
  _lastStatus = detail;
  const slot = getCompilerSlot();
  if (!slot) return;
  const spinning = detail.status === 'loading' || detail.status === 'running';
  slot.className = `bdb-slot bdb-compiler-slot ${detail.status}`;
  if (detail.percent != null) slot.style.setProperty('--pct', `${detail.percent}%`);
  const pctLabel = (detail.percent != null && detail.status === 'loading')
    ? `<span class="status-pct">${detail.percent}%</span>` : '';
  const elapsed = detail.elapsed != null
    ? `<span class="status-elapsed">${detail.elapsed < 1000 ? detail.elapsed + 'ms' : (detail.elapsed/1000).toFixed(1) + 's'}</span>`
    : '';
  slot.innerHTML = spinning
    ? `<span class="status-spinner"><i></i><i></i><i></i></span>${detail.message}${pctLabel}`
    : `${detail.message}${elapsed}`;

  // Make slot clickable — cursor hint
  slot.style.cursor = 'default';
  slot.title = '';

  // Close any open popover when status changes
  if (_statusPopoverOpen) _closeStatusPopover();
});

// Single listener added once
;(function _initCompilerSlotClick() {
  const slot = getCompilerSlot();
  if (!slot) { setTimeout(_initCompilerSlotClick, 300); return; }
  slot.addEventListener('click', e => {
    e.stopPropagation();
    _statusPopoverOpen ? _closeStatusPopover() : _openStatusPopover();
  });
})();

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
  // De-duplicate by name and only count entries with real rows (parsed data).
  if (!items.length) {
    const seen = new Set();
    const allDs = getAllDatasets().filter(d => {
      if (seen.has(d.name)) return false;
      seen.add(d.name);
      return Array.isArray(d.rows) && d.rows.length > 0;
    });
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

// Rebuild popover rows from both import-button datasets and kernel-detected dfs.
function _refreshFlyout() {
  if (!_flyoutEl) return;
  _flyoutEl.innerHTML = '';

  const importItems = _cellItems();
  const activeEl    = document.activeElement;
  const activeCellId = activeEl?.closest?.('.nb-cell')?.dataset?.nbId ?? null;

  if (importItems.length) {
    // Import-button datasets with cell info and active-cell highlight
    importItems.forEach(item => {
      const row = document.createElement('div');
      row.className = 'bdf-row' + (activeCellId === item.cellId ? ' bdf-row--active' : '');
      row.innerHTML =
        `<span class="bdf-var">${item.varName}</span>` +
        `<span class="bdf-sep">·</span>` +
        `<span class="bdf-rows">${item.rows.toLocaleString()} rows, ${item.columns} cols</span>` +
        `<span class="bdf-cell-tag">cell ${item.cellNum}</span>`;
      _flyoutEl.appendChild(row);
    });
  } else {
    // Kernel-detected DataFrames (Python code path, no import button used)
    Object.entries(_kernelDfs).forEach(([name, { rows, cols }]) => {
      const row = document.createElement('div');
      row.className = 'bdf-row';
      row.innerHTML =
        `<span class="bdf-var">${name}</span>` +
        `<span class="bdf-sep">·</span>` +
        `<span class="bdf-rows">${rows.toLocaleString()} rows, ${cols} cols</span>`;
      _flyoutEl.appendChild(row);
    });
  }
}

// ── Click-triggered fixed-position popover ────────────────────────────────────
// The flyout is a child of <body> with position:fixed, so it escapes every
// stacking context (opacity layers, z-index hierarchies, overflow:hidden) that
// would clip a position:absolute child inside the bottom bar.

let _popoverOpen = false;

function _openPopover() {
  if (!_summaryEl) return;
  _refreshFlyout();
  if (!_flyoutEl.children.length) return; // nothing to show

  const rect = _summaryEl.getBoundingClientRect();
  _flyoutEl.style.right  = `${window.innerWidth - rect.right}px`;
  _flyoutEl.style.bottom = `${window.innerHeight - rect.top + 6}px`;
  _flyoutEl.style.top    = '';
  _flyoutEl.classList.add('bdb-df-flyout--open');
  _popoverOpen = true;
}

function _closePopover() {
  _flyoutEl?.classList.remove('bdb-df-flyout--open');
  _popoverOpen = false;
}

function _initDfSlot() {
  const slot = getDfSlot();
  if (!slot || _summaryEl) return; // already initialised

  _summaryEl = document.createElement('span');
  _summaryEl.className = 'bdb-df-summary';

  _flyoutEl = document.createElement('div');
  _flyoutEl.className = 'bdb-df-flyout';
  document.body.appendChild(_flyoutEl); // mount on body — no stacking context issues

  slot.appendChild(_summaryEl);

  // Toggle popover on click
  _summaryEl.addEventListener('click', e => {
    e.stopPropagation();
    _popoverOpen ? _closePopover() : _openPopover();
  });

  // Close when clicking anywhere outside the popover
  document.addEventListener('click', e => {
    if (_popoverOpen && !_flyoutEl.contains(e.target)) _closePopover();
  });
}

document.addEventListener('dataset-updated', () => {
  _initDfSlot();
  _updateSummary();
  _refreshFlyout();
});

// ── Kernel restart: wipe stale dataset info ───────────────────────────────────
document.addEventListener('kernel-restarted', () => {
  _kernelDfs = {};
  _initDfSlot();
  const slot = getDfSlot();
  if (slot && _summaryEl) {
    slot.removeAttribute('hidden');
    _summaryEl.textContent = 'No active files — run a cell to reload';
    if (_flyoutEl) _flyoutEl.innerHTML = '';
  }
});

// ── DataFrame detection from Python execution ─────────────────────────────────
// When Python cells run, queryKernelDataframes() fires kernel-dfs-updated with
// the current DataFrame namespace. If no import-button datasets exist, we use
// this to populate the df slot so Python-code DataFrames are visible too.
let _kernelDfs = {}; // { varName: { rows, cols } }

document.addEventListener('kernel-dfs-updated', ({ detail: { dfs } }) => {
  _kernelDfs = dfs ?? {};
  _initDfSlot();
  _updateKernelDfSummary();
});

function _updateKernelDfSummary() {
  // Only take over the slot when the import-button path has no datasets.
  const slot = getDfSlot();
  if (!slot || !_summaryEl) return;
  const importItems = _cellItems();
  const allDs = getAllDatasets();
  if (importItems.length || allDs.length) return; // import-button data takes priority

  const entries = Object.entries(_kernelDfs);
  if (!entries.length) { slot.setAttribute('hidden', ''); return; }

  const totalRows = entries.reduce((s, [, v]) => s + v.rows, 0);
  const totalCols = entries.reduce((s, [, v]) => s + v.cols, 0);
  const n = entries.length;
  slot.removeAttribute('hidden');
  _summaryEl.textContent =
    `${n} df${n === 1 ? '' : 's'} · ${totalRows.toLocaleString()} rows · ${totalCols} cols`;

}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initDfSlot);
} else {
  _initDfSlot();
}

// ── Missing-package install prompt ────────────────────────────────────────────
// Created lazily and reused for subsequent requests.
let _pkgSlot    = null;
let _pkgBusy    = false;
let _pkgCellId  = null;

function _getPkgSlot() {
  if (_pkgSlot) return _pkgSlot;
  _pkgSlot = document.createElement('div');
  _pkgSlot.className = 'bdb-slot bdb-pkg-slot';
  _pkgSlot.setAttribute('hidden', '');
  const bar = document.getElementById('bottom-data-bar');
  if (bar) bar.appendChild(_pkgSlot);
  return _pkgSlot;
}

function _showPkgPrompt(pkg, cellId) {
  if (_pkgBusy) return; // don't interrupt an in-progress install
  _pkgCellId = cellId;
  const slot = _getPkgSlot();
  slot.innerHTML =
    `<span class="bdb-pkg-icon">📦</span>` +
    `<span class="bdb-pkg-msg"><strong>${pkg}</strong> not loaded</span>` +
    `<button class="bdb-pkg-load-btn" data-pkg="${pkg}">Load</button>` +
    `<button class="bdb-pkg-dismiss" title="Dismiss">✕</button>`;
  slot.removeAttribute('hidden');

  slot.querySelector('.bdb-pkg-load-btn').addEventListener('click', () => _doInstall(pkg, cellId));
  slot.querySelector('.bdb-pkg-dismiss').addEventListener('click', _dismissPkg);
}

function _dismissPkg() {
  if (_pkgBusy) return;
  _pkgSlot?.setAttribute('hidden', '');
  _pkgCellId = null;
}

async function _doInstall(pkg, cellId) {
  if (_pkgBusy) return;
  _pkgBusy = true;
  const slot = _getPkgSlot();
  slot.innerHTML =
    `<span class="bdb-pkg-icon">⏳</span>` +
    `<span class="bdb-pkg-msg">Loading <strong>${pkg}</strong>…</span>`;

  const result = await installPackage(pkg);

  _pkgBusy = false;

  if (result.success) {
    slot.setAttribute('hidden', '');
    _pkgCellId = null;
    // Signal the originating cell to re-run now that the package is available.
    document.dispatchEvent(new CustomEvent('package-installed', {
      detail: { pkg, cellId },
    }));
  } else {
    slot.innerHTML =
      `<span class="bdb-pkg-icon">⚠</span>` +
      `<span class="bdb-pkg-msg" title="${result.error}">` +
        `<strong>${pkg}</strong> — not available in browser` +
      `</span>` +
      `<button class="bdb-pkg-dismiss" title="Dismiss">✕</button>`;
    slot.querySelector('.bdb-pkg-dismiss').addEventListener('click', _dismissPkg);
  }
}

document.addEventListener('package-missing', ({ detail }) => {
  if (!detail?.pkg) return;
  _showPkgPrompt(detail.pkg, detail.cellId ?? null);
});
