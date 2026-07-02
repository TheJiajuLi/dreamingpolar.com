import { getAllDatasets } from '../shared/dataset_store.js';
import { getCellDatasetInfo } from '../customise_code_block/customise_code_block.js';
import { installPackage, queryKernelContext } from '../compiler/compiler.js';

function getAiSlot()       { return document.getElementById('bdb-ai-slot'); }
function getCompilerSlot() { return document.getElementById('bdb-compiler-slot'); }
function getDfSlot()       { return document.getElementById('bdb-df-slot'); }

// AI slot: show only when the AI chat screen is open
document.addEventListener('screen-opened',    ({ detail: { id } }) => { if (id === 'ai-chat') getAiSlot()?.removeAttribute('hidden'); });
document.addEventListener('screen-closed',    ({ detail: { id } }) => { if (id === 'ai-chat') getAiSlot()?.setAttribute('hidden', ''); });
document.addEventListener('screen-minimized', ({ detail: { id } }) => { if (id === 'ai-chat') getAiSlot()?.setAttribute('hidden', ''); });

// ── Screen label in compiler slot ─────────────────────────────────────────────
const SCREEN_LABELS = {
  'coding':   'Power Notebook',
  'terminal': 'ARIA 分析助手',
  'grid':     'DP Grid',
  'ai-chat':  '客服中心',
  'profile':  '用户主页',
  'content':  '帮助文档',
};

let _activeScreenId = null; 

function _findActiveScreenFromDom() {
  const nodes = Array.from(document.querySelectorAll('[data-screen-id][data-screen-state]'));
  if (!nodes.length) return null;

  const pickByState = state => {
    return nodes.find(node => {
      if (node.dataset.screenState !== state) return false;
      return Boolean(SCREEN_LABELS[node.dataset.screenId]);
    });
  };

  const picked =
    pickByState('maximized') ||
    pickByState('normal') ||
    pickByState('hidden-by-max');

  return picked?.dataset.screenId ?? null;
}

function _syncActiveScreenFromDom() {
  const current = _findActiveScreenFromDom();
  if (!current) return false;
  if (_activeScreenId === current) return true;
  _activeScreenId = current;
  _updateSlotLabel();
  return true;
}

function _bootstrapActiveScreenLabel(retries = 10) {
  if (_syncActiveScreenFromDom()) return;
  if (retries <= 0) {
    _updateSlotLabel();
    return;
  }
  setTimeout(() => _bootstrapActiveScreenLabel(retries - 1), 120);
}

function _updateSlotLabel() {
  const slot = getCompilerSlot();
  if (!slot) return;
  if (slot.classList.contains('loading') || slot.classList.contains('running')) return;
  const label = _activeScreenId
    ? (SCREEN_LABELS[_activeScreenId] ?? 'Dreaming Polar')
    : 'Dreaming Polar';
  slot.textContent = label;
}

document.addEventListener('screen-opened',    ({ detail: { id } }) => { _activeScreenId = id;                                             _updateSlotLabel(); });
document.addEventListener('screen-closed',    ({ detail: { id } }) => {
  if (_activeScreenId !== id) return;
  _activeScreenId = null;
  if (!_syncActiveScreenFromDom()) _updateSlotLabel();
});
document.addEventListener('screen-minimized', ({ detail: { id } }) => {
  if (_activeScreenId !== id) return;
  _activeScreenId = null;
  if (!_syncActiveScreenFromDom()) _updateSlotLabel();
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => _bootstrapActiveScreenLabel());
} else {
  _bootstrapActiveScreenLabel();
}

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
  if (spinning) {
    slot.innerHTML = `<span class="status-spinner"><i></i><i></i><i></i></span>${detail.message}${pctLabel}`;
  } else {
    _updateSlotLabel();
  }

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
    _summaryEl.textContent = `${n} df · ${rows.toLocaleString()} 行 · ${cols} 列`;
    return;
  }

  const totalRows = items.reduce((s, i) => s + i.rows,    0);
  const totalCols = items.reduce((s, i) => s + i.columns, 0);
  const n = items.length;
  slot.removeAttribute('hidden');
  _summaryEl.textContent = `${n} df · ${totalRows.toLocaleString()} 行 · ${totalCols} 列`;
}

// ── Rich kernel panel ─────────────────────────────────────────────────────────
function _makeSection(title, icon) {
  const hdr = document.createElement('div');
  hdr.className = 'bdf-section-hdr';
  hdr.innerHTML = `<i class="ti ${icon}"></i><span>${title}</span>`;
  return hdr;
}

