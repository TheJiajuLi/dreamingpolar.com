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

const ICON_COPY  = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
const ICON_CHECK = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

const CELLS_KEY    = 'dreaming-polar-cells';
const OLD_CODE_KEY = 'dreaming-polar-code';

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
  const cell = { id, lang, editor: null, counter: null, numEl: null, el: null };

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

  toolbar.append(numEl, sel, runBtn, upBtn, downBtn, delBtn, copyBtn);

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
  const outputClose = document.createElement('button');
  outputClose.className = 'nb-output-section-close';
  outputClose.title = 'Hide output';
  outputClose.textContent = '✕';
  outputClose.addEventListener('click', () => { outputSection.style.display = 'none'; });
  outputLabel.append(outputLabelText, outputClose);

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

  attachCellHooks({
    sel, editor, runBtn, upBtn, downBtn, delBtn, copyBtn,
    cell, PLACEHOLDER, ICON_COPY, ICON_CHECK,
    autoResize, saveAll, rebuildCells, cellLabel,
    getCells, setCells, getRunSeq, bumpRunSeq,
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

// ── Run All ───────────────────────────────────────────────

async function runAll(btn) {
  if (btn) btn.disabled = true;

  document.dispatchEvent(new CustomEvent('notebook-clear-output'));

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

    const outputs = await compile(code, cell.lang);

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

  const statusBar = document.createElement('div');
  statusBar.className = 'compiler-status-bar';
  statusBar.textContent = 'Idle — Python loads on first run.';
  nb.appendChild(statusBar);

  attachNotebookHooks({ runAllBtn, statusBar, runAll, getCells, autoResize, saveAll });

  // When AI generates code while the Customise tab is active, the notebook
  // owns this event — no other component needs to know about it.
  document.addEventListener('ai-insert-and-run', ({ detail: { code, lang, cellId } }) => {
    if (getCurrentMode() !== 'customise') return;
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
