// ── File Manager — right bar panel ───────────────────────────────────────────
// Unified file import centre: files imported here are immediately available
// to both Notebook (py.FS) and Quick Analysis (dataset_store / ARIA tabs).
// No "select destination" step — import once, use everywhere.

import { setDataset, removeDataset }      from '../shared/dataset_store.js';
import { ensureXlsx, parseToDataset }    from '../import/import_data.js';
import { writeToFS }                     from '../compiler/compiler.js';
import { createSettingsPanel, getSettings } from './settings.js';

const INJECT_KEY = 'dreaming-polar-inject-store';

const TYPE_ICON = {
  csv:  'ti-file-type-csv',
  json: 'ti-file-type-json',
  xlsx: 'ti-file-spreadsheet',
  xls:  'ti-file-spreadsheet',
  xml:  'ti-file-code-2',
};

// ── inject-store helpers ──────────────────────────────────────────────────────
function _loadStore() {
  try { return JSON.parse(localStorage.getItem(INJECT_KEY) ?? '{}'); }
  catch { return {}; }
}

function _saveStore(store) {
  try { localStorage.setItem(INJECT_KEY, JSON.stringify(store)); }
  catch (e) { console.warn('[file-manager] localStorage quota exceeded:', e.message); }
}

// ── Parse entry → dataset {columns, dtypes, rows} ─────────────────────────────
async function _parseEntry(entry) {
  const { fileType, filename, data: raw, isBase64 } = entry;
  const isExcel = fileType === 'xlsx' || fileType === 'xls';

  if (isExcel) {
    const XLSX = await ensureXlsx();
    const binary = atob(raw);
    const bytes  = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const wb  = XLSX.read(bytes, { type: 'array' });
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
    return parseToDataset(csv, filename);
  }
  const text = isBase64 ? atob(raw) : raw;
  return parseToDataset(text, filename);
}

// Runnable import code inserted into a Notebook cell
function _buildCode(entry) {
  const { varName, fileType, filename } = entry;
  const readers = {
    csv:  `pd.read_csv("${filename}")`,
    json: `pd.read_json("${filename}")`,
    xlsx: `pd.read_excel("${filename}")`,
    xls:  `pd.read_excel("${filename}")`,
    xml:  `pd.read_xml("${filename}")`,
  };
  const reader = readers[fileType] ?? `pd.read_csv("${filename}")`;
  return (
    `# "${filename}" → ${varName}\n` +
    `import pandas as pd\n` +
    `${varName} = ${reader}\n` +
    `print(${varName}.shape)\n` +
    `${varName}.head()`
  );
}

// Friendly hint comment (kept for drag-to-editor use)
function _buildHint(entry) {
  const { varName, filename, fileType } = entry;
  const readers = {
    csv:  `pd.read_csv("${filename}")`,
    json: `pd.read_json("${filename}")`,
    xlsx: `pd.read_excel("${filename}")`,
    xls:  `pd.read_excel("${filename}")`,
    xml:  `pd.read_xml("${filename}")`,
  };
  const reader = readers[fileType] ?? `pd.read_csv("${filename}")`;
  return (
    `# "${filename}" 已就绪，直接读取：\n` +
    `import pandas as pd\n` +
    `${varName} = ${reader}\n` +
    `${varName}.head()`
  );
}

// ── Restore inject-store → dataset_store on page load ────────────────────────
// dataset_store is in-memory only. On page load we re-parse each inject-store
// entry so ARIA gets real rows (not empty arrays) for its AI prompts.
// Each entry is parsed independently — one failure won't block others.
async function _syncStoreToDataset() {
  const store   = _loadStore();
  const entries = Object.values(store).filter(e => e?.filename && e?.data != null);
  for (const entry of entries) {
    try {
      const dataset = await _parseEntry(entry);
      if (dataset) setDataset(dataset);
    } catch (e) {
      // Fallback: at least register metadata so ARIA tab appears
      console.warn('[file-manager] parse failed on restore, using metadata:', entry.filename, e);
      try {
        setDataset({
          name:    entry.filename,
          columns: entry.columnNames ?? [],
          dtypes:  {},
          rows:    [],
        });
      } catch (_) {}
    }
  }
}

