import { compile } from '../compiler/compiler.js';
import { attachCellHooks, attachAddBtnHook, attachNotebookHooks } from './customise_code_block_hooks.js';
import { isEnabled as icmEnabled, onChange as icmOnChange, mount as mountICM } from '../screens/coding_screen/intelligent_coding_mode/intelligent_coding_mode.js';
import { create as createSyntaxHL } from '../screens/coding_screen/coding_screen_python/python_syntax_highlight/python_syntax_highlight.js';
import { create as createTextHL }   from '../screens/coding_screen/coding_screen_python/python_text_highlight/python_text_highlight.js';
import { create as createCompletion } from '../screens/coding_screen/coding_screen_python/python_code-completion/python_code_completion.js';
import { getCurrentMode } from '../compiler/compiler_mode_switcher/compiler_mode_switcher.js';
import { renderBlocks, parseAIResponse } from '../screens/compiling_screen/compiling_screen_utility.js';
import { ask, systemExplainForLang } from '../ai/ai_client.js';
import { createRefactorBtn } from '../screens/compiling_screen/refactorization_button/refactorization_button.js';
import { createSourceWidget } from '../look_up_source/look_up_source.js';
import { createImportBtn } from '../import/import_btn.js';
import { createLoadDataBtn } from '../import/import_data.js';
import { setDataset } from '../shared/dataset_store.js';
import { injectDataFrame, queryKernelDataframes } from '../compiler/compiler.js';

const ICON_COPY  = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
const ICON_CHECK = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

const CELLS_KEY      = 'dreaming-polar-cells';
const OLD_CODE_KEY   = 'dreaming-polar-code';
const INJECT_KEY     = 'dreaming-polar-inject-store'; // persists pending inject data across page loads

// ── Inject-store helpers ──────────────────────────────────
// Stores { [cellId]: { varName, fileType, filename, rows, columns, data, isBase64 } }
// Binary (xlsx) is base64-encoded so it survives JSON.stringify.

function _serializeData(data) {
  if (data instanceof Uint8Array) {
    let bin = '';
    for (let i = 0; i < data.length; i++) bin += String.fromCharCode(data[i]);
    return { s: btoa(bin), isBase64: true };
  }
  return { s: data, isBase64: false };
}

