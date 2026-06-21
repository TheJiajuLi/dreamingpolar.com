// ── File Manager — right bar panel ───────────────────────────────────────────
// Reads imported files from the inject store (localStorage), renders a
// collapsible file-tree panel in the right bar, and lets users click/drag
// files to re-generate import code in the focused notebook cell.

import { setDataset } from '../shared/dataset_store.js';
import { ensureXlsx, parseToDataset } from '../import/import_data.js';

const INJECT_KEY = 'dreaming-polar-inject-store';

const TYPE_ICON = {
  csv:  'ti-file-type-csv',
  json: 'ti-file-type-json',
  xlsx: 'ti-file-spreadsheet',
  xls:  'ti-file-spreadsheet',
  xml:  'ti-file-code-2',
};

function _loadStore() {
  try { return JSON.parse(localStorage.getItem(INJECT_KEY) ?? '{}'); }
  catch { return {}; }
}

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

export function initFileManager() {
  const rightBar = document.getElementById('right-bar');
  if (!rightBar) return;

  // ── Toggle button (always visible in narrow strip) ─────────────────────────
  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'rb-btn rb-file-toggle-btn';
  toggleBtn.title = '文件管理';
  toggleBtn.innerHTML = `<i class="ti ti-folder-open" style="font-size:14px"></i>`;
  rightBar.querySelector('.rb-top')?.appendChild(toggleBtn);

  // ── Slide-out panel ────────────────────────────────────────────────────────
  const panel = document.createElement('div');
  panel.className = 'rb-file-panel';
  panel.hidden = true;
  rightBar.appendChild(panel);

  // Header
  const hdr = document.createElement('div');
  hdr.className = 'rb-file-hdr';
  const hdrTitle = document.createElement('span');
  hdrTitle.className = 'rb-file-hdr-title';
  hdrTitle.textContent = 'Files';
  const hdrClose = document.createElement('button');
  hdrClose.className = 'rb-file-hdr-close';
  hdrClose.innerHTML = `<i class="ti ti-x"></i>`;
  hdrClose.addEventListener('click', _close);
  hdr.append(hdrTitle, hdrClose);

  // Scrollable body
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

  // ── Render file list ───────────────────────────────────────────────────────
  function _refresh() {
    body.innerHTML = '';
    const store = _loadStore();
    const entries = Object.values(store);

    if (!entries.length) {
      const empty = document.createElement('div');
      empty.className = 'rb-file-empty';
      empty.innerHTML =
        `<i class="ti ti-inbox" style="font-size:28px;opacity:.3"></i>` +
        `<span>还没有导入文件<br><small>点击 cell 工具栏的导入按钮</small></span>`;
      body.appendChild(empty);
      return;
    }

    // ── Section: 数据文件 ────────────────────────────────────────────────────
    const sec = _makeSection('数据文件', 'ti-database');
    entries.forEach(entry => {
      const item = _makeFileItem(entry);
      sec.body.appendChild(item);
    });
    body.appendChild(sec.el);

    // ── Section: 模型 (placeholder for future) ──────────────────────────────
    const modelSec = _makeSection('模型 & 配置', 'ti-brain', true /* collapsed */);
    const modelPlaceholder = document.createElement('div');
    modelPlaceholder.className = 'rb-file-placeholder';
    modelPlaceholder.textContent = '开发中 — 保存训练好的模型';
    modelSec.body.appendChild(modelPlaceholder);
    body.appendChild(modelSec.el);
  }

  function _makeSection(title, icon, collapsed = false) {
    const el = document.createElement('div');
    el.className = 'rb-file-section';

    const hdr = document.createElement('div');
    hdr.className = 'rb-file-section-hdr';
    hdr.innerHTML = `<i class="ti ${icon} rb-file-section-icon"></i><span>${title}</span>` +
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

  // ── Parse inject-store raw data → dataset {columns, dtypes, rows} ────────────
  async function _parseEntry(entry) {
    const { fileType, filename, data: raw, isBase64 } = entry;
    const isExcel = fileType === 'xlsx' || fileType === 'xls';

    if (isExcel) {
      // raw is base64-encoded binary; need SheetJS to convert to CSV first
      const XLSX = await ensureXlsx();
      const binary = atob(raw);
      const bytes  = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const wb  = XLSX.read(bytes, { type: 'array' });
      const csv = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
      return parseToDataset(csv, filename);
    }

    // csv / json / xml: raw is plain text
    const text = isBase64 ? atob(raw) : raw;
    return parseToDataset(text, filename);
  }

  function _makeFileItem(entry) {
    const { varName, fileType, filename, rows, columns } = entry;
    const item = document.createElement('div');
    item.className = 'rb-file-item';
    item.draggable = true;
    item.title = `${filename}\n${varName} — ${rows}行×${columns}列`;

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

    // ── Action buttons (visible on row hover) ──────────────────────────────
    const actions = document.createElement('div');
    actions.className = 'rb-file-item-actions';

    // "发送到 Notebook" — same as clicking the row
    const toNbBtn = document.createElement('button');
    toNbBtn.className = 'rb-file-action-btn';
    toNbBtn.title = '发送到 Notebook (插入导入代码)';
    toNbBtn.setAttribute('aria-label', '发送到 Notebook');
    toNbBtn.innerHTML = `<i class="ti ti-notebook"></i>`;
    toNbBtn.addEventListener('click', e => {
      e.stopPropagation();
      document.dispatchEvent(new CustomEvent('rb-insert-file', {
        detail: { code: _buildCode(entry), entry },
      }));
      item.classList.add('rb-file-item--flash');
      setTimeout(() => item.classList.remove('rb-file-item--flash'), 600);
    });

    // "发送到 Quick Analysis" — parse raw data, write to dataset_store
    const toAriaBtn = document.createElement('button');
    toAriaBtn.className = 'rb-file-action-btn';
    toAriaBtn.title = '发送到 Quick Analysis (ARIA)';
    toAriaBtn.setAttribute('aria-label', '发送到 Quick Analysis');
    toAriaBtn.innerHTML = `<i class="ti ti-message-bolt"></i>`;
    toAriaBtn.addEventListener('click', async e => {
      e.stopPropagation();
      toAriaBtn.disabled = true;
      const origHtml = toAriaBtn.innerHTML;
      toAriaBtn.innerHTML = `<i class="ti ti-loader-2" style="animation:spin .8s linear infinite"></i>`;
      try {
        const dataset = await _parseEntry(entry);
        if (!dataset) throw new Error('解析失败');
        setDataset(dataset);   // triggers dataset-updated → ARIA tabs update
        item.classList.add('rb-file-item--flash');
        setTimeout(() => item.classList.remove('rb-file-item--flash'), 600);
        metaEl.textContent = `✓ 已发送到 ARIA`;
        setTimeout(() => {
          metaEl.textContent = rows
            ? `${Number(rows).toLocaleString()}行 · ${columns}列 · ${varName}`
            : varName;
        }, 2000);
      } catch (err) {
        metaEl.textContent = `✗ ${err.message ?? '解析失败，暂不支持'}`;
        setTimeout(() => {
          metaEl.textContent = rows
            ? `${Number(rows).toLocaleString()}行 · ${columns}列 · ${varName}`
            : varName;
        }, 3000);
        console.warn('[file-manager] send to ARIA failed:', err);
      } finally {
        toAriaBtn.disabled = false;
        toAriaBtn.innerHTML = origHtml;
      }
    });

    actions.append(toNbBtn, toAriaBtn);
    item.append(iconEl, info, actions);

    // Row click still inserts to Notebook (existing behavior unchanged)
    item.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('rb-insert-file', {
        detail: { code: _buildCode(entry), entry },
      }));
      item.classList.add('rb-file-item--flash');
      setTimeout(() => item.classList.remove('rb-file-item--flash'), 600);
    });

    item.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', _buildCode(entry));
      e.dataTransfer.effectAllowed = 'copy';
    });

    return item;
  }

  // ── React to external events ───────────────────────────────────────────────
  document.addEventListener('dataset-updated',  () => { if (_open) _refresh(); });
  document.addEventListener('kernel-restarted', () => { if (_open) _refresh(); });
  // Refresh when inject store changes (e.g., user imports a new file)
  // nb-file-imported fires in the same tab immediately after import
  // Refresh whether open or closed — if closed, next open() will re-read store anyway,
  // but if open we update the list live without requiring a close/reopen cycle.
  document.addEventListener('nb-file-imported', () => {
    if (_open) _refresh();
    // Auto-open panel on first import so user sees the file immediately
    else if (Object.keys(_loadStore()).length === 1) _open_();
  });

  // dataset-updated fires on page restore (setDataset called from _restoreInjectData)
  document.addEventListener('dataset-updated', () => { if (_open) _refresh(); });
  document.addEventListener('kernel-restarted', () => { if (_open) _refresh(); });
}
