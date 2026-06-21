// ── File Manager — right bar panel ───────────────────────────────────────────
// Unified file import centre: files imported here are immediately available
// to both Notebook (py.FS) and Quick Analysis (dataset_store / ARIA tabs).
// No "select destination" step — import once, use everywhere.

import { setDataset }                    from '../shared/dataset_store.js';
import { ensureXlsx, parseToDataset }    from '../import/import_data.js';
import { writeToFS }                     from '../compiler/compiler.js';

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

// Friendly code hint shown when clicking a file item
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

export function initFileManager() {
  const rightBar = document.getElementById('right-bar');
  if (!rightBar) return;

  // ── Toggle button ─────────────────────────────────────────────────────────
  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'rb-btn rb-file-toggle-btn';
  toggleBtn.title = '文件管理';
  toggleBtn.innerHTML = `<i class="ti ti-folder-open" style="font-size:14px"></i>`;
  rightBar.querySelector('.rb-top')?.appendChild(toggleBtn);

  // ── Panel ─────────────────────────────────────────────────────────────────
  const panel = document.createElement('div');
  panel.className = 'rb-file-panel';
  panel.hidden = true;
  rightBar.appendChild(panel);

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

  hdr.append(hdrTitle, importBtn, hdrClose);

  const body = document.createElement('div');
  body.className = 'rb-file-body';

  panel.append(hdr, body);

  let _open = false;

  function _open_() {
    _open = true;
    panel.hidden = false;
    rightBar.classList.add('rb--expanded');
    toggleBtn.classList.add('rb-btn--active');
    _refresh();
  }
  function _close() {
    _open = false;
    panel.hidden = true;
    rightBar.classList.remove('rb--expanded');
    toggleBtn.classList.remove('rb-btn--active');
  }

  toggleBtn.addEventListener('click', () => _open ? _close() : _open_());

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
    const store   = _loadStore();
    const entries = Object.values(store);

    if (!entries.length) {
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
    entries.forEach(entry => sec.body.appendChild(_makeFileItem(entry)));
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

  function _makeFileItem(entry) {
    const { varName, fileType, filename, rows, columns } = entry;
    const item = document.createElement('div');
    item.className = 'rb-file-item';
    item.draggable = true;
    item.title = `${filename} — 点击插入使用提示`;

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
    item.append(iconEl, info);

    // Click → insert a friendly hint comment into the focused cell
    item.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('rb-insert-file', {
        detail: { code: _buildHint(entry), entry },
      }));
      item.classList.add('rb-file-item--flash');
      setTimeout(() => item.classList.remove('rb-file-item--flash'), 600);
    });

    item.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', _buildHint(entry));
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