function _deserializeData({ s, isBase64 }) {
  if (!isBase64) return s;
  const bin = atob(s);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function _loadInjectStore() {
  try { return JSON.parse(localStorage.getItem(INJECT_KEY) ?? '{}'); } catch { return {}; }
}

function _saveInjectStore() {
  const store = {};
  _cells.forEach(c => {
    if (c._pendingInject && c._datasetInfo) {
      try {
        const { s, isBase64 } = _serializeData(c._pendingInject.data);
        store[c.id] = {
          varName:     c._pendingInject.varName,
          fileType:    c._pendingInject.fileType,
          filename:    c._datasetInfo.filename,
          rows:        c._datasetInfo.rows,
          columns:     c._datasetInfo.columns,
          columnNames: c._datasetInfo.columnNames ?? [],
          data:        s,
          isBase64,
        };
      } catch (_) { /* individual cell failure: skip, don't block others */ }
    }
  });
  try {
    localStorage.setItem(INJECT_KEY, JSON.stringify(store));
  } catch (e) {
    // Quota exceeded — warn but don't crash (data just won't persist)
    console.warn('[inject-store] localStorage quota exceeded; import data will not survive refresh:', e.message);
  }
}

function _removeFromInjectStore(cellId) {
  const store = _loadInjectStore();
  if (cellId in store) {
    delete store[cellId];
    try { localStorage.setItem(INJECT_KEY, JSON.stringify(store)); } catch (_) {}
  }
}

/**
 * Restores _pendingInject + _datasetInfo (and optionally dsLabel) from the
 * inject store.  Pass showLabels=false when called from kernel restart so
 * that the badge is hidden until data is re-injected on next Run.
 */
function _restoreInjectData(showLabels = true, restoreDatasets = true) {
  const store = _loadInjectStore();
  _cells.forEach(c => {
    const saved = store[c.id];
    if (!saved) return;
    try {
      const data = _deserializeData({ s: saved.data, isBase64: saved.isBase64 });
      const columnNames = saved.columnNames ?? [];
      c._pendingInject = { varName: saved.varName, data, fileType: saved.fileType };
      c._datasetInfo   = {
        varName: saved.varName, rows: saved.rows,
        columns: saved.columns, filename: saved.filename, columnNames,
      };
      if (c.dsLabel && showLabels) {
        c.dsLabel.textContent  = `${saved.varName} · ${Number(saved.rows).toLocaleString()} rows`;
        c.dsLabel.style.display = '';
      }
      // Restore dataset to dataset_store so ARIA tabs appear immediately on load.
      // Skip on kernel restart (restoreDatasets=false) — kernel has no data yet.
      if (saved.filename && restoreDatasets) {
        try {
          setDataset({
            name:    saved.filename,
            columns: columnNames,
            dtypes:  {},
            rows:    [], // metadata only — actual data in Python kernel after first Run
          });
        } catch (_) {}
      }
    } catch (e) {
      console.warn(`[inject-store] failed to restore cell ${c.id}:`, e.message);
    }
  });
}

/** Returns the set of varNames that are persisted (used to seed _usedVarNames in coding_screen). */
export function getPersistedVarNames() {
  const store = _loadInjectStore();
  return new Set(Object.values(store).map(v => v.varName));
}

const LANGS = [
  { id: 'python',   label: 'Python'   },
  { id: 'latex',    label: 'LaTeX'    },
  { id: 'mathjax',  label: 'MathJax'  },
  { id: 'markdown', label: 'Markdown' },
];

const PLACEHOLDER = {
  python:
`# Python code here
# Ctrl/Cmd+Enter to run`,
  latex:
`\\documentclass{article}
\\begin{document}

\\end{document}`,
  mathjax:
`Mixed text and math: \\(E = mc^2\\)

$$\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}$$`,
  markdown:
`## Heading

Some **bold** and *italic* text.

- Item 1
- Item 2`,
};

let _cells     = [];
let _runSeq    = 0;
let _saveTimer = null;
let _cellsEl   = null;

// ── Per-cell CSV import — set by coding_screen.js ────────
let _varNameResolver = null; // (filename) => string
let _onDataImported  = null; // (varName, rows, filename, cellId, cellNum) => void

// ── State accessors passed into hooks ─────────────────────
const getCells   = ()    => _cells;
const setCells   = arr   => { _cells = arr; };
const getRunSeq  = ()    => _runSeq;
const bumpRunSeq = ()    => { _runSeq++; };

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function saveAll() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    const data = _cells.map(c => ({ id: c.id, lang: c.lang, code: c.editor.value }));
    try { localStorage.setItem(CELLS_KEY, JSON.stringify(data)); } catch (_) {}
  }, 400);
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.max(el.scrollHeight, 88) + 'px';
}

function cellLabel(cell) {
  return `Cell ${_cells.indexOf(cell) + 1} · ${cell.lang}`;
}

// ── Cell factory ──────────────────────────────────────────

