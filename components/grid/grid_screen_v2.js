// ── DP Grid — Phase 2: edit, filter, sync to kernel, export, send to ARIA ─────
import { getAllDatasets, setDataset } from '../shared/dataset_store.js';
import { injectDataFrame }           from '../compiler/compiler.js';
import { downloadBlob }              from '../shared/file_download.js';

const INJECT_KEY = 'dreaming-polar-inject-store';
const MAX_TABS   = 8;
const MAX_ROWS   = 500;

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
      } else {
        dtypes[h] = 'object';
      }
    });
    return { columns: headers, dtypes, rows };
  } catch { return null; }
}

// ── Normalise source → { varName, filename, columns, dtypes, rows } ───────────
function _normalise(source) {
  if (source._from === 'store') {
    return {
      varName:  source.varName || source.name,
      filename: source.name,
      columns:  source.columns ?? [],
      dtypes:   source.dtypes  ?? {},
      rows:     source.rows    ?? [],
    };
  }
  if (source._from === 'inject') {
    const parsed = _parseInjectEntry(source);
    return {
      varName:  source.varName,
      filename: source.filename,
      columns:  parsed?.columns ?? source.columnNames ?? [],
      dtypes:   parsed?.dtypes  ?? {},
      rows:     parsed?.rows    ?? [],
    };
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

// ── Apply filter conditions to rows ──────────────────────────────────────────
function _applyFilters(rows, filters, dtypes) {
  if (!filters.length) return rows;
  return rows.filter(row => filters.every(f => {
    const raw = row[f.col] ?? '';
    const isNum = _isNumCol(dtypes, f.col);
    const rv = isNum ? Number(raw) : String(raw);
    const fv = isNum ? Number(f.val) : String(f.val);
    switch (f.op) {
      case '=':  return isNum ? rv === fv : String(rv) === String(fv);
      case '≠':  return isNum ? rv !== fv : String(rv) !== String(fv);
      case '>':  return rv  >  fv;
      case '<':  return rv  <  fv;
      case '≥':  return rv  >= fv;
      case '≤':  return rv  <= fv;
      case '包含': return String(raw).includes(String(f.val));
      default: return true;
    }
  }));
}

// ── Build table HTML ──────────────────────────────────────────────────────────
function _buildTable(ds, sortState, editState, filters) {
  const { columns, dtypes } = ds;
  const workingRows = editState ? [...editState.rows] : [...ds.rows];
  const { col: sortCol, dir: sortDir } = sortState;

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
  const truncated = filteredRows.length > MAX_ROWS;
  const renderRows = truncated ? filteredRows.slice(0, MAX_ROWS) : filteredRows;

  let thead = '<thead><tr><th class="th-row">#</th>';
  columns.forEach(col => {
    const label = _dtypeLabel(dtypes[col]);
    const isSort = col === sortCol;
    const cls = isSort ? (sortDir === 1 ? 'sorted-asc' : sortDir === -1 ? 'sorted-desc' : '') : '';
    thead += `<th class="${cls}" data-col="${col}">
      <div class="th-inner">
        <span class="th-name">${col}</span>
        ${label ? `<span class="dtype-badge ${label}">${label}</span>` : ''}
        <span class="sort-icon"></span>
      </div></th>`;
  });
  thead += '</tr></thead>';

  // Need original index for dirty tracking (before sort/filter)
  const origIndexMap = new Map(workingRows.map((r, i) => [r, i]));

  let tbody = '<tbody>';
  renderRows.forEach((row, dispIdx) => {
    const origIdx = origIndexMap.get(row) ?? dispIdx;
    const isDirty = editState?.dirtyIndices?.has(origIdx);
    tbody += `<tr class="${isDirty ? 'grid-row--dirty' : ''}" data-orig-idx="${origIdx}">`;
    tbody += `<td class="td-row">${dispIdx + 1}</td>`;
    columns.forEach(col => {
      const v = row[col];
      const isNull = v === null || v === undefined || v === '';
      const numCls = _isNumCol(dtypes, col) ? ' num' : '';
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
    document.addEventListener('screen-opened',    ({ detail }) => { if (detail.id === 'grid') { btn.classList.add('active'); document.dispatchEvent(new CustomEvent('vt-btn-activated', { detail: { id: 'grid' } })); } });
    vtTop.appendChild(btn);
  }

  // ── State ──────────────────────────────────────────────────────────────────
  const tabs       = [];           // [{ id, varName, filename, ds }]
  const editState  = {};           // { [tabId]: { rows, dirtyCount, dirtyIndices } }
  const sortStates = {};           // { [tabId]: { col, dir } }
  const filters    = [];           // [{ col, op, val }]
  let activeTabId  = null;
  let pickerOpen   = false;
  let undoStack    = [];           // [{ tabId, origIdx, col, oldVal, newVal }]

  // ── Build screen skeleton ─────────────────────────────────────────────────
  screen.innerHTML = `
    <div class="grid-top-bar" id="grid-top-bar"></div>
    <div class="grid-toolbar">
      <button class="g-btn" id="g-sync-btn" disabled title="同步到内核">
        <i class="ti ti-refresh"></i> 同步到内核
      </button>
      <div class="g-sep"></div>
      <button class="g-btn" id="g-filter-btn"><i class="ti ti-filter"></i> 过滤</button>
      <button class="g-btn" id="g-save-btn" disabled><i class="ti ti-download"></i> 另存为</button>
      <button class="g-btn" id="g-aria-btn" disabled><i class="ti ti-sparkles"></i> 发送给 ARIA</button>
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

  // ── Helper: current tab ────────────────────────────────────────────────────
  const _activeTab  = () => tabs.find(t => t.id === activeTabId);
  const _activeEdit = () => editState[activeTabId];

  // ── Status bar update ──────────────────────────────────────────────────────
  function _updateStatus() {
    const tab = _activeTab();
    if (!tab) { statShape.textContent = '—'; statFilter.textContent = ''; _hideDirty(); return; }
    const ed = _activeEdit();
    const totalRows  = ed ? ed.rows.length : tab.ds.rows.length;
    const filteredRows = filters.length
      ? _applyFilters(ed ? ed.rows : tab.ds.rows, filters, tab.ds.dtypes).length : totalRows;

    statShape.textContent = `${totalRows.toLocaleString()} 行 × ${tab.ds.columns.length} 列`;
    statFilter.textContent = filters.length ? ` · 过滤后：${filteredRows.toLocaleString()} 行` : '';

    const dirty = ed?.dirtyCount ?? 0;
    if (dirty > 0) {
      statDirty.textContent  = `· ${dirty} 处未同步改动`;
      statDirty.style.display = '';
      undoBtn.style.display   = '';
      syncStatBtn.style.display = '';
    } else { _hideDirty(); }

    // Toolbar button states
    const hasData = !!tab;
    saveBtn.disabled = !hasData;
    ariaBtn.disabled = !hasData;
    syncBtn.disabled = dirty === 0;
  }

  function _hideDirty() {
    statDirty.style.display   = 'none';
    undoBtn.style.display     = 'none';
    syncStatBtn.style.display = 'none';
  }

  // ── Collect available datasets ─────────────────────────────────────────────
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

  // ── Open dataset in new tab (deep-copy rows) ───────────────────────────────
  function _openDataset(source) {
    const ds = _normalise(source);
    if (!ds) return;
    const existing = tabs.find(t => t.varName === ds.varName && t.filename === ds.filename);
    if (existing) { _setActive(existing.id); return; }
    if (tabs.length >= MAX_TABS) { const old = tabs.shift(); delete editState[old.id]; delete sortStates[old.id]; }

    const id = `tab-${Date.now()}`;
    sortStates[id] = { col: null, dir: 0 };
    // Deep-copy rows so edits don't pollute original source
    editState[id] = {
      rows: ds.rows.map(r => ({ ...r })),
      dirtyCount: 0,
      dirtyIndices: new Set(),
    };
    tabs.push({ id, varName: ds.varName, filename: ds.filename, ds });
    _renderTabs();
    _setActive(id);
  }

  // ── Render tabs ────────────────────────────────────────────────────────────
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
    addBtn.className = 'grid-tab-add';
    addBtn.id = 'grid-tab-add';
    addBtn.innerHTML = '<i class="ti ti-plus"></i> 打开';
    topBar.appendChild(addBtn);

    topBar.addEventListener('click', e => {
      const closeTrigger = e.target.closest('[data-close]');
      const tabTrigger   = e.target.closest('.grid-tab');
      if (closeTrigger) { e.stopPropagation(); _closeTab(closeTrigger.dataset.close); return; }
      if (tabTrigger)   { _setActive(tabTrigger.dataset.tabId); return; }
      if (e.target.closest('#grid-tab-add')) { _showDatasetOverlay(); }
    });
  }

  // ── Picker dropdown ────────────────────────────────────────────────────────
  function _togglePicker(triggerEl) {
    const existing = document.getElementById('dp-grid-picker-overlay');
    if (existing) { existing.remove(); return; }

    const sources = _getAvailableSources();

    const overlay = document.createElement('div');
    overlay.id = 'dp-grid-picker-overlay';
    overlay.style.cssText = [
      'position:fixed','inset:0','z-index:99999',
      'background:rgba(0,0,0,0.25)',
      'display:flex','align-items:center','justify-content:center',
    ].join(';');

    const card = document.createElement('div');
    card.style.cssText = [
      'background:var(--surface,#fff)',
      'border-radius:12px',
      'padding:8px',
      'min-width:280px',
      'max-height:360px',
      'overflow-y:auto',
      'box-shadow:0 8px 32px rgba(0,0,0,0.18)',
    ].join(';');

    if (!sources.length) {
      card.innerHTML = '<div style="padding:16px;text-align:center;color:#94a3b8;font-size:13px">暂无可用数据集<br>请先在文件中心导入文件</div>';
    } else {
      const title = document.createElement('div');
      title.style.cssText = 'padding:8px 10px 6px;font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:0.06em;text-transform:uppercase';
      title.textContent = '选择数据集';
      card.appendChild(title);

      sources.forEach(src => {
        const item = document.createElement('div');
        item.style.cssText = ['padding:8px 10px','border-radius:7px','cursor:pointer',
          'display:flex','flex-direction:column','gap:2px','transition:background 0.1s'].join(';');
        item.onmouseover = () => { item.style.background = 'rgba(99,102,241,0.07)'; };
        item.onmouseout  = () => { item.style.background = ''; };

        const name = document.createElement('div');
        name.style.cssText = 'font-size:13px;font-weight:600;color:var(--text,#0f172a)';
        name.textContent = src.name ?? src.filename ?? '—';

        const meta = document.createElement('div');
        meta.style.cssText = 'font-size:11px;color:#94a3b8;font-family:monospace';
        const cnt = Array.isArray(src.rows) ? src.rows.length : (src.rows ?? '?');
        meta.textContent = `${src.varName ?? src.name} · ${cnt} 行`;

        item.append(name, meta);
        item.addEventListener('click', e => {
          e.stopPropagation();
          overlay.remove();
          _openDataset(src);
        });
        card.appendChild(item);
      });
    }

    overlay.appendChild(card);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  }

  // ── Render table & wire edit events ───────────────────────────────────────
  function _renderTable(tabId) {
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return;

    emptyEl.style.display = 'none';
    const sortSt = sortStates[tabId] ?? { col: null, dir: 0 };
    const ed     = editState[tabId];

    const { html, truncated, total, filteredTotal } = _buildTable(tab.ds, sortSt, ed, filters);

    let existing = tableWrap.querySelector('.grid-table');
    if (existing) existing.remove();

    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    const tableEl = wrapper.firstElementChild;
    tableWrap.appendChild(tableEl);

    statShape.textContent = `${(ed ? ed.rows.length : total).toLocaleString()} 行 × ${tab.ds.columns.length} 列`;
    statFilter.textContent = filters.length ? ` · 过滤后：${filteredTotal.toLocaleString()} 行` : '';
    if (truncated) statFilter.textContent += ` (显示前 ${MAX_ROWS} 行)`;

    // ── Sort click ──────────────────────────────────────────────────────────
    tableEl.querySelectorAll('thead th[data-col]').forEach(th => {
      th.addEventListener('click', e => {
        if (e.target.closest('input')) return;
        const col = th.dataset.col;
        const st = sortStates[tabId];
        if (st.col === col) {
          st.dir = st.dir === 1 ? -1 : st.dir === -1 ? 0 : 1;
          if (st.dir === 0) st.col = null;
        } else { st.col = col; st.dir = 1; }
        _renderTable(tabId);
      });
    });

    // ── Double-click to edit ────────────────────────────────────────────────
    tableEl.querySelectorAll('tbody td[data-col]').forEach(td => {
      td.addEventListener('dblclick', () => _startEdit(td, tabId, tab.ds));
    });
  }

  // ── Cell editing ─────────────────────────────────────────────────────────
  function _startEdit(td, tabId, ds) {
    if (td.querySelector('input')) return; // already editing
    const col     = td.dataset.col;
    const origIdx = Number(td.dataset['orig-idx'] ?? td.dataset.origIdx ?? 0);
    // Read origIdx from parentRow
    const tr = td.closest('tr');
    const trOrigIdx = Number(tr?.dataset?.origIdx ?? origIdx);

    const currentVal = editState[tabId]?.rows[trOrigIdx]?.[col] ?? td.textContent;
    const input = document.createElement('input');
    input.value = currentVal;
    input.style.cssText =
      'width:100%;box-sizing:border-box;border:none;outline:2px solid #6366f1;' +
      'border-radius:3px;font-family:var(--code-font,"JetBrains Mono",monospace);' +
      'font-size:12px;padding:0 4px;background:var(--surface,#fff);color:var(--text,#0f172a)';
    td.textContent = '';
    td.appendChild(input);
    input.focus();
    input.select();

    const _commit = () => {
      const newVal = input.value;
      const ed = editState[tabId];
      if (!ed) return;
      const oldVal = ed.rows[trOrigIdx]?.[col];
      if (String(newVal) !== String(oldVal)) {
        // Track undo
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
        e.preventDefault();
        _commit();
        // Move to next editable td in same row
        const tds = [...tr.querySelectorAll('td[data-col]')];
        const idx = tds.indexOf(td);
        const next = tds[idx + 1];
        if (next) setTimeout(() => _startEdit(next, tabId, ds), 10);
      }
    });
    input.addEventListener('blur', _commit);
  }

  // ── Set active tab ─────────────────────────────────────────────────────────
  function _setActive(id) {
    activeTabId = id;
    _renderTabs();
    const tab = tabs.find(t => t.id === id);
    if (!tab) { _showEmpty(); return; }

    // Populate filter column select
    fcolEl.innerHTML = tab.ds.columns.map(c => `<option value="${c}">${c}</option>`).join('');
    _renderTable(id);
    _updateStatus();
  }

  function _showEmpty() {
    emptyEl.style.display = '';
    const t = tableWrap.querySelector('.grid-table');
    if (t) t.remove();
    statShape.textContent = '—'; statFilter.textContent = ''; _hideDirty();
  }

  function _closeTab(id) {
    const idx = tabs.findIndex(t => t.id === id);
    if (idx === -1) return;
    tabs.splice(idx, 1);
    delete editState[id]; delete sortStates[id];
    if (activeTabId === id) activeTabId = tabs[Math.min(idx, tabs.length - 1)]?.id ?? null;
    _renderTabs();
    if (activeTabId) _setActive(activeTabId);
    else _showEmpty();
  }

  // ── Filter ─────────────────────────────────────────────────────────────────
  function _renderFilterChips() {
    filterChips.innerHTML = '';
    filters.forEach((f, i) => {
      const chip = document.createElement('span');
      chip.className = 'g-filter-chip';
      chip.innerHTML = `<span>${f.col} ${f.op} "${f.val}"</span><button class="g-chip-close" data-fi="${i}">✕</button>`;
      filterChips.appendChild(chip);
    });
  }

  screen.querySelector('#g-filter-btn')?.addEventListener('click', () => {
    filterBar.style.display = filterBar.style.display === 'none' ? '' : 'none';
  });

  screen.querySelector('#g-fadd')?.addEventListener('click', () => {
    const col = fcolEl.value;
    const op  = screen.querySelector('#g-fop').value;
    const val = fvalEl.value.trim();
    if (!col || !val) return;
    filters.push({ col, op, val });
    fvalEl.value = '';
    _renderFilterChips();
    if (activeTabId) _renderTable(activeTabId);
    _updateStatus();
  });

  filterChips.addEventListener('click', e => {
    const btn = e.target.closest('[data-fi]');
    if (!btn) return;
    filters.splice(Number(btn.dataset.fi), 1);
    _renderFilterChips();
    if (activeTabId) _renderTable(activeTabId);
    _updateStatus();
  });

  // ── Undo ───────────────────────────────────────────────────────────────────
  undoBtn?.addEventListener('click', () => {
    const op = undoStack.pop();
    if (!op) return;
    const ed = editState[op.tabId];
    if (!ed) return;
    ed.rows[op.origIdx][op.col] = op.oldVal;
    // Recheck if still dirty
    const tab = tabs.find(t => t.id === op.tabId);
    if (tab) {
      const orig = tab.ds.rows[op.origIdx];
      const cur  = ed.rows[op.origIdx];
      const stillDirty = tab.ds.columns.some(c => String(cur[c]) !== String(orig?.[c] ?? ''));
      if (!stillDirty) ed.dirtyIndices.delete(op.origIdx);
    }
    ed.dirtyCount = ed.dirtyIndices.size;
    _renderTable(op.tabId);
    _updateStatus();
  });

  // ── Sync to kernel ─────────────────────────────────────────────────────────
  async function _syncToKernel() {
    const tab = _activeTab();
    const ed  = _activeEdit();
    if (!tab || !ed) return;

    syncBtn.disabled = true;
    syncBtn.innerHTML = '<i class="ti ti-loader-2"></i> 同步中…';
    try {
      const csv = _rowsToCSV(tab.ds.columns, ed.rows);
      await injectDataFrame(tab.varName, csv, 'csv', '', {});
      ed.dirtyCount = 0;
      ed.dirtyIndices.clear();
      undoStack.length = 0;
      _renderTable(tab.id);
      _updateStatus();
      syncBtn.innerHTML = '<i class="ti ti-check"></i> 已同步';
      setTimeout(() => { syncBtn.innerHTML = '<i class="ti ti-refresh"></i> 同步到内核'; syncBtn.disabled = false; }, 2000);
    } catch (err) {
      console.warn('[DP Grid] sync failed:', err);
      statDirty.textContent = '· 同步失败，请先运行一个 cell 初始化内核';
      syncBtn.innerHTML = '<i class="ti ti-refresh"></i> 同步到内核';
      syncBtn.disabled = false;
    }
  }

  syncBtn?.addEventListener('click', _syncToKernel);
  syncStatBtn?.addEventListener('click', _syncToKernel);

  // ── Save as ────────────────────────────────────────────────────────────────
  saveBtn?.addEventListener('click', () => {
    const tab = _activeTab();
    const ed  = _activeEdit();
    if (!tab) return;
    const rows = ed ? ed.rows : tab.ds.rows;

    // Simple format menu
    const menu = document.createElement('div');
    menu.className = 'grid-picker';
    menu.style.cssText = 'position:fixed;z-index:500;bottom:60px;right:80px;min-width:140px';
    [['CSV', 'csv', 'text/csv'], ['JSON', 'json', 'application/json'], ['TSV', 'tsv', 'text/tab-separated-values']].forEach(([label, ext, mime]) => {
      const item = document.createElement('div');
      item.className = 'grid-picker-item';
      item.innerHTML = `<div class="grid-picker-name">${label}</div>`;
      item.addEventListener('click', () => {
        let content;
        if (ext === 'csv') content = _rowsToCSV(tab.ds.columns, rows);
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

  // ── Send to ARIA ───────────────────────────────────────────────────────────
  ariaBtn?.addEventListener('click', () => {
    const tab = _activeTab();
    const ed  = _activeEdit();
    if (!tab) return;
    const rows = ed ? ed.rows : tab.ds.rows;
    setDataset({ name: tab.filename, columns: tab.ds.columns, dtypes: tab.ds.dtypes, rows });
    // Switch to ARIA screen
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

  // ── Dataset selector overlay (fixed, centred, avoids overflow:hidden) ──────
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
        item.style.cssText =
          'padding:10px 12px;border-radius:8px;cursor:pointer;' +
          'transition:background 0.1s;margin-bottom:4px';
        item.onmouseenter = () => { item.style.background = 'rgba(99,102,241,0.08)'; };
        item.onmouseleave = () => { item.style.background = ''; };

        const name = src.name ?? src.filename ?? '—';
        const varN = src.varName ?? src.name ?? '—';
        const cnt  = src.rows ? (Array.isArray(src.rows) ? src.rows.length : src.rows) : '?';

        item.innerHTML =
          `<div style="font-weight:600;font-size:0.82rem;color:#0f172a">${name}</div>` +
          `<div style="font-size:0.68rem;color:#94a3b8;font-family:monospace">${varN} · ${cnt} 行</div>`;

        item.addEventListener('click', () => {
          overlay.remove();
          _openDataset(src);
        });
        modal.appendChild(item);
      });
    }

    overlay.appendChild(modal);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }

  // ── Empty state open btn ──────────────────────────────────────────────────
  screen.querySelector('#grid-empty-open')?.addEventListener('click', e => {
    e.stopPropagation();   // 防止点击事件冒泡到父元素触发关闭逻辑
    _showDatasetOverlay();
  });

  // ── Init ──────────────────────────────────────────────────────────────────
  _renderTabs();
  _showEmpty();

  // Expose for debugging / external use
  window._gridOpenDataset = _openDataset;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupGridScreen);
} else {
  setupGridScreen();
}
