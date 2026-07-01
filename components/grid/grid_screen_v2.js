// ── DP Grid — Phase 3: row/col CRUD, multi-select, pagination, Pro banner ─────
import { getAllDatasets, setDataset }        from '../shared/dataset_store.js';
import { createNudgeBanner }               from '../shared/nudge_banner/nudge_banner.js';
import { injectDataFrame, getPyodide }       from '../compiler/compiler.js';
import { downloadBlob }                      from '../shared/file_download.js';
import { getSettings }                       from '../right_bar/settings.js';
import { recordRecentItem }                  from '../empty_state_dashboard/empty_state_dashboard.js';

const INJECT_KEY = 'dreaming-polar-inject-store';
const MAX_TABS   = 8;
const PAGE_SIZE  = 200;   // rows per page
const PRO_LIMIT  = 500;   // free-tier row ceiling — shows upsell above this

// ── CSV helpers ───────────────────────────────────────────────────────────────
function _escCSV(v) {
  const s = String(v ?? '');
  return (s.includes(',') || s.includes('"') || s.includes('\n'))
    ? `"${s.replace(/"/g, '""')}"` : s;
}
function _rowsToCSV(columns, rows) {
  const header = columns.map(_escCSV).join(',');
  const body   = rows.map(row => columns.map(c => _escCSV(row[c])).join(',')).join('\n');
  return header + '\n' + body;
}

// ── Parse raw inject-store data ───────────────────────────────────────────────
function _parseInjectEntry(entry) {
  try {
    const raw = entry.isBase64 ? atob(entry.data) : entry.data;
    if (!raw) return null;
    const lines = raw.split('\n').filter(l => l.trim());
    if (lines.length < 2) return null;
    const parseCSVLine = line => {
      const res = []; let cur = ''; let inQ = false;
      for (const ch of line) {
        if (ch === '"') { inQ = !inQ; }
        else if (ch === ',' && !inQ) { res.push(cur.trim()); cur = ''; }
        else cur += ch;
      }
      res.push(cur.trim());
      return res;
    };
    const headers = parseCSVLine(lines[0]);
    const rows = lines.slice(1).map(l => {
      const vals = parseCSVLine(l);
      const obj = {};
      headers.forEach((h, i) => { obj[h] = vals[i] ?? ''; });
      return obj;
    });
    const dtypes = {};
    headers.forEach(h => {
      const samples = rows.slice(0, 20).map(r => r[h]).filter(v => v !== '' && v != null);
      if (samples.every(v => !isNaN(Number(v)))) {
        dtypes[h] = samples.some(v => String(v).includes('.')) ? 'float64' : 'int64';
      } else if (samples.every(v => !isNaN(Date.parse(v)) && String(v).includes('-'))) {
        dtypes[h] = 'datetime64';
      } else { dtypes[h] = 'object'; }
    });
    return { columns: headers, dtypes, rows };
  } catch { return null; }
}

// ── Normalise source → { varName, filename, columns, dtypes, rows } ──────────
function _normalise(source) {
  if (source._from === 'store') {
    return { varName: source.varName || source.name, filename: source.name,
             columns: source.columns ?? [], dtypes: source.dtypes ?? {}, rows: source.rows ?? [] };
  }
  if (source._from === 'inject') {
    const parsed = _parseInjectEntry(source);
    return { varName: source.varName, filename: source.filename,
             columns: parsed?.columns ?? source.columnNames ?? [],
             dtypes: parsed?.dtypes ?? {}, rows: parsed?.rows ?? [] };
  }
  return null;
}

function _dtypeLabel(dtype) {
  if (!dtype) return '';
  if (dtype.includes('int'))      return 'int';
  if (dtype.includes('float'))    return 'float';
  if (dtype.includes('datetime')) return 'datetime';
  if (dtype.includes('bool'))     return 'bool';
  return 'str';
}
function _isNumCol(dtypes, col) {
  const l = _dtypeLabel(dtypes[col]);
  return l === 'int' || l === 'float';
}

// ── Apply filter conditions ───────────────────────────────────────────────────
function _applyFilters(rows, filters, dtypes) {
  if (!filters.length) return rows;
  return rows.filter(row => filters.every(f => {
    const raw = row[f.col] ?? '';
    const isNum = _isNumCol(dtypes, f.col);
    const rv = isNum ? Number(raw) : String(raw);
    const fv = isNum ? Number(f.val) : String(f.val);
    switch (f.op) {
      case '=':   return isNum ? rv === fv : String(rv) === String(fv);
      case '≠':   return isNum ? rv !== fv : String(rv) !== String(fv);
      case '>':   return rv  >  fv;
      case '<':   return rv  <  fv;
      case '≥':   return rv  >= fv;
      case '≤':   return rv  <= fv;
      case '包含': return String(raw).includes(String(f.val));
      default: return true;
    }
  }));
}

// ── Ensure unique column name ─────────────────────────────────────────────────
function _uniqueColName(columns, base) {
  let name = base; let n = 2;
  while (columns.includes(name)) { name = `${base}${n++}`; }
  return name;
}