function makeCell(lang = 'python', code = '', id = uid()) {
  const cell = { id, lang, editor: null, counter: null, numEl: null, el: null, dsLabel: null, _datasetInfo: null };

  const el = document.createElement('div');
  el.className = 'nb-cell';
  el.dataset.nbId = id;

  const gutter = document.createElement('div');
  gutter.className = 'nb-gutter';
  const counter = document.createElement('span');
  counter.className = 'nb-counter';
  counter.textContent = ' ';
  gutter.appendChild(counter);
  cell.counter = counter;

  const body = document.createElement('div');
  body.className = 'nb-body';

  const toolbar = document.createElement('div');
  toolbar.className = 'nb-toolbar';

  const sel = document.createElement('select');
  sel.className = 'nb-lang-select';
  for (const l of LANGS) {
    const o = document.createElement('option');
    o.value = l.id;
    o.textContent = l.label;
    if (l.id === lang) o.selected = true;
    sel.appendChild(o);
  }

  const mkBtn = (cls, title, html) => {
    const b = document.createElement('button');
    b.className = `nb-btn ${cls}`;
    b.title = title;
    b.innerHTML = html;
    return b;
  };
  const runBtn  = mkBtn('nb-run',  'Run cell (Ctrl+Enter)', '&#9654;');
  const upBtn   = mkBtn('nb-move', 'Move cell up',           '↑');
  const downBtn = mkBtn('nb-move', 'Move cell down',         '↓');
  const delBtn  = mkBtn('nb-del',  'Delete cell',            '✕');

  const copyBtn = document.createElement('button');
  copyBtn.className = 'nb-btn lus-copy-btn';
  copyBtn.title = 'Copy code';
  copyBtn.innerHTML = ICON_COPY;

  const numEl = document.createElement('span');
  numEl.className = 'nb-cell-num';
  numEl.textContent = '1';
  cell.numEl = numEl;

  const importBtn = createImportBtn({
    getMode: () => 'customise',
    onNotebookImport: (content) => {
      editor.value = content;
      editor.dispatchEvent(new Event('input'));
    },
  });
  importBtn.title = 'Import file into this cell';
  importBtn.className = 'nb-btn';

  // ── Per-cell CSV→DataFrame import button ─────────────────
  const dsLabel = document.createElement('span');
  dsLabel.className    = 'nb-ds-label';
  dsLabel.style.display = 'none';
  cell.dsLabel = dsLabel;

  const csvBtn = createLoadDataBtn({
    resolveVarName: (filename) => {
      // Re-import to the same cell: reuse the existing variable name so the
      // cell's code stays consistent and the new data simply overwrites the old.
      if (cell._datasetInfo?.varName) return cell._datasetInfo.varName;
      return _varNameResolver ? _varNameResolver(filename) : 'df';
    },
    lazyMode: true,
    onLoad: (varName, rows, filename, injectData, fileType, columns, columnNames = []) => {
      const cellNum = _cells.indexOf(cell) + 1;
      const code =
        `# "${filename}" → ${varName} (${rows.toLocaleString()} rows, ${columns} cols)\n` +
        `print(${varName}.shape)\n${varName}.head()`;
      cell.editor.value = code;
      autoResize(cell.editor);
      cell.editor.dispatchEvent(new Event('input'));
      saveAll();
      cell._pendingInject  = { varName, data: injectData, fileType };
      cell._datasetInfo    = { varName, rows, columns, filename, columnNames };
      dsLabel.textContent  = `${varName} · ${rows.toLocaleString()} rows`;
      dsLabel.style.display = '';
      _onDataImported?.(varName, rows, filename, cell.id, cellNum);
      _saveInjectStore(); // persist so data survives page refresh
      // No auto-run: Pyodide only boots when the user clicks ▶
    },
  });
  csvBtn.className = 'nb-btn nb-csv-btn';
  csvBtn.title     = 'Load CSV / Excel as DataFrame into this cell';

  toolbar.append(numEl, sel, runBtn, upBtn, downBtn, delBtn, copyBtn, csvBtn, dsLabel, importBtn);

  const editor = document.createElement('textarea');
  editor.className    = 'nb-editor';
  editor.spellcheck   = false;
  editor.autocorrect  = 'off';
  editor.autocomplete = 'off';
  editor.placeholder  = PLACEHOLDER[lang] ?? '';
  editor.value        = code;
  cell.editor = editor;

  body.append(editor);
  const lowerRow = document.createElement('div');
  lowerRow.className = 'nb-cell-lower';
  lowerRow.append(gutter, body);

  const outputSection = document.createElement('div');
  outputSection.className = 'nb-output-section';
  outputSection.style.display = 'none';

  const outputLabel = document.createElement('div');
  outputLabel.className = 'nb-output-section-label';
  const outputLabelText = document.createElement('span');
  outputLabelText.className = 'nb-output-section-label-text';
  outputLabelText.textContent = 'Output';

  const cellSourceWidget = createSourceWidget();

  const outputCopyBtn = document.createElement('button');
  outputCopyBtn.className = 'nb-btn lus-copy-btn nb-output-copy-btn';
  outputCopyBtn.title = 'Copy output';
  outputCopyBtn.innerHTML = ICON_COPY;
  outputCopyBtn.addEventListener('click', () => {
    const text = outputBody.innerText ?? outputBody.textContent ?? '';
    navigator.clipboard?.writeText(text).then(() => {
      outputCopyBtn.innerHTML = ICON_CHECK;
      outputCopyBtn.classList.add('lus-copy-btn--done');
      setTimeout(() => {
        outputCopyBtn.innerHTML = ICON_COPY;
        outputCopyBtn.classList.remove('lus-copy-btn--done');
      }, 1500);
    });
  });

  const outputClose = document.createElement('button');
  outputClose.className = 'nb-output-section-close';
  outputClose.title = 'Hide output';
  outputClose.textContent = '✕';
  outputClose.addEventListener('click', () => { outputSection.style.display = 'none'; });
  outputLabel.append(outputLabelText, cellSourceWidget.element, outputCopyBtn, outputClose);

  const outputBody = document.createElement('div');
  outputBody.className = 'nb-output-section-body';
  outputSection.append(outputLabel, outputBody);

  el.append(toolbar, lowerRow, outputSection);
  cell.el = el;

  const outputAC = new AbortController();
  cell._outputAC = outputAC;

  document.addEventListener('compile-result', ({ detail }) => {
    if (detail.cellId !== id) return;
    const { outputs, sourceCode, sourceLang } = detail;
    cellSourceWidget.setSource(sourceCode ?? null, sourceLang ?? null);
    outputBody.innerHTML = '';
    renderBlocks(outputs, outputBody, {
      onAskAI: async (errorText, block, btn) => {
        btn.disabled = true;
        btn.textContent = 'Thinking…';
        try {
          const context = sourceCode
            ? `Code (${sourceLang ?? 'unknown'}):\n${sourceCode}\n\nError:\n${errorText}`
            : errorText;
          const explanation = await ask(context, systemExplainForLang(sourceLang), 512);
          const explDiv = document.createElement('div');
          explDiv.className = 'output-ai-explanation';
          const lbl = document.createElement('div');
          lbl.className = 'ai-explanation-label';
          const lblText = document.createElement('span');
          lblText.className = 'ai-explanation-label-text';
          lblText.textContent = 'AI suggestion';
          lbl.appendChild(lblText);
          if (sourceCode) {
            lbl.appendChild(createRefactorBtn({ sourceCode, sourceLang, cellId: id, explanation }));
          }
          const bodyEl = document.createElement('div');
          bodyEl.className = 'ai-explanation-body';
          renderBlocks(parseAIResponse(explanation), bodyEl);
          explDiv.append(lbl, bodyEl);
          block.appendChild(explDiv);
          btn.remove();
        } catch (e) {
          btn.textContent = `Error: ${e.message}`;
          btn.disabled = false;
        }
      },
    });
    outputSection.style.display = '';
  }, { signal: outputAC.signal });

  document.addEventListener('notebook-clear-output', () => {
    outputSection.style.display = 'none';
    outputBody.innerHTML = '';
  }, { signal: outputAC.signal });

  // After a package is installed, auto re-run this cell if it was the one that triggered it.
  document.addEventListener('package-installed', ({ detail }) => {
    if (detail?.cellId !== id) return;
    cell.el.querySelector('.nb-run')?.click();
  }, { signal: outputAC.signal });

  attachCellHooks({
    sel, editor, runBtn, upBtn, downBtn, delBtn, copyBtn,
    cell, PLACEHOLDER, ICON_COPY, ICON_CHECK,
    autoResize, saveAll, rebuildCells, cellLabel,
    getCells, setCells, getRunSeq, bumpRunSeq,
    flushPendingInjects: _flushPendingInjects,
  });

  // ── Per-cell ICM instances ────────────────────────────
  cell._icm = { hl: createSyntaxHL(), th: createTextHL(), cc: createCompletion() };

  function _icmSyncCell() {
    if (cell.lang === 'python' && icmEnabled()) {
      if (!cell._icm.hl.isActive()) {
        cell._icm.hl.init(editor, body);
        cell._icm.th.init(editor, body);
        cell._icm.cc.init(editor, body);
      }
    } else {
      cell._icm.hl.destroy();
      cell._icm.th.destroy();
      cell._icm.cc.destroy();
    }
  }

  cell._icmSync = _icmSyncCell;

  // re-evaluate when language changes
  sel.addEventListener('change', _icmSyncCell);

  return cell;
}