export function initFileManager() {
  const rightBar = document.getElementById('right-bar');
  if (!rightBar) return;

  _syncStoreToDataset();

  // ── Two strip buttons: Files + Settings ───────────────────────────────────
  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'rb-btn rb-file-toggle-btn';
  toggleBtn.title = '文件管理';
  toggleBtn.innerHTML = `<i class="ti ti-folder-open" style="font-size:14px"></i>`;

  const settingsBtn = document.createElement('button');
  settingsBtn.className = 'rb-btn rb-settings-toggle-btn';
  settingsBtn.title = '设置';
  settingsBtn.innerHTML = `<i class="ti ti-settings" style="font-size:14px"></i>`;

  const rbTop = rightBar.querySelector('.rb-top');
  rbTop?.appendChild(toggleBtn);
  rbTop?.appendChild(settingsBtn);

  // ── Outer container — clips the two-panel slide ───────────────────────────
  const panelOuter = document.createElement('div');
  panelOuter.className = 'rb-panel-outer';
  panelOuter.hidden = true;
  rightBar.appendChild(panelOuter);

  // ── Inner sliding track — contains FILES panel + SETTINGS panel ───────────
  const panelTrack = document.createElement('div');
  panelTrack.className = 'rb-panel-track';
  panelOuter.appendChild(panelTrack);

  // ── Files panel ───────────────────────────────────────────────────────────
  const panel = document.createElement('div');
  panel.className = 'rb-file-panel rb-slide-pane';
  panelTrack.appendChild(panel);

  // ── Settings panel (appended to track after files) ────────────────────────
  const { panel: settingsPanel, settings: initialSettings, hdrClose: settingsClose } = createSettingsPanel(
    (key, val) => _onSettingChange(key, val)
  );
  settingsPanel.classList.add('rb-slide-pane');
  settingsClose?.addEventListener('click', _close);
  panelTrack.appendChild(settingsPanel);

  let _activePane = 'files'; // 'files' | 'settings'

  function _slideToPane(pane) {
    _activePane = pane;
    panelTrack.style.transform = pane === 'settings' ? 'translateX(-50%)' : 'translateX(0)';
    toggleBtn.classList.toggle('rb-btn--active',   pane === 'files');
    settingsBtn.classList.toggle('rb-btn--active', pane === 'settings');
    // Save state if setting is on
    if (getSettings().cacheRightBarState) {
      localStorage.setItem('dp-rb-pane', pane);
    }
  }

  function _onSettingChange(key, val) {
    if (key === 'cacheNotebookOutput' && !val) {
      // clear output cache when disabled
      try { localStorage.removeItem('dreaming-polar-nb-outputs'); } catch (_) {}
    }
  }

  // ── Auto-switch: watch editor for pd.read_csv ─────────────────────────────
  document.addEventListener('notebook-cell-focused', () => {
    if (!getSettings().autoSwitchFiles) return;
    if (!_open) return;
    // Give time for editor to update, then check active line
    setTimeout(() => {
      const activeEditor = document.querySelector('.nb-cell:focus-within .nb-editor');
      if (!activeEditor) return;
      const val = activeEditor.value ?? '';
      const lines = val.split('\n');
      const sel   = activeEditor.selectionStart ?? 0;
      const lineIdx = val.slice(0, sel).split('\n').length - 1;
      const line  = lines[lineIdx] ?? '';
      if (/pd\.read_(?:csv|json|excel|xml)\s*\(/.test(line) && _activePane !== 'files') {
        _slideToPane('files');
      }
    }, 80);
  });

  let _open = false;

  function _open_() {
    _open = true;
    panelOuter.hidden = false;
    rightBar.classList.add('rb--expanded');
    toggleBtn.classList.add('rb-btn--active');
    settingsBtn.classList.remove('rb-btn--active');
    if (getSettings().cacheRightBarState) {
      localStorage.setItem('dp-rb-open', '1');          // ← persist open state
      const saved = localStorage.getItem('dp-rb-pane');
      if (saved === 'settings') { _slideToPane('settings'); } else { _slideToPane('files'); }
    } else {
      _slideToPane('files');
    }
    _refresh();
  }
  function _close() {
    _open = false;
    panelOuter.hidden = true;
    rightBar.classList.remove('rb--expanded');
    toggleBtn.classList.remove('rb-btn--active');
    settingsBtn.classList.remove('rb-btn--active');
    if (getSettings().cacheRightBarState) {
      localStorage.removeItem('dp-rb-open');             // ← persist closed state
    }
    _exitSelectMode();
  }

  // ── Auto-restore on page load if state memory is ON ──────────────────────
  if (getSettings().cacheRightBarState && localStorage.getItem('dp-rb-open') === '1') {
    // Defer so DOM is fully set up first
    requestAnimationFrame(() => _open_());
  }

  toggleBtn.addEventListener('click', () => {
    if (!_open) { _open_(); _slideToPane('files'); }
    else if (_activePane === 'files') { _close(); }
    else { _slideToPane('files'); }
  });

  settingsBtn.addEventListener('click', () => {
    if (!_open) { _open_(); _slideToPane('settings'); }
    else if (_activePane === 'settings') { _close(); }
    else { _slideToPane('settings'); }
  });

  // ── Files panel header ────────────────────────────────────────────────────

  // Header row: title + import button + close
  const hdr = document.createElement('div');
  hdr.className = 'rb-file-hdr';

  const hdrTitle = document.createElement('span');
  hdrTitle.className = 'rb-file-hdr-title';
  hdrTitle.textContent = 'Files';

  // ── "+ Import" button — the new primary entry point ────────────────────────
  const importBtn = document.createElement('button');
  importBtn.className = 'rb-file-import-btn';
  importBtn.title = '导入文件';
  importBtn.innerHTML = `<i class="ti ti-plus"></i> 导入`;

  const hdrClose = document.createElement('button');
  hdrClose.className = 'rb-file-hdr-close';
  hdrClose.innerHTML = `<i class="ti ti-x"></i>`;
  hdrClose.addEventListener('click', _close);

  // "管理" toggle — enters select mode
  const manageBtn = document.createElement('button');
  manageBtn.className = 'rb-file-manage-btn';
  manageBtn.title = '管理文件';
  manageBtn.textContent = '管理';

  hdr.append(hdrTitle, importBtn, manageBtn, hdrClose);

  const body = document.createElement('div');
  body.className = 'rb-file-body';

  // Delete bar (shown in select mode when ≥1 item checked)
  const deleteBar = document.createElement('div');
  deleteBar.className = 'rb-file-delete-bar';
  deleteBar.hidden = true;
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'rb-file-delete-btn';
  deleteBtn.innerHTML = `<i class="ti ti-trash"></i> <span class="rb-del-label">删除所选</span>`;
  const cancelSelBtn = document.createElement('button');
  cancelSelBtn.className = 'rb-file-cancel-sel-btn';
  cancelSelBtn.textContent = '取消';
  deleteBar.append(deleteBtn, cancelSelBtn);

  panel.append(hdr, body, deleteBar);

  let _selectMode = false;
  const _selected = new Set(); // keys in inject-store

  // ── Select mode ───────────────────────────────────────────────────────────
  function _enterSelectMode() {
    _selectMode = true;
    _selected.clear();
    manageBtn.textContent = '完成';
    manageBtn.classList.add('rb-file-manage-btn--active');
    panel.classList.add('rb-panel--select');
    _updateDeleteBar();
    _refresh();
  }
  function _exitSelectMode() {
    _selectMode = false;
    _selected.clear();
    manageBtn.textContent = '管理';
    manageBtn.classList.remove('rb-file-manage-btn--active');
    panel.classList.remove('rb-panel--select');
    deleteBar.hidden = true;
    _refresh();
  }
  function _updateDeleteBar() {
    const n = _selected.size;
    deleteBar.hidden = !(_selectMode && n > 0);
    deleteBar.querySelector('.rb-del-label').textContent =
      n > 0 ? `删除所选 (${n})` : '删除所选';
  }

  manageBtn.addEventListener('click', () =>
    _selectMode ? _exitSelectMode() : _enterSelectMode()
  );

  cancelSelBtn.addEventListener('click', _exitSelectMode);

  deleteBtn.addEventListener('click', () => {
    if (!_selected.size) return;
    const store = _loadStore();
    // Remove from dataset_store (ARIA tabs) before wiping inject-store entries
    _selected.forEach(key => {
      const filename = store[key]?.filename;
      if (filename) removeDataset(filename);  // triggers dataset-updated → ARIA refreshes
      delete store[key];
    });
    _saveStore(store);
    _selected.clear();
    _exitSelectMode();
    document.dispatchEvent(new CustomEvent('nb-file-imported'));
  });

  // ── Core import logic ─────────────────────────────────────────────────────
  // 1. Parse file in JS
  // 2. Save to inject-store (Notebook cells can flush on Run)
  // 3. Write to Pyodide FS (any cell can use filename directly)
  // 4. Write to dataset_store (ARIA tabs appear immediately)
  async function _doImport(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    const fileType = ['xlsx','xls','json','xml'].includes(ext) ? ext : 'csv';
    const isExcel  = fileType === 'xlsx' || fileType === 'xls';

    importBtn.disabled = true;
    importBtn.innerHTML = `<i class="ti ti-loader-2" style="animation:spin .8s linear infinite"></i>`;

    try {
      // Read raw data
      let rawData, isBase64 = false;
      if (isExcel) {
        const buf = await file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        // Store as base64 for JSON-serializable inject-store
        let bin = '';
        bytes.forEach(b => { bin += String.fromCharCode(b); });
        rawData = btoa(bin);
        isBase64 = true;
      } else {
        rawData = await file.text();
      }

      // Parse for metadata (columns, dtypes, rows)
      const tempEntry = { fileType, filename: file.name, data: rawData, isBase64 };
      const dataset = await _parseEntry(tempEntry);
      if (!dataset) throw new Error('文件解析失败');

      const varName = _resolveVarName(file.name);
      const rows    = dataset.rows.length;
      const columns = dataset.columns.length;

      // Save to inject-store
      const store = _loadStore();
      const cellId = `fm_${Date.now()}`; // file-manager owned entry (no cell binding)
      store[cellId] = {
        varName, fileType,
        filename:    file.name,
        rows,
        columns,
        columnNames: dataset.columns,
        data:        rawData,
        isBase64,
      };
      _saveStore(store);

      // Write to Pyodide FS (independent, best-effort)
      try {
        writeToFS(file.name, isExcel ? rawData : rawData, fileType);
      } catch (e) {
        console.warn('[file-manager] writeToFS failed:', e);
      }

      // Write to dataset_store → ARIA tabs (independent, best-effort)
      try {
        setDataset(dataset);
      } catch (e) {
        console.warn('[file-manager] setDataset failed:', e);
      }

      // Notify listeners
      document.dispatchEvent(new CustomEvent('nb-file-imported', {
        detail: { varName, rows, columns, filename: file.name, fileType, cellId },
      }));

      _refresh();
    } catch (err) {
      console.warn('[file-manager] import failed:', err);
      // Show inline error briefly
      const errEl = document.createElement('div');
      errEl.className = 'rb-file-empty';
      errEl.style.color = '#dc2626';
      errEl.textContent = `✗ ${err.message ?? '导入失败'}`;
      body.prepend(errEl);
      setTimeout(() => errEl.remove(), 3000);
    } finally {
      importBtn.disabled = false;
      importBtn.innerHTML = `<i class="ti ti-plus"></i> 导入`;
    }
  }

  importBtn.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type   = 'file';
    input.accept = '.csv,.xlsx,.xls,.json,.xml';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', async () => {
      const file = input.files[0];
      input.remove();
      if (file) await _doImport(file);
    });
    input.click();
  });

  // Allocate a Python variable name that doesn't clash with existing ones
  const _usedVarNames = new Set();
  function _resolveVarName(filename) {
    const base = filename
      .replace(/\.[^.]+$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'df';
    // Seed from existing store
    if (!_usedVarNames.size) {
      Object.values(_loadStore()).forEach(e => { if (e.varName) _usedVarNames.add(e.varName); });
    }
    if (!_usedVarNames.has('df')) { _usedVarNames.add('df'); return 'df'; }
    let name = `df_${base}`, i = 2;
    while (_usedVarNames.has(name)) name = `df_${base}_${i++}`;
    _usedVarNames.add(name);
    return name;
  }

  // ── Render file list ───────────────────────────────────────────────────────
  function _refresh() {
    body.innerHTML = '';
    const store = _loadStore();

    // Deduplicate by filename — keep the entry with most info (prefer fm_* over cell-id)
    const byFilename = new Map(); // filename → {key, entry}
    Object.entries(store).forEach(([key, entry]) => {
      if (!entry?.filename) return;
      const existing = byFilename.get(entry.filename);
      // Prefer fm_* entries (file-manager owned) over cell-id entries
      if (!existing || key.startsWith('fm_')) {
        byFilename.set(entry.filename, { key, entry });
      }
    });

    const dedupedEntries = [...byFilename.values()];

    if (!dedupedEntries.length) {
      const empty = document.createElement('div');
      empty.className = 'rb-file-empty';
      empty.innerHTML =
        `<i class="ti ti-inbox" style="font-size:28px;opacity:.3"></i>` +
        `<span>还没有导入文件<br><small>点击上方"导入"按钮添加文件</small></span>`;
      body.appendChild(empty);
      return;
    }

    // Section: 数据文件
    const sec = _makeSection('数据文件', 'ti-database');
    dedupedEntries.forEach(({ key, entry }) => sec.body.appendChild(_makeFileItem(key, entry)));
    body.appendChild(sec.el);

    // Section: 模型 & 配置 (placeholder)
    const modelSec = _makeSection('模型 & 配置', 'ti-brain', true);
    const placeholder = document.createElement('div');
    placeholder.className = 'rb-file-placeholder';
    placeholder.textContent = '开发中 — 保存训练好的模型';
    modelSec.body.appendChild(placeholder);
    body.appendChild(modelSec.el);
  }

  function _makeSection(title, icon, collapsed = false) {
    const el   = document.createElement('div');
    el.className = 'rb-file-section';

    const hdr  = document.createElement('div');
    hdr.className = 'rb-file-section-hdr';
    hdr.innerHTML =
      `<i class="ti ${icon} rb-file-section-icon"></i><span>${title}</span>` +
      `<i class="ti ti-chevron-down rb-file-section-chevron${collapsed ? '' : ' open'}"></i>`;

    const sBody = document.createElement('div');
    sBody.className = 'rb-file-section-body';
    if (collapsed) sBody.hidden = true;

    hdr.addEventListener('click', () => {
      const isOpen = !sBody.hidden;
      sBody.hidden = isOpen;
      hdr.querySelector('.rb-file-section-chevron').classList.toggle('open', !isOpen);
    });

    el.append(hdr, sBody);
    return { el, body: sBody };
  }

  function _makeFileItem(storeKey, entry) {
    const { varName, fileType, filename, rows, columns } = entry;
    const item = document.createElement('div');
    item.className = 'rb-file-item';
    item.draggable = !_selectMode;

    // ── Select circle (visible in select mode) ────────────────────────────
    const circle = document.createElement('span');
    circle.className = 'rb-file-select-circle';
    circle.innerHTML = `<i class="ti ti-check rb-file-check-icon"></i>`;

    const iconEl = document.createElement('i');
    iconEl.className = `ti ${TYPE_ICON[fileType] ?? 'ti-file'} rb-file-item-icon`;

    const info = document.createElement('div');
    info.className = 'rb-file-item-info';

    const nameEl = document.createElement('div');
    nameEl.className = 'rb-file-item-name';
    nameEl.textContent = filename ?? varName;

    const metaEl = document.createElement('div');
    metaEl.className = 'rb-file-item-meta';
    metaEl.textContent = rows
      ? `${Number(rows).toLocaleString()}行 · ${columns}列 · ${varName}`
      : varName;

    info.append(nameEl, metaEl);

    // "→ Notebook" icon button (hidden in select mode)
    const toNbBtn = document.createElement('button');
    toNbBtn.className = 'rb-file-action-btn';
    toNbBtn.title = '插入到 Notebook';
    toNbBtn.setAttribute('aria-label', '插入到 Notebook');
    toNbBtn.innerHTML = `<i class="ti ti-corner-down-left"></i>`;
    // Shared smart-click dispatcher used by both the row click and the ↵ button
    function _smartClick() {
      document.dispatchEvent(new CustomEvent('rb-file-smart-click', {
        detail: { code: _buildCode(entry), entry },
      }));
      item.classList.add('rb-file-item--flash');
      setTimeout(() => item.classList.remove('rb-file-item--flash'), 600);
    }

    toNbBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (_selectMode) return;
      _smartClick();
    });

    item.append(circle, iconEl, info, toNbBtn);

    item.addEventListener('click', () => {
      if (_selectMode) {
        if (_selected.has(storeKey)) {
          _selected.delete(storeKey);
          item.classList.remove('rb-file-item--selected');
        } else {
          _selected.add(storeKey);
          item.classList.add('rb-file-item--selected');
        }
        _updateDeleteBar();
        return;
      }
      _smartClick();
    });

    item.addEventListener('dragstart', e => {
      if (_selectMode) { e.preventDefault(); return; }
      e.dataTransfer.setData('text/plain', _buildCode(entry));
      e.dataTransfer.effectAllowed = 'copy';
    });

    return item;
  }

  // ── Event listeners ────────────────────────────────────────────────────────
  // Always refresh when panel is open. On kernel-restarted, read directly from
  // localStorage (inject-store itself is not touched by kernel reset).
  document.addEventListener('nb-file-imported',  () => { if (_open) _refresh(); });
  document.addEventListener('kernel-restarted',   () => { if (_open) _refresh(); });
  document.addEventListener('dataset-updated',    () => { if (_open) _refresh(); });
}