// ── Build table HTML ──────────────────────────────────────────────────────────
function _buildTable(ds, sortState, editState, filters, limit, selSet) {
  const { columns, dtypes } = ds;
  const workingRows = editState ? [...editState.rows] : [...ds.rows];
  const { col: sortCol, dir: sortDir } = sortState;
  const lim = limit ?? PAGE_SIZE;

  let displayRows = [...workingRows];
  if (sortCol !== null && sortDir !== 0) {
    displayRows.sort((a, b) => {
      const va = a[sortCol] ?? ''; const vb = b[sortCol] ?? '';
      const na = Number(va), nb = Number(vb);
      const cmp = (!isNaN(na) && !isNaN(nb)) ? na - nb : String(va).localeCompare(String(vb));
      return sortDir === 1 ? cmp : -cmp;
    });
  }

  const filteredRows = _applyFilters(displayRows, filters, dtypes);
  const truncated    = filteredRows.length > lim;
  const renderRows   = truncated ? filteredRows.slice(0, lim) : filteredRows;

  let thead = '<thead><tr><th class="th-row">#</th>';
  columns.forEach(col => {
    const label  = _dtypeLabel(dtypes[col]);
    const isSort = col === sortCol;
    const cls    = isSort ? (sortDir === 1 ? 'sorted-asc' : sortDir === -1 ? 'sorted-desc' : '') : '';
    thead += `<th class="${cls}" data-col="${col}">
      <div class="th-inner">
        <span class="th-name">${col}</span>
        ${label ? `<span class="dtype-badge ${label}">${label}</span>` : ''}
        <span class="sort-icon"></span>
      </div></th>`;
  });
  thead += '</tr></thead>';

  const origIndexMap = new Map(workingRows.map((r, i) => [r, i]));

  let tbody = '<tbody>';
  renderRows.forEach((row, dispIdx) => {
    const origIdx    = origIndexMap.get(row) ?? dispIdx;
    const isDirty    = editState?.dirtyIndices?.has(origIdx);
    const isSelected = selSet?.has(origIdx);
    const rowCls     = [isDirty ? 'grid-row--dirty' : '', isSelected ? 'grid-row--selected' : ''].filter(Boolean).join(' ');
    tbody += `<tr class="${rowCls}" data-orig-idx="${origIdx}">`;
    tbody += `<td class="td-row grid-row-num">${dispIdx + 1}</td>`;
    columns.forEach(col => {
      const v       = row[col];
      const isNull  = v === null || v === undefined || v === '';
      const numCls  = _isNumCol(dtypes, col) ? ' num' : '';
      const nullCls = isNull ? ' null-val' : '';
      tbody += `<td class="${numCls}${nullCls}" data-col="${col}" data-orig-idx="${origIdx}">${isNull ? '' : v}</td>`;
    });
    tbody += '</tr>';
  });
  tbody += '</tbody>';

  return {
    html: `<table class="grid-table">${thead}${tbody}</table>`,
    truncated,
    total: workingRows.length,
    filteredTotal: filteredRows.length,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// Main setup
// ══════════════════════════════════════════════════════════════════════════════
function setupGridScreen() {
  const screen = document.getElementById('grid-screen');
  if (!screen) return;

  requestAnimationFrame(() => {
    window.screenController?.register('grid', screen, {
      label: 'Grid', group: 'hero', persisted: false, defaultOpen: false, noChip: true,
    });
  });

  // ── VT button ──────────────────────────────────────────────────────────────
  const vtTop = document.querySelector('#vertical-toolbar .vt-top');
  if (vtTop) {
    const btn = document.createElement('button');
    btn.className = 'grid-vt-btn';
    btn.title     = 'DP Grid';
    btn.innerHTML = '<i class="ti ti-table" style="font-size:18px"></i>';
    btn.addEventListener('click', () => {
      const state = window.screenController?.getState('grid');
      if (!state || state === 'closed' || state === 'minimized') {
        window.screenController?.open('grid');
        btn.classList.add('active');
        document.dispatchEvent(new CustomEvent('vt-btn-activated', { detail: { id: 'grid' } }));
      } else {
        window.screenController?.close('grid');
        btn.classList.remove('active');
      }
    });
    document.addEventListener('vt-btn-activated', ({ detail: { id } }) => { if (id !== 'grid') btn.classList.remove('active'); });
    document.addEventListener('screen-closed',    ({ detail }) => { if (detail.id === 'grid') btn.classList.remove('active'); });
    document.addEventListener('screen-minimized', ({ detail }) => { if (detail.id === 'grid') btn.classList.remove('active'); });
    document.addEventListener('screen-opened',    ({ detail }) => {
      if (detail.id === 'grid') {
        btn.classList.add('active');
        document.dispatchEvent(new CustomEvent('vt-btn-activated', { detail: { id: 'grid' } }));
        recordRecentItem({ id: 'grid', name: 'DP Grid', type: 'grid', screenId: 'grid' });
      }
    });
    vtTop.appendChild(btn);
  }

  // ── State ──────────────────────────────────────────────────────────────────
  const tabs          = [];   // [{ id, varName, filename, ds }]
  const editState     = {};   // { [tabId]: { rows, dirtyCount, dirtyIndices } }
  const sortStates    = {};   // { [tabId]: { col, dir } }
  const filters       = [];   // [{ col, op, val }]
  const selectedRows  = {};   // { [tabId]: Set<origIdx> }
  const displayLimits = {};   // { [tabId]: number }
  const lastSelIdx    = {};   // { [tabId]: origIdx } for shift-click
  let   activeTabId   = null;
  let   undoStack     = [];   // mixed op types

  // ── Build screen skeleton ─────────────────────────────────────────────────
  screen.innerHTML = `
    <div class="grid-top-bar" id="grid-top-bar"></div>
    <div class="grid-toolbar">
      <button class="g-btn" id="g-sync-btn" disabled title="同步到内核">
        <i class="ti ti-refresh"></i> 同步到内核
        <span id="g-sync-varname" style="font-weight:400;opacity:0.6;font-family:var(--code-font,'JetBrains Mono',monospace);font-size:0.6rem"></span>
      </button>
      <div class="g-sep"></div>
      <button class="g-btn" id="g-filter-btn"><i class="ti ti-filter"></i> 过滤</button>
      <button class="g-btn" id="g-save-btn" disabled><i class="ti ti-download"></i> 另存为</button>
      <button class="g-btn" id="g-aria-btn" disabled><i class="ti ti-sparkles"></i> 发送给 ARIA</button>
      <div class="g-sep"></div>
      <button class="g-btn" id="g-addrow-btn" disabled title="在选中行下方插入空行">
        <i class="ti ti-row-insert-bottom"></i> 插入行
      </button>
      <button class="g-btn" id="g-delrow-btn" disabled title="删除选中行">
        <i class="ti ti-trash"></i> 删除行
      </button>
      <div class="g-spacer"></div>
      <input class="g-search" id="g-search" placeholder="搜索列名…" type="text">
    </div>
    <div class="grid-filter-bar" id="grid-filter-bar" style="display:none">
      <div class="g-filter-chips" id="g-filter-chips"></div>
      <div class="g-filter-add" id="g-filter-add">
        <select class="g-filter-select" id="g-fcol"></select>
        <select class="g-filter-select" id="g-fop">
          <option>=</option><option>≠</option><option>&gt;</option>
          <option>&lt;</option><option>≥</option><option>≤</option>
          <option>包含</option>
        </select>
        <input class="g-filter-input" id="g-fval" placeholder="值…">
        <button class="g-btn" id="g-fadd"><i class="ti ti-plus"></i> 添加</button>
      </div>
    </div>
    <div class="grid-table-wrap" id="grid-table-wrap">
      <div class="grid-empty" id="grid-empty">
        <div class="grid-empty-icon"><i class="ti ti-table"></i></div>
        <div class="grid-empty-title">DP Grid</div>
        <div class="grid-empty-sub">打开数据集开始查看和编辑</div>
        <button class="grid-empty-btn" id="grid-empty-open">
          <i class="ti ti-plus"></i> 打开数据集
        </button>
      </div>
    </div>
    <div class="grid-status-bar" id="grid-status-bar">
      <span id="grid-stat-shape">—</span>
      <span id="grid-stat-filtered"></span>
      <span id="grid-stat-selected" style="display:none"></span>
      <span id="grid-stat-dirty" class="grid-stat-dirty" style="display:none"></span>
      <button class="g-btn" id="g-undo-btn" style="display:none; margin-left:4px">↩ 撤销</button>
      <button class="g-btn g-btn--accent" id="g-sync-status-btn" style="display:none">
        <i class="ti ti-refresh"></i> 同步到内核
      </button>
    </div>`;

  const topBar      = screen.querySelector('#grid-top-bar');
  const tableWrap   = screen.querySelector('#grid-table-wrap');
  const emptyEl     = screen.querySelector('#grid-empty');
  const statShape   = screen.querySelector('#grid-stat-shape');
  const statFilter  = screen.querySelector('#grid-stat-filtered');
  const statSel     = screen.querySelector('#grid-stat-selected');
  const statDirty   = screen.querySelector('#grid-stat-dirty');
  const searchEl    = screen.querySelector('#g-search');
  const filterBar   = screen.querySelector('#grid-filter-bar');
  const filterChips = screen.querySelector('#g-filter-chips');
  const fcolEl      = screen.querySelector('#g-fcol');
  const fvalEl      = screen.querySelector('#g-fval');
  const undoBtn     = screen.querySelector('#g-undo-btn');
  const syncStatBtn = screen.querySelector('#g-sync-status-btn');
  const syncBtn     = screen.querySelector('#g-sync-btn');
  const saveBtn     = screen.querySelector('#g-save-btn');
  const ariaBtn     = screen.querySelector('#g-aria-btn');
  const addRowBtn   = screen.querySelector('#g-addrow-btn');
  const delRowBtn   = screen.querySelector('#g-delrow-btn');

  const _activeTab  = () => tabs.find(t => t.id === activeTabId);
  const _activeEdit = () => editState[activeTabId];

  // ── Status bar update ─────────────────────────────────────────────────────
  function _updateStatus() {
    const tab = _activeTab();
    if (!tab) {
      statShape.textContent = '—'; statFilter.textContent = '';
      statSel.style.display = 'none'; _hideDirty(); _updateRowButtons(); return;
    }
    const ed         = _activeEdit();
    const totalRows  = ed ? ed.rows.length : tab.ds.rows.length;
    const filteredCt = filters.length
      ? _applyFilters(ed ? ed.rows : tab.ds.rows, filters, tab.ds.dtypes).length : totalRows;

    statShape.textContent  = `${totalRows.toLocaleString()} 行 × ${tab.ds.columns.length} 列`;
    statFilter.textContent = filters.length ? ` · 过滤后：${filteredCt.toLocaleString()} 行` : '';

    const selCount = selectedRows[activeTabId]?.size ?? 0;
    if (selCount > 0) { statSel.textContent = `· 已选 ${selCount} 行`; statSel.style.display = ''; }
    else { statSel.style.display = 'none'; }

    const dirty = ed?.dirtyCount ?? 0;
    if (dirty > 0) {
      statDirty.textContent    = `· ${dirty} 处未同步改动`;
      statDirty.style.display  = '';
      undoBtn.style.display    = '';
      syncStatBtn.style.display = '';
    } else { _hideDirty(); }

    saveBtn.disabled = false;
    ariaBtn.disabled = false;
    syncBtn.disabled = dirty === 0;
    const varnameEl = screen.querySelector('#g-sync-varname');
    if (varnameEl) varnameEl.textContent = tab?.varName ? `→ ${tab.varName}` : '';
    syncBtn.title = tab?.varName ? `同步到内核变量: ${tab.varName}` : '同步到内核';
    _updateRowButtons();
  }

  function _hideDirty() {
    statDirty.style.display    = 'none';
    undoBtn.style.display      = 'none';
    syncStatBtn.style.display  = 'none';
  }

  function _updateRowButtons() {
    const hasTab   = !!_activeTab();
    const selCount = selectedRows[activeTabId]?.size ?? 0;
    if (addRowBtn) addRowBtn.disabled = !hasTab;
    if (delRowBtn) delRowBtn.disabled = selCount === 0;
  }

  // ── Collect available datasets ────────────────────────────────────────────
  function _getAvailableSources() {
    const sources = [];
    getAllDatasets().forEach(ds => sources.push({ _from: 'store', ...ds }));
    try {
      const store = JSON.parse(localStorage.getItem(INJECT_KEY) ?? '{}');
      Object.values(store).forEach(entry => {
        if (!entry?.filename) return;
        const dup = sources.find(s => s.filename === entry.filename || s.name === entry.filename);
        if (!dup) sources.push({ _from: 'inject', ...entry });
      });
    } catch {}
    return sources;
  }

  // ── Open dataset in new tab ───────────────────────────────────────────────
  function _openDataset(source) {
    const ds = _normalise(source);
    if (!ds) return;
    const existing = tabs.find(t => t.varName === ds.varName && t.filename === ds.filename);
    if (existing) { _setActive(existing.id); return; }
    if (tabs.length >= MAX_TABS) {
      const old = tabs.shift();
      delete editState[old.id]; delete sortStates[old.id];
      delete selectedRows[old.id]; delete displayLimits[old.id]; delete lastSelIdx[old.id];
    }
    const id = `tab-${Date.now()}`;
    sortStates[id]    = { col: null, dir: 0 };
    selectedRows[id]  = new Set();
    displayLimits[id] = PAGE_SIZE;
    editState[id] = {
      rows: ds.rows.map(r => ({ ...r })),
      dirtyCount: 0,
      dirtyIndices: new Set(),
    };
    tabs.push({ id, varName: ds.varName, filename: ds.filename, ds });
    _renderTabs();
    _setActive(id);
    setTimeout(_saveGridState, 0);
  }

  // ── Render tabs ───────────────────────────────────────────────────────────
  function _renderTabs() {
    topBar.innerHTML = '';
    tabs.forEach(tab => {
      const t = document.createElement('button');
      t.className = 'grid-tab' + (tab.id === activeTabId ? ' active' : '');
      t.dataset.tabId = tab.id;
      const shortName = tab.filename.length > 20 ? tab.filename.slice(0, 18) + '…' : tab.filename;
      t.innerHTML = `
        <span class="grid-tab-name">${shortName}</span>
        <span class="grid-tab-var">${tab.varName}</span>
        <button class="grid-tab-close" data-close="${tab.id}" title="关闭">✕</button>`;
      topBar.appendChild(t);
    });
    const addBtn = document.createElement('button');
    addBtn.className = 'grid-tab-add'; addBtn.id = 'grid-tab-add';
    addBtn.innerHTML = '<i class="ti ti-plus"></i> 打开';
    topBar.appendChild(addBtn);
  }

  // Wire topBar click once
  topBar.addEventListener('click', e => {
    const closeTrigger = e.target.closest('[data-close]');
    const tabTrigger   = e.target.closest('.grid-tab');
    if (closeTrigger) { e.stopPropagation(); _closeTab(closeTrigger.dataset.close); return; }
    if (tabTrigger)   { _setActive(tabTrigger.dataset.tabId); return; }
    if (e.target.closest('#grid-tab-add')) { _showDatasetOverlay(); }
  });

  // ── Column context menu ───────────────────────────────────────────────────
  function _showColMenu(e, tabId, col) {
    e.preventDefault();
    document.getElementById('dp-grid-col-menu')?.remove();
    const menu = document.createElement('div');
    menu.id = 'dp-grid-col-menu';
    menu.className = 'grid-ctx-menu';
    menu.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;z-index:9999`;
    menu.innerHTML = `
      <div class="grid-ctx-item" data-action="insert-col">在右侧插入列</div>
      <div class="grid-ctx-item grid-ctx-item--danger" data-action="delete-col">删除此列</div>`;
    document.body.appendChild(menu);
    menu.addEventListener('click', ev => {
      const action = ev.target.closest('[data-action]')?.dataset.action;
      menu.remove();
      if (action === 'insert-col') _insertColumn(tabId, col);
      else if (action === 'delete-col') _deleteColumn(tabId, col);
    });
    const _rm = () => { menu.remove(); document.removeEventListener('mousedown', _rm); };
    setTimeout(() => document.addEventListener('mousedown', _rm), 0);
  }

  // ── Render table & wire all events ────────────────────────────────────────
  function _renderTable(tabId) {
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return;

    emptyEl.style.display = 'none';
    const sortSt = sortStates[tabId] ?? { col: null, dir: 0 };
    const ed     = editState[tabId];
    const limit  = displayLimits[tabId] ?? PAGE_SIZE;
    const selSet = selectedRows[tabId];

    const { html, truncated, total, filteredTotal } = _buildTable(tab.ds, sortSt, ed, filters, limit, selSet);

    // Clear previous table + accessories
    tableWrap.querySelector('.grid-table')?.remove();
    tableWrap.querySelector('.g-load-more')?.remove();
    tableWrap.querySelector('.g-pro-banner')?.remove();

    // Pro nudge banner — appears when dataset exceeds free row limit
    if (total > PRO_LIMIT) {
      const banner = createNudgeBanner({
        id: 'grid-row-limit',
        content:
          `⚡ 数据集共 <strong>${total.toLocaleString()}</strong> 行，Pro 版可无限加载` +
          `&nbsp;<a href="/pricing.html" class="g-pro-link">升级 →</a>`,
      });
      if (banner) tableWrap.insertBefore(banner, emptyEl.nextSibling);
    }

    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    const tableEl = wrapper.firstElementChild;
    tableWrap.appendChild(tableEl);

    // Load-more button
    if (truncated) {
      const shown = Math.min(limit, filteredTotal);
      const loadMore = document.createElement('div');
      loadMore.className = 'g-load-more';
      loadMore.innerHTML =
        `<button class="g-btn g-load-more-btn">显示更多（当前 ${shown.toLocaleString()} / ${filteredTotal.toLocaleString()} 行）</button>`;
      loadMore.querySelector('button').addEventListener('click', () => {
        displayLimits[tabId] = (displayLimits[tabId] ?? PAGE_SIZE) + PAGE_SIZE;
        _renderTable(tabId);
      });
      tableWrap.appendChild(loadMore);
    }

    statShape.textContent  = `${(ed ? ed.rows.length : total).toLocaleString()} 行 × ${tab.ds.columns.length} 列`;
    statFilter.textContent = filters.length ? ` · 过滤后：${filteredTotal.toLocaleString()} 行` : '';
    if (truncated) statFilter.textContent += ` · 显示 ${Math.min(limit, filteredTotal)} 行`;

    // ── Sort (click) & rename (dblclick) & context menu on th ────────────
    tableEl.querySelectorAll('thead th[data-col]').forEach(th => {
      th.addEventListener('click', e => {
        if (e.target.closest('input')) return;
        const col = th.dataset.col;
        const st  = sortStates[tabId];
        if (st.col === col) {
          st.dir = st.dir === 1 ? -1 : st.dir === -1 ? 0 : 1;
          if (st.dir === 0) st.col = null;
        } else { st.col = col; st.dir = 1; }
        _renderTable(tabId);
      });

      th.addEventListener('dblclick', e => {
        e.stopPropagation();
        const col      = th.dataset.col;
        const nameSpan = th.querySelector('.th-name');
        if (!nameSpan) return;
        const oldName = nameSpan.textContent;
        const input   = document.createElement('input');
        input.value   = oldName;
        input.style.cssText =
          'width:100%;min-width:60px;font:inherit;border:none;outline:2px solid #6366f1;' +
          'border-radius:2px;padding:1px 2px;background:var(--surface,#fff);' +
          'color:var(--text,#0f172a);box-sizing:border-box';
        nameSpan.textContent = '';
        nameSpan.appendChild(input);
        input.focus(); input.select();
        let committed = false;
        const _commitRename = () => {
          if (committed) return; committed = true;
          const newName = input.value.trim();
          if (newName && newName !== oldName) _renameColumn(tabId, oldName, newName);
          else _renderTable(tabId);
        };
        input.addEventListener('keydown', ev => {
          if (ev.key === 'Enter')  { ev.preventDefault(); _commitRename(); }
          if (ev.key === 'Escape') { ev.preventDefault(); committed = true; _renderTable(tabId); }
        });
        input.addEventListener('blur', _commitRename);
      });

      th.addEventListener('contextmenu', e => _showColMenu(e, tabId, th.dataset.col));
    });

    // ── Row-number click → multi-select ──────────────────────────────────
    const allTrs = [...tableEl.querySelectorAll('tbody tr')];
    tableEl.querySelectorAll('tbody td.grid-row-num').forEach((td, dispIdx) => {
      td.addEventListener('click', e => {
        const tr      = td.closest('tr');
        const origIdx = Number(tr.dataset.origIdx);
        const sel     = selectedRows[tabId] ?? (selectedRows[tabId] = new Set());

        if (e.shiftKey && lastSelIdx[tabId] != null) {
          const lastDisp = allTrs.findIndex(r => Number(r.dataset.origIdx) === lastSelIdx[tabId]);
          const [from, to] = lastDisp <= dispIdx ? [lastDisp, dispIdx] : [dispIdx, lastDisp];
          allTrs.slice(from, to + 1).forEach(r => sel.add(Number(r.dataset.origIdx)));
        } else if (e.ctrlKey || e.metaKey) {
          if (sel.has(origIdx)) sel.delete(origIdx); else sel.add(origIdx);
        } else {
          sel.clear(); sel.add(origIdx);
        }
        lastSelIdx[tabId] = origIdx;
        // Re-render to apply selection highlight
        _renderTable(tabId);
        _updateStatus();
      });
    });

    // ── Double-click cell to edit ────────────────────────────────────────
    tableEl.querySelectorAll('tbody td[data-col]').forEach(td => {
      td.addEventListener('dblclick', () => _startEdit(td, tabId, tab.ds));
    });
  }

  // ── Cell editing ──────────────────────────────────────────────────────────
  function _startEdit(td, tabId, ds) {
    if (td.querySelector('input')) return;
    const col        = td.dataset.col;
    const origIdx    = Number(td.dataset['orig-idx'] ?? td.dataset.origIdx ?? 0);
    const tr         = td.closest('tr');
    const trOrigIdx  = Number(tr?.dataset?.origIdx ?? origIdx);
    const currentVal = editState[tabId]?.rows[trOrigIdx]?.[col] ?? td.textContent;

    const input = document.createElement('input');
    input.value = currentVal;
    input.style.cssText =
      'width:100%;box-sizing:border-box;border:none;outline:2px solid #6366f1;' +
      'border-radius:3px;font-family:var(--code-font,"JetBrains Mono",monospace);' +
      'font-size:12px;padding:0 4px;background:var(--surface,#fff);color:var(--text,#0f172a)';
    td.textContent = '';
    td.appendChild(input);
    input.focus(); input.select();

    const _commit = () => {
      const newVal = input.value;
      const ed     = editState[tabId];
      if (!ed) return;
      const oldVal = ed.rows[trOrigIdx]?.[col];
      if (String(newVal) !== String(oldVal)) {
        undoStack.push({ tabId, origIdx: trOrigIdx, col, oldVal, newVal });
        ed.rows[trOrigIdx][col] = newVal;
        ed.dirtyIndices.add(trOrigIdx);
        ed.dirtyCount = ed.dirtyIndices.size;
      }
      _renderTable(tabId);
      _updateStatus();
    };
    const _cancel = () => { td.textContent = currentVal; };

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); _commit(); }
      else if (e.key === 'Escape') { e.preventDefault(); _cancel(); }
      else if (e.key === 'Tab') {
        e.preventDefault(); _commit();
        const tds  = [...tr.querySelectorAll('td[data-col]')];
        const next = tds[tds.indexOf(td) + 1];
        if (next) setTimeout(() => _startEdit(next, tabId, ds), 10);
      }
    });
    input.addEventListener('blur', _commit);
  }

  // ── Set active tab ────────────────────────────────────────────────────────
  function _setActive(id) {
    activeTabId = id;
    _renderTabs();
    const tab = tabs.find(t => t.id === id);
    if (!tab) { _showEmpty(); return; }
    fcolEl.innerHTML = tab.ds.columns.map(c => `<option value="${c}">${c}</option>`).join('');
    _renderTable(id);
    _updateStatus();
  }

  function _showEmpty() {
    emptyEl.style.display = '';
    tableWrap.querySelector('.grid-table')?.remove();
    tableWrap.querySelector('.g-load-more')?.remove();
    tableWrap.querySelector('.g-pro-banner')?.remove();
    statShape.textContent = '—'; statFilter.textContent = '';
    statSel.style.display = 'none';
    _hideDirty(); _updateRowButtons();
  }

  function _closeTab(id) {
    const idx = tabs.findIndex(t => t.id === id);
    if (idx === -1) return;
    tabs.splice(idx, 1);
    delete editState[id]; delete sortStates[id];
    delete selectedRows[id]; delete displayLimits[id]; delete lastSelIdx[id];
    if (activeTabId === id) activeTabId = tabs[Math.min(idx, tabs.length - 1)]?.id ?? null;
    _renderTabs();
    if (activeTabId) _setActive(activeTabId);
    else { _showEmpty(); _clearGridState(); }
  }

  // ── Row insert ────────────────────────────────────────────────────────────
  function _insertRow() {
    const tab = _activeTab();
    const ed  = _activeEdit();
    if (!tab || !ed) return;
    const sel      = selectedRows[activeTabId];
    const insertAt = sel?.size > 0 ? Math.max(...sel) + 1 : ed.rows.length;
    const emptyRow = {};
    tab.ds.columns.forEach(c => { emptyRow[c] = ''; });

    // Shift dirty indices ≥ insertAt up by 1
    const newDirty = new Set();
    ed.dirtyIndices.forEach(i => newDirty.add(i >= insertAt ? i + 1 : i));

    undoStack.push({ type: 'insert-row', tabId: activeTabId, insertedAt: insertAt });
    ed.rows.splice(insertAt, 0, { ...emptyRow });
    newDirty.add(insertAt);
    ed.dirtyIndices = newDirty;
    ed.dirtyCount   = ed.dirtyIndices.size;

    // Shift cell-edit undo entries above insertAt
    undoStack.forEach(op => {
      if (!op.type && op.tabId === activeTabId && op.origIdx >= insertAt) op.origIdx++;
    });
    selectedRows[activeTabId] = new Set([insertAt]);
    _renderTable(activeTabId);
    _updateStatus();
  }

  // ── Row delete ────────────────────────────────────────────────────────────
  function _deleteRows() {
    console.log('[Grid] deleteRows called', {
      activeTabId,
      sel: selectedRows[activeTabId],
      selSize: selectedRows[activeTabId]?.size
    });
    const tab = _activeTab();
    const ed  = _activeEdit();
    const sel = selectedRows[activeTabId];
    if (!tab || !ed || !sel?.size) return;
    if (!confirm(`确认删除 ${sel.size} 行？`)) return;

    const sortedDesc  = [...sel].sort((a, b) => b - a);
    const deletedRows = sortedDesc.map(i => ({ origIdx: i, row: { ...ed.rows[i] } }));
    undoStack.push({ type: 'delete-rows', tabId: activeTabId, deletedRows });

    sortedDesc.forEach(i => ed.rows.splice(i, 1));

    // Rebuild dirty indices — skip deleted, shift remainder down
    const newDirty = new Set();
    ed.dirtyIndices.forEach(i => {
      if (!sel.has(i)) {
        const shift = sortedDesc.filter(d => d < i).length;
        newDirty.add(i - shift);
      }
    });
    ed.dirtyIndices = newDirty;
    ed.dirtyCount   = ed.dirtyIndices.size;
    selectedRows[activeTabId] = new Set();
    _renderTable(activeTabId);
    _updateStatus();
  }

  // ── Column rename ─────────────────────────────────────────────────────────
  function _renameColumn(tabId, oldName, newName) {
    const tab = tabs.find(t => t.id === tabId);
    const ed  = editState[tabId];
    if (!tab) return;
    const colIdx = tab.ds.columns.indexOf(oldName);
    if (colIdx === -1) return;

    undoStack.push({ type: 'rename-col', tabId, oldName, newName });
    tab.ds.columns[colIdx] = newName;
    if (tab.ds.dtypes[oldName] !== undefined) {
      tab.ds.dtypes[newName] = tab.ds.dtypes[oldName];
      delete tab.ds.dtypes[oldName];
    }
    [tab.ds.rows, ed?.rows].filter(Boolean).forEach(rows =>
      rows.forEach(row => { if (oldName in row) { row[newName] = row[oldName]; delete row[oldName]; } })
    );
    if (ed) { ed.rows.forEach((_, i) => ed.dirtyIndices.add(i)); ed.dirtyCount = ed.dirtyIndices.size; }
    fcolEl.innerHTML = tab.ds.columns.map(c => `<option value="${c}">${c}</option>`).join('');
    _renderTable(tabId);
    _updateStatus();
  }

  // ── Column insert ─────────────────────────────────────────────────────────
  function _insertColumn(tabId, afterCol) {
    const tab = tabs.find(t => t.id === tabId);
    const ed  = editState[tabId];
    if (!tab || !ed) return;
    const afterIdx  = tab.ds.columns.indexOf(afterCol);
    const insertIdx = afterIdx + 1;
    const newName   = _uniqueColName(tab.ds.columns, '新列');

    undoStack.push({ type: 'insert-col', tabId, colName: newName, colIdx: insertIdx });
    tab.ds.columns.splice(insertIdx, 0, newName);
    tab.ds.dtypes[newName] = 'object';
    ed.rows.forEach(row => { row[newName] = ''; });
    ed.rows.forEach((_, i) => ed.dirtyIndices.add(i));
    ed.dirtyCount = ed.dirtyIndices.size;
    fcolEl.innerHTML = tab.ds.columns.map(c => `<option value="${c}">${c}</option>`).join('');
    _renderTable(tabId);
    _updateStatus();
  }

  // ── Column delete ─────────────────────────────────────────────────────────
  function _deleteColumn(tabId, colName) {
    const tab = tabs.find(t => t.id === tabId);
    const ed  = editState[tabId];
    if (!tab || !ed) return;
    if (!confirm(`确认删除列「${colName}」？`)) return;
    const colIdx = tab.ds.columns.indexOf(colName);
    if (colIdx === -1) return;

    const values = ed.rows.map(row => row[colName] ?? '');
    const dtype  = tab.ds.dtypes[colName];
    undoStack.push({ type: 'delete-col', tabId, colName, colIdx, dtype, values });
    tab.ds.columns.splice(colIdx, 1);
    delete tab.ds.dtypes[colName];
    ed.rows.forEach(row => delete row[colName]);
    ed.rows.forEach((_, i) => ed.dirtyIndices.add(i));
    ed.dirtyCount = ed.dirtyIndices.size;
    fcolEl.innerHTML = tab.ds.columns.map(c => `<option value="${c}">${c}</option>`).join('');
    _renderTable(tabId);
    _updateStatus();
  }

  // ── Filter ────────────────────────────────────────────────────────────────
  function _renderFilterChips() {
    filterChips.innerHTML = '';
    filters.forEach((f, i) => {
      const chip = document.createElement('span');
      chip.className = 'g-filter-chip';
      chip.innerHTML =
        `<span class="g-chip-col">${f.col}</span>` +
        `<span class="g-chip-op">${f.op}</span>` +
        `<span class="g-chip-val">${f.val}</span>` +
        `<button class="g-chip-close" data-fi="${i}" title="移除过滤">✕</button>`;
      filterChips.appendChild(chip);
    });
  }

  screen.querySelector('#g-filter-btn')?.addEventListener('click', () => {
    filterBar.style.display = filterBar.style.display === 'none' ? '' : 'none';
  });

  function _addFilter() {
    const col = fcolEl.value;
    const op  = screen.querySelector('#g-fop').value;
    const val = fvalEl.value.trim();
    if (!col || !val) return;
    filters.push({ col, op, val });
    fvalEl.value = '';
    _renderFilterChips();
    if (activeTabId) _renderTable(activeTabId);
    _updateStatus();
  }

  screen.querySelector('#g-fadd')?.addEventListener('click', _addFilter);
  fvalEl?.addEventListener('keydown', e => { if (e.key === 'Enter') _addFilter(); });

  filterChips.addEventListener('click', e => {
    const btn = e.target.closest('[data-fi]');
    if (!btn) return;
    filters.splice(Number(btn.dataset.fi), 1);
    _renderFilterChips();
    if (activeTabId) _renderTable(activeTabId);
    _updateStatus();
  });

  // ── Undo (handles all op types) ───────────────────────────────────────────
  undoBtn?.addEventListener('click', () => {
    const op = undoStack.pop();
    if (!op) return;
    const ed = editState[op.tabId];
    if (!ed) return;

    if (op.type === 'insert-row') {
      ed.rows.splice(op.insertedAt, 1);
      const newDirty = new Set();
      ed.dirtyIndices.forEach(i => { if (i !== op.insertedAt) newDirty.add(i > op.insertedAt ? i - 1 : i); });
      ed.dirtyIndices = newDirty;
      ed.dirtyCount   = ed.dirtyIndices.size;
      selectedRows[op.tabId] = new Set();

    } else if (op.type === 'delete-rows') {
      const sorted = [...op.deletedRows].sort((a, b) => a.origIdx - b.origIdx);
      sorted.forEach(({ origIdx, row }) => ed.rows.splice(origIdx, 0, { ...row }));
      sorted.forEach(({ origIdx }) => ed.dirtyIndices.add(origIdx));
      ed.dirtyCount = ed.dirtyIndices.size;
      selectedRows[op.tabId] = new Set();

    } else if (op.type === 'rename-col') {
      const tab = tabs.find(t => t.id === op.tabId);
      if (!tab) return;
      const colIdx = tab.ds.columns.indexOf(op.newName);
      if (colIdx !== -1) {
        tab.ds.columns[colIdx] = op.oldName;
        if (tab.ds.dtypes[op.newName] !== undefined) {
          tab.ds.dtypes[op.oldName] = tab.ds.dtypes[op.newName];
          delete tab.ds.dtypes[op.newName];
        }
        [tab.ds.rows, ed?.rows].filter(Boolean).forEach(rows =>
          rows.forEach(row => { if (op.newName in row) { row[op.oldName] = row[op.newName]; delete row[op.newName]; } })
        );
        if (ed) { ed.rows.forEach((_, i) => ed.dirtyIndices.add(i)); ed.dirtyCount = ed.dirtyIndices.size; }
        fcolEl.innerHTML = tab.ds.columns.map(c => `<option value="${c}">${c}</option>`).join('');
      }

    } else if (op.type === 'insert-col') {
      const tab = tabs.find(t => t.id === op.tabId);
      if (!tab) return;
      const colIdx = tab.ds.columns.indexOf(op.colName);
      if (colIdx !== -1) {
        tab.ds.columns.splice(colIdx, 1);
        delete tab.ds.dtypes[op.colName];
        ed.rows.forEach(row => delete row[op.colName]);
        ed.rows.forEach((_, i) => ed.dirtyIndices.add(i));
        ed.dirtyCount = ed.dirtyIndices.size;
        fcolEl.innerHTML = tab.ds.columns.map(c => `<option value="${c}">${c}</option>`).join('');
      }

    } else if (op.type === 'delete-col') {
      const tab = tabs.find(t => t.id === op.tabId);
      if (!tab) return;
      tab.ds.columns.splice(op.colIdx, 0, op.colName);
      tab.ds.dtypes[op.colName] = op.dtype || 'object';
      ed.rows.forEach((row, i) => { row[op.colName] = op.values[i] ?? ''; ed.dirtyIndices.add(i); });
      ed.dirtyCount = ed.dirtyIndices.size;
      fcolEl.innerHTML = tab.ds.columns.map(c => `<option value="${c}">${c}</option>`).join('');

    } else {
      // Legacy cell-edit op (no .type field)
      ed.rows[op.origIdx][op.col] = op.oldVal;
      const tab = tabs.find(t => t.id === op.tabId);
      if (tab) {
        const orig = tab.ds.rows[op.origIdx];
        const cur  = ed.rows[op.origIdx];
        const stillDirty = tab.ds.columns.some(c => String(cur[c]) !== String(orig?.[c] ?? ''));
        if (!stillDirty) ed.dirtyIndices.delete(op.origIdx);
      }
      ed.dirtyCount = ed.dirtyIndices.size;
    }

    _renderTable(op.tabId);
    _updateStatus();
  });

  // ── Row button events ─────────────────────────────────────────────────────
  addRowBtn?.addEventListener('click', _insertRow);
  delRowBtn?.addEventListener('click', _deleteRows);

  // ── Sync to kernel ────────────────────────────────────────────────────────
  async function _syncToKernel() {
    const tab = _activeTab();
    const ed  = _activeEdit();
    if (!tab || !ed || !ed.dirtyCount) return;
    if (getSettings().gridConfirmSync) {
      const ok = window.confirm(
        `将 ${ed.dirtyCount} 处改动同步到内核变量 "${tab.varName}"？\n此操作会覆盖内核中的原始数据。`
      );
      if (!ok) return;
    }
    syncBtn.disabled = true;
    syncBtn.innerHTML = '<i class="ti ti-loader-2"></i> 同步中…';
    try {
      const py = await getPyodide().catch(e => { throw new Error('内核未就绪: ' + e.message); });
      const csv = _rowsToCSV(tab.ds.columns, ed.rows);
      await injectDataFrame(tab.varName, csv, 'csv', tab.filename ?? '', {});
      const confirmed = py.runPython(
        `'${tab.varName}' in (_dp_kernel_ns if '_dp_kernel_ns' in dir() else {})`
      );
      if (!confirmed) throw new Error(`变量 "${tab.varName}" 注入后在内核中未找到`);
      ed.dirtyCount = 0; ed.dirtyIndices.clear(); undoStack.length = 0;
      _renderTable(tab.id); _updateStatus();
      syncBtn.innerHTML = `<i class="ti ti-check"></i> 已同步 → ${tab.varName}`;
      setTimeout(() => { syncBtn.innerHTML = '<i class="ti ti-refresh"></i> 同步到内核'; _updateStatus(); }, 3000);
    } catch (err) {
      console.error('[DP Grid] sync failed:', err);
      statDirty.textContent = `· 同步失败: ${err.message}`;
      syncBtn.innerHTML = '<i class="ti ti-alert-triangle"></i> 同步失败';
      setTimeout(() => { syncBtn.innerHTML = '<i class="ti ti-refresh"></i> 同步到内核'; syncBtn.disabled = false; _updateStatus(); }, 4000);
    }
  }

  syncBtn?.addEventListener('click', _syncToKernel);
  syncStatBtn?.addEventListener('click', _syncToKernel);

  // ── Save as ───────────────────────────────────────────────────────────────
  saveBtn?.addEventListener('click', () => {
    const tab = _activeTab();
    const ed  = _activeEdit();
    if (!tab) return;
    const rows = ed ? ed.rows : tab.ds.rows;
    const menu = document.createElement('div');
    menu.className = 'grid-picker';
    menu.style.cssText = 'position:fixed;z-index:500;bottom:60px;right:80px;min-width:140px';
    [['CSV','csv','text/csv'],['JSON','json','application/json'],['TSV','tsv','text/tab-separated-values']].forEach(([label,ext,mime]) => {
      const item = document.createElement('div');
      item.className = 'grid-picker-item';
      item.innerHTML = `<div class="grid-picker-name">${label}</div>`;
      item.addEventListener('click', () => {
        let content;
        if (ext === 'csv')  content = _rowsToCSV(tab.ds.columns, rows);
        else if (ext === 'tsv') content = [tab.ds.columns.join('\t'), ...rows.map(r => tab.ds.columns.map(c => r[c] ?? '').join('\t'))].join('\n');
        else content = JSON.stringify(rows, null, 2);
        downloadBlob(content, `${tab.filename.replace(/\.[^.]+$/, '')}_edited.${ext}`, mime);
        menu.remove();
      });
      menu.appendChild(item);
    });
    document.body.appendChild(menu);
    setTimeout(() => { document.addEventListener('click', function _r() { menu.remove(); document.removeEventListener('click', _r); }); }, 0);
  });

  // ── Send to ARIA ──────────────────────────────────────────────────────────
  ariaBtn?.addEventListener('click', () => {
    const tab = _activeTab();
    const ed  = _activeEdit();
    if (!tab) return;
    const rows = ed ? ed.rows : tab.ds.rows;
    setDataset({ name: tab.filename, columns: tab.ds.columns, dtypes: tab.ds.dtypes, rows });
    window.screenController?.open('terminal');
    document.dispatchEvent(new CustomEvent('vt-btn-activated', { detail: { id: 'terminal' } }));
  });

  // ── Column search ─────────────────────────────────────────────────────────
  searchEl?.addEventListener('input', () => {
    const q = searchEl.value.trim().toLowerCase();
    tableWrap.querySelectorAll('thead th[data-col]').forEach(th => {
      th.style.opacity = (!q || th.dataset.col.toLowerCase().includes(q)) ? '' : '0.3';
    });
  });

  // ── Dataset selector overlay ──────────────────────────────────────────────
  function _showDatasetOverlay() {
    document.getElementById('dp-grid-overlay')?.remove();
    const sources = _getAvailableSources();
    const overlay = document.createElement('div');
    overlay.id = 'dp-grid-overlay';
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.35);' +
      'display:flex;align-items:center;justify-content:center';
    const modal = document.createElement('div');
    modal.style.cssText =
      'background:#fff;border-radius:12px;padding:16px;min-width:280px;' +
      'max-height:360px;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.2)';
    const title = document.createElement('div');
    title.style.cssText = 'font-weight:600;font-size:0.88rem;margin-bottom:12px;color:#0f172a';
    title.textContent = '选择数据集';
    modal.appendChild(title);
    if (!sources.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'font-size:0.78rem;color:#94a3b8;text-align:center;padding:16px 0';
      empty.textContent = '暂无可用数据集，请先导入 CSV 或运行 pd.read_csv()';
      modal.appendChild(empty);
    } else {
      sources.forEach(src => {
        const item = document.createElement('div');
        item.style.cssText = 'padding:10px 12px;border-radius:8px;cursor:pointer;transition:background 0.1s;margin-bottom:4px';
        item.onmouseenter = () => { item.style.background = 'rgba(99,102,241,0.08)'; };
        item.onmouseleave = () => { item.style.background = ''; };
        const name = src.name ?? src.filename ?? '—';
        const varN = src.varName ?? src.name ?? '—';
        const cnt  = src.rows ? (Array.isArray(src.rows) ? src.rows.length : src.rows) : '?';
        item.innerHTML =
          `<div style="font-weight:600;font-size:0.82rem;color:#0f172a">${name}</div>` +
          `<div style="font-size:0.68rem;color:#94a3b8;font-family:monospace">${varN} · ${cnt} 行</div>`;
        item.addEventListener('click', () => { overlay.remove(); _openDataset(src); });
        modal.appendChild(item);
      });
    }
    overlay.appendChild(modal);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }

  screen.querySelector('#grid-empty-open')?.addEventListener('click', e => {
    e.stopPropagation();
    _showDatasetOverlay();
  });

  // ── Grid state persistence ────────────────────────────────────────────────
  const GRID_STATE_KEY = 'dp-grid-state';
  function _saveGridState() {
    if (!getSettings().cacheGridState) return;
    if (tabs.length === 0) return;
    try {
      localStorage.setItem(GRID_STATE_KEY, JSON.stringify({
        tabs: tabs.map(t => ({ varName: t.varName, filename: t.filename })),
        activeFilename: _activeTab()?.filename ?? null,
      }));
    } catch {}
  }
  function _clearGridState() { try { localStorage.removeItem(GRID_STATE_KEY); } catch {} }
  function _restoreGridState() {
    if (!getSettings().cacheGridState) return;
    try {
      const saved = JSON.parse(localStorage.getItem(GRID_STATE_KEY) ?? 'null');
      if (!saved?.tabs?.length) return;
      const allSources = _getAvailableSources();
      saved.tabs.forEach(t => {
        const src = allSources.find(s =>
          (s.filename === t.filename || s.name === t.filename) && s.varName === t.varName
        );
        if (src) _openDataset(src);
      });
    } catch {}
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  _renderTabs();
  _showEmpty();

  let _gridRestored = false;
  document.addEventListener('screen-opened', ({ detail }) => {
    if (detail?.id === 'grid' && !_gridRestored) { _gridRestored = true; _restoreGridState(); }
    if (tabs.length > 0) _saveGridState();
  });
  document.addEventListener('nb-file-imported', () => {/* sources updated */});

  window._gridOpenDataset = _openDataset;
  window._saveGridState   = _saveGridState;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupGridScreen);
} else {
  setupGridScreen();
}