// ── DOM rebuild ───────────────────────────────────────────

function makeAddBtn(insertIdx) {
  const row = document.createElement('div');
  row.className = 'nb-add-row';
  const lineL = document.createElement('span');
  lineL.className = 'nb-add-line';
  const btn = document.createElement('button');
  btn.className = 'nb-add-btn';
  btn.title = 'Add cell';
  btn.textContent = '+';
  const lineR = document.createElement('span');
  lineR.className = 'nb-add-line';
  row.append(lineL, btn, lineR);

  attachAddBtnHook({ btn, insertIdx, makeCell, getCells, rebuildCells, saveAll });

  return row;
}

let _updateCellCount = () => {};

function rebuildCells() {
  if (!_cellsEl) return;
  _cellsEl.innerHTML = '';
  _cells.forEach((cell, i) => {
    cell.numEl.textContent = i + 1;
    cell.counter.textContent = ' ';
    _cellsEl.appendChild(cell.el);
    requestAnimationFrame(() => { autoResize(cell.editor); cell._icmSync?.(); });
    _cellsEl.appendChild(makeAddBtn(i + 1));
  });
  _updateCellCount();
  document.dispatchEvent(new CustomEvent('notebook-cells-reordered', {
    detail: { order: _cells.map(c => c.id) }
  }));
}

