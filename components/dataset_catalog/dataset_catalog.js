// ── Data Catalog Modal ────────────────────────────────────────────────────────
// Triggered by clicking the bottom-bar summary ("X datasets · Y rows · Z cols").
// Lists all imported datasets; clicking a row fires ds-schema-request to reuse
// the existing Schema View in the Output panel — no duplicate implementation.

import { getCellDatasetInfo } from '../customise_code_block/customise_code_block.js';
import { getAllDatasets }      from '../shared/dataset_store.js';

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

// Build a merged dataset list with all info we can find
function _getDatasets() {
  const cellItems  = getCellDatasetInfo();   // Notebook import-button path
  const storeItems = getAllDatasets();        // ARIA Quick Analysis path
  const store      = _loadStore();           // inject-store → fileType lookup

  // filename → fileType
  const typeMap = {};
  Object.values(store).forEach(e => {
    if (e.filename) typeMap[e.filename] = e.fileType ?? 'csv';
    if (e.varName)  typeMap[e.varName]  = e.fileType ?? 'csv';
  });

  // Start with Notebook cells (richest info: varName, rows count, cellId)
  const seen = new Set();   // deduplicate by filename
  const merged = [];

  cellItems.forEach(item => {
    const key = item.filename ?? item.varName;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push({
        varName:  item.varName,
        filename: item.filename ?? item.varName,
        rows:     item.rows,
        columns:  item.columns,
        cellNum:  item.cellNum,
        cellId:   item.cellId,
        fileType: typeMap[item.filename] ?? typeMap[item.varName] ?? 'csv',
      });
    }
  });

  // Add ARIA datasets not already covered by a Notebook cell
  storeItems.forEach(d => {
    const key = d.name;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push({
        varName:  d.name,          // dataset_store uses filename as name
        filename: d.name,
        rows:     Array.isArray(d.rows) ? d.rows.length : (d.rows ?? 0),
        columns:  Array.isArray(d.columns) ? d.columns.length : (d.columns ?? 0),
        cellNum:  null,
        cellId:   null,
        fileType: typeMap[d.name] ?? 'csv',
      });
    }
  });

  return merged;
}

// ── Modal singleton ───────────────────────────────────────────────────────────
let _overlay = null;

function _close() {
  _overlay?.remove();
  _overlay = null;
}

function _open() {
  if (_overlay) { _close(); return; }  // toggle

  const datasets = _getDatasets();

  // ── Overlay ──────────────────────────────────────────────────────────────
  _overlay = document.createElement('div');
  _overlay.className = 'dc-overlay';
  _overlay.addEventListener('click', e => { if (e.target === _overlay) _close(); });

  // ── Modal card ───────────────────────────────────────────────────────────
  const modal = document.createElement('div');
  modal.className = 'dc-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Data Catalog');

  // Header
  const hdr = document.createElement('div');
  hdr.className = 'dc-hdr';

  const title = document.createElement('div');
  title.className = 'dc-title';
  title.innerHTML = `<i class="ti ti-database dc-title-icon"></i>Data Catalog`;

  const closeBtn = document.createElement('button');
  closeBtn.className = 'dc-close-btn';
  closeBtn.innerHTML = `<i class="ti ti-x"></i>`;
  closeBtn.title = 'Close';
  closeBtn.addEventListener('click', _close);

  hdr.append(title, closeBtn);

  // Sub-header: aggregate stats
  const meta = document.createElement('div');
  meta.className = 'dc-meta';
  if (datasets.length) {
    const totalRows = datasets.reduce((s, d) => s + Number(d.rows || 0), 0);
    const totalCols = datasets.reduce((s, d) => s + Number(d.columns || 0), 0);
    meta.textContent = `${datasets.length} dataset${datasets.length === 1 ? '' : 's'} · ${totalRows.toLocaleString()} rows · ${totalCols} cols`;
  }

  // Body
  const body = document.createElement('div');
  body.className = 'dc-body';

  if (!datasets.length) {
    const empty = document.createElement('div');
    empty.className = 'dc-empty';
    empty.innerHTML =
      `<i class="ti ti-inbox dc-empty-icon"></i>` +
      `<div class="dc-empty-text">还没有导入任何数据集</div>` +
      `<div class="dc-empty-hint">点击 cell 工具栏的导入按钮开始</div>`;
    body.appendChild(empty);
  } else {
    datasets.forEach(ds => {
      const row = document.createElement('div');
      row.className = 'dc-row';
      row.title = `点击查看 ${ds.varName} 的 Schema`;

      const icon = document.createElement('i');
      icon.className = `ti ${TYPE_ICON[ds.fileType] ?? 'ti-file'} dc-row-icon`;

      const info = document.createElement('div');
      info.className = 'dc-row-info';

      const name = document.createElement('div');
      name.className = 'dc-row-name';
      name.textContent = ds.filename;

      const detail = document.createElement('div');
      detail.className = 'dc-row-detail';
      detail.textContent =
        `${ds.varName}  ·  ${Number(ds.rows || 0).toLocaleString()} 行 × ${ds.columns} 列` +
        (ds.cellNum ? `  ·  Cell ${ds.cellNum}` : '');

      info.append(name, detail);

      const arrow = document.createElement('i');
      arrow.className = 'ti ti-chevron-right dc-row-arrow';

      row.append(icon, info, arrow);

      row.addEventListener('click', () => {
        _close();
        // Fire ds-schema-request — reuses the existing Schema View in the Output panel
        document.dispatchEvent(new CustomEvent('ds-schema-request', {
          detail: {
            varName:   ds.varName,
            cellId:    ds.cellId ?? ds.varName,
            cellLabel: `Cell ${ds.cellNum ?? 1} · python`,
          },
        }));
      });

      body.appendChild(row);
    });
  }

  modal.append(hdr, meta, body);
  _overlay.appendChild(modal);
  document.body.appendChild(_overlay);

  // Focus trap: Escape closes
  const _onKey = e => { if (e.key === 'Escape') { _close(); document.removeEventListener('keydown', _onKey); } };
  document.addEventListener('keydown', _onKey);
}

// ── Init: wire up the bottom-bar summary click ────────────────────────────────
export function initDataCatalog() {
  // The summary element may not exist yet — use event delegation on body
  document.body.addEventListener('click', e => {
    if (e.target.closest('.bdb-df-summary')) _open();
  });

  // Also respond to custom event for programmatic opening
  document.addEventListener('open-data-catalog', _open);
}