function _makeDfRow(varName, shape, extra = '') {
  const row = document.createElement('div');
  row.className = 'bdf-row bdf-row--df';
  const shapeStr = Array.isArray(shape) ? shape.join(' × ') : shape;
  row.innerHTML =
    `<i class="ti ti-table-options bdf-type-icon" style="color:#6366f1"></i>` +
    `<span class="bdf-var">${varName}</span>` +
    `<span class="bdf-shape">${shapeStr}</span>` +
    (extra ? `<span class="bdf-extra">${extra}</span>` : '') +
    `<button class="bdf-grid-btn" title="在 Grid 中打开" data-var="${varName}">` +
      `<i class="ti ti-table"></i>` +
    `</button>`;
  row.querySelector('.bdf-grid-btn').addEventListener('click', e => {
    e.stopPropagation();
    _closePopover();
    window._gridOpenDataset?.({ _from: 'kernel', varName, filename: varName + '.csv' });
    window.screenController?.open('grid');
  });
  return row;
}

function _makeVarRow(varName, kindLabel, shapeStr) {
  const row = document.createElement('div');
  row.className = 'bdf-row';
  const iconMap = { ndarray: 'ti-vector-triangle', Series: 'ti-chart-line', number: 'ti-number' };
  const colorMap = { ndarray: '#f59e0b', Series: '#10b981', number: '#64748b' };
  const icon  = iconMap[kindLabel]  ?? 'ti-variable';
  const color = colorMap[kindLabel] ?? '#94a3b8';
  row.innerHTML =
    `<i class="ti ${icon} bdf-type-icon" style="color:${color}"></i>` +
    `<span class="bdf-var" style="color:var(--text,#0f172a)">${varName}</span>` +
    `<span class="bdf-shape">${shapeStr}</span>`;
  return row;
}

function _makeFileRow(entry) {
  const row = document.createElement('div');
  row.className = 'bdf-row';
  const { filename, varName, rows, columns } = entry;
  row.innerHTML =
    `<i class="ti ti-file-type-csv bdf-type-icon" style="color:#10b981"></i>` +
    `<span class="bdf-var" style="color:var(--text,#0f172a)">${filename ?? varName}</span>` +
    `<span class="bdf-shape">${rows != null ? rows.toLocaleString() + ' × ' + columns : varName}</span>`;
  return row;
}

async function _refreshFlyout() {
  if (!_flyoutEl) return;
  _flyoutEl.innerHTML = `<div class="bdf-loading"><i class="ti ti-loader-2 bdf-spin"></i> 读取内核状态…</div>`;

  // Fetch live kernel context from Worker
  let kernelVars = [];
  try { kernelVars = await queryKernelContext(); } catch (_) {}

  _flyoutEl.innerHTML = '';

  const dfs     = kernelVars.filter(v => v.kind === 'DataFrame');
  const others  = kernelVars.filter(v => v.kind !== 'DataFrame');

  // ── Section: DataFrames ────────────────────────────────────────────────────
  if (dfs.length) {
    _flyoutEl.appendChild(_makeSection('DataFrames', 'ti-table-options'));
    dfs.forEach(v => {
      const [r, c] = v.shape ?? [];
      _flyoutEl.appendChild(_makeDfRow(v.varName, [r?.toLocaleString(), c], ''));
    });
  }

  // ── Section: Other variables ───────────────────────────────────────────────
  if (others.length) {
    _flyoutEl.appendChild(_makeSection('其他变量', 'ti-variable'));
    others.forEach(v => {
      const shapeStr = v.shape ? v.shape.map(n => n?.toLocaleString?.() ?? n).join(' × ') : '—';
      _flyoutEl.appendChild(_makeVarRow(v.varName, v.kind, shapeStr));
    });
  }

  // ── Section: Loaded files (inject-store) ───────────────────────────────────
  const importItems = _cellItems();
  const allDs = getAllDatasets();
  const fileEntries = importItems.length
    ? importItems.map(i => ({ filename: i.filename, varName: i.varName, rows: i.rows, columns: i.columns }))
    : allDs.map(d => ({ filename: d.name, varName: d.varName ?? d.name, rows: null, columns: null }));

  if (fileEntries.length) {
    _flyoutEl.appendChild(_makeSection('已加载文件', 'ti-database'));
    fileEntries.forEach(e => _flyoutEl.appendChild(_makeFileRow(e)));
  }

  if (!dfs.length && !others.length && !fileEntries.length) {
    _flyoutEl.innerHTML = `<div class="bdf-empty">还没有变量 — 运行一个 Python cell 开始分析</div>`;
  }
}

// ── Click-triggered fixed-position popover ────────────────────────────────────
// The flyout is a child of <body> with position:fixed, so it escapes every
// stacking context (opacity layers, z-index hierarchies, overflow:hidden) that
// would clip a position:absolute child inside the bottom bar.

let _popoverOpen = false;

async function _openPopover() {
  if (!_summaryEl) return;
  const rect = _summaryEl.getBoundingClientRect();
  _flyoutEl.style.right  = `${window.innerWidth - rect.right}px`;
  _flyoutEl.style.bottom = `${window.innerHeight - rect.top + 6}px`;
  _flyoutEl.style.top    = '';
  _flyoutEl.classList.add('bdb-df-flyout--open');
  _popoverOpen = true;
  await _refreshFlyout(); // async: fetches kernel context from Worker
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
    `${n} df · ${totalRows.toLocaleString()} 行 · ${totalCols} 列`;

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