// ── Pending DataFrame inject flush ────────────────────────
// Injects all CSV data that has been parsed but not yet sent to the kernel.
// Called before any Python cell runs so data is available for both cell code
// and AI-generated code that references imported variables.

async function _flushPendingInjects() {
  for (const c of _cells) {
    if (c._pendingInject) {
      const { varName, data, fileType } = c._pendingInject;
      const fileName = c._datasetInfo?.filename ?? '';
      const cellIndex = (_cells.indexOf(c) + 1) || undefined;
      const result = await injectDataFrame(varName, data, fileType, fileName, { cellIndex });
      c._pendingInject = null;
      // Update dsLabel with the actual row count returned from Python
      // (metadata from _parseToDataset can be wrong for JSON/XML files).
      if (c.dsLabel && result?.rows != null) {
        c.dsLabel.textContent  = `${varName} · ${Number(result.rows).toLocaleString()} rows`;
        c.dsLabel.style.display = '';
      }
    }
  }
}

// ── Run All ───────────────────────────────────────────────

async function runAll(btn) {
  if (btn) btn.disabled = true;

  document.dispatchEvent(new CustomEvent('notebook-clear-output'));

  // Save per-cell inject info before flush clears _pendingInject.
  const _cellInjectDs = new Map();
  _cells.forEach(c => {
    if (c._pendingInject && c._datasetInfo) _cellInjectDs.set(c.id, { ...c._datasetInfo });
  });

  // Inject any pending DataFrames before any cell runs so every cell can
  // reference every imported variable, including AI-generated cells.
  await _flushPendingInjects();

  for (let i = 0; i < _cells.length; i++) {
    const cell = _cells[i];
    const code = cell.editor.value.trim();
    if (!code) continue;

    if (cell.lang === 'python' && /\binput\s*\(/.test(code)) {
      document.dispatchEvent(new CustomEvent('run-in-terminal', { detail: { code } }));
      continue;
    }

    cell.counter.textContent = '*';
    const cellRunBtn = cell.el.querySelector('.nb-run');
    if (cellRunBtn) cellRunBtn.disabled = true;

    const outputs = await compile(code, cell.lang, { cellIndex: i + 1 });

    // Ensure import-button cells get a viz-suggestion (RUNNER diff misses these)
    const _ownDs = _cellInjectDs.get(cell.id);
    if (_ownDs?.varName && cell.lang === 'python') {
      const { varName, rows, columns } = _ownDs;
      if (!outputs.some(o => o.type === 'viz-suggestion' && o.varName === varName)) {
        outputs.push({
          type: 'viz-suggestion', varName, kind: 'dataframe',
          shape: `${Number(rows).toLocaleString()}行×${Number(columns)}列`,
        });
      }
    }
    if (cell.lang === 'python') {
      queryKernelDataframes().then(dfs => {
        if (Object.keys(dfs).length)
          document.dispatchEvent(new CustomEvent('kernel-dfs-updated', { detail: { dfs } }));
      }).catch(() => {});
    }

    if (cellRunBtn) cellRunBtn.disabled = false;
    _runSeq++;
    cell.counter.textContent = _runSeq;

    document.dispatchEvent(new CustomEvent('compile-result', {
      detail: { outputs, cellId: cell.id, cellLabel: `Cell ${i + 1} · ${cell.lang}`, sourceCode: code, sourceLang: cell.lang }
    }));
  }

  if (btn) btn.disabled = false;
}

// ── Public init ───────────────────────────────────────────

export function init(container, externalTopbar) {
  let savedData = null;
  try { savedData = JSON.parse(localStorage.getItem(CELLS_KEY)); } catch (_) {}

  if (!Array.isArray(savedData) || !savedData.length) {
    const legacyCode = localStorage.getItem(OLD_CODE_KEY) ?? '';
    savedData = [{ id: uid(), lang: 'python', code: legacyCode }];
  }

  _cells  = savedData.map(d => makeCell(d.lang ?? 'python', d.code ?? '', d.id ?? uid()));
  _runSeq = 0;

  // Restore persisted inject data (survive page refresh)
  _restoreInjectData();

  // Clean up inject store when a cell is deleted
  document.addEventListener('notebook-cell-deleted', ({ detail: { cellId } }) => {
    _removeFromInjectStore(cellId);
  });

  const nb = document.createElement('div');
  nb.className = 'notebook-editor-area';

  const runAllBtn = document.createElement('button');
  runAllBtn.className = 'nb-run-all-btn';
  runAllBtn.innerHTML = '&#9654;&#9654;&nbsp;Run All';
  runAllBtn.title = 'Run all cells in order';

  const cellCount = document.createElement('span');
  cellCount.className = 'nb-cell-count';

  _updateCellCount = () => {
    cellCount.textContent = `${_cells.length} cell${_cells.length === 1 ? '' : 's'}`;
  };

  const icmSlot = document.createElement('div');
  icmSlot.className = 'cds-icm-slot';
  mountICM(icmSlot);

  if (externalTopbar) {
    externalTopbar.appendChild(icmSlot);
    externalTopbar.appendChild(runAllBtn);
    externalTopbar.appendChild(cellCount);
  } else {
    const topbar = document.createElement('div');
    topbar.className = 'nb-topbar';
    topbar.appendChild(icmSlot);
    topbar.appendChild(runAllBtn);
    topbar.appendChild(cellCount);
    nb.appendChild(topbar);
  }

  // Sync all cells when ICM is toggled
  icmOnChange(() => _cells.forEach(c => c._icmSync?.()));

  const cellsEl = document.createElement('div');
  cellsEl.className = 'nb-cells';
  _cellsEl = cellsEl;
  nb.appendChild(cellsEl);

  rebuildCells();
  // initial ICM activation after DOM is mounted
  requestAnimationFrame(() => _cells.forEach(c => c._icmSync?.()));

  // On mobile the coding screen starts as display:none, so scrollHeight=0
  // during rebuildCells and cells stay at min-height. Re-run autoResize
  // whenever the container width changes (hidden→visible, or viewport resize).
  let _cellsWidth = 0;
  new ResizeObserver(() => {
    const w = cellsEl.offsetWidth;
    if (w !== _cellsWidth) {
      _cellsWidth = w;
      requestAnimationFrame(() => _cells.forEach(c => autoResize(c.editor)));
    }
  }).observe(cellsEl);

  attachNotebookHooks({ runAllBtn, runAll, getCells, autoResize, saveAll });

  // When AI generates code while the Customise tab is active, the notebook
  // owns this event — no other component needs to know about it.
  document.addEventListener('ai-insert-and-run', async ({ detail: { code, lang, cellId } }) => {
    const st = window.screenController?.getState('coding');
    if (st !== 'normal' && st !== 'maximized') return;
    // Flush any pending DataFrame injections so AI-generated code that
    // references imported variables can find them in the kernel.
    await _flushPendingInjects();
    if (cellId) {
      // Update existing cell and re-run it
      const cell = _cells.find(c => c.id === cellId);
      if (cell) {
        cell.editor.value = code;
        autoResize(cell.editor);
        cell.editor.dispatchEvent(new Event('input'));
        saveAll();
        cell.el.querySelector('.nb-run')?.click();
      }
      return;
    }
    addImportedCell(lang ?? 'python', code, { autoRun: true });
  });

  document.addEventListener('refactor-code', ({ detail: { code, cellId } }) => {
    setCellCode(cellId, code);
  });

  container.appendChild(nb);

}

export function getCellOrder() {
  return _cells.map(c => c.id);
}

export function setVarNameResolver(fn) { _varNameResolver = fn; }
export function setOnDataImported(fn)  { _onDataImported  = fn; }

/** Returns metadata for every cell that has imported a CSV in this session. */
export function getCellDatasetInfo() {
  return _cells
    .filter(c => c._datasetInfo)
    .map(c => ({
      varName:  c._datasetInfo.varName,
      rows:     c._datasetInfo.rows,
      columns:  c._datasetInfo.columns,
      filename: c._datasetInfo.filename,
      cellNum:  _cells.indexOf(c) + 1,
      cellId:   c.id,
    }));
}

export function clearAllDatasetLabels() {
  _cells.forEach(c => {
    if (c.dsLabel) {
      c.dsLabel.textContent  = '';
      c.dsLabel.style.display = 'none';
    }
    c._datasetInfo = null;
    // Re-arm _pendingInject from the persisted store so the next Run
    // re-injects data automatically after a kernel restart.
    c._pendingInject = null;
  });
  // Re-arm _pendingInject but keep labels hidden and skip dataset_store restore:
  // kernel has no data until the user Runs a cell again.
  _restoreInjectData(false, false);
}

export function setCellCode(cellId, code) {
  const cell = _cells.find(c => c.id === cellId);
  if (!cell) return false;
  cell.editor.value = code;
  autoResize(cell.editor);
  cell.editor.dispatchEvent(new Event('input'));
  saveAll();
  return true;
}

export function addImportedCell(lang, code, { autoRun = false } = {}) {
  if (!_cellsEl) return;
  const cell = makeCell(lang, code, uid());
  _cells.push(cell);

  // Append without full rebuild to avoid touching existing cells
  const insertBeforeEl = _cellsEl.lastElementChild; // last add-row
  _cellsEl.insertBefore(cell.el, insertBeforeEl);
  _cellsEl.appendChild(makeAddBtn(_cells.length));
  cell.numEl.textContent = _cells.length;
  _updateCellCount();
  saveAll();

  // Let the browser lay out the tall content before ICM overlays itself
  requestAnimationFrame(() => {
    autoResize(cell.editor);
    requestAnimationFrame(() => {
      cell._icmSync?.();
      cell.el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      if (autoRun) cell.el.querySelector('.nb-run')?.click();
    });
  });
}
