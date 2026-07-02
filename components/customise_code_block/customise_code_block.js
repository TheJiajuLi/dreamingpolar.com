import { compile, queryKernelContext } from '../compiler/compiler.js';
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
import { getSettings } from '../right_bar/settings.js';
import { createLoadDataBtn } from '../import/import_data.js';
import { attachGhostText }  from './nb_ghost.js';
import { scheduleSave as _cloudScheduleSave, syncToCloud as _cloudSync } from '../shared/notebook_sync.js';
import { setDataset } from '../shared/dataset_store.js';
import { injectDataFrame, queryKernelDataframes, writeCodeFileToFS } from '../compiler/compiler.js';

const ICON_COPY  = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
const ICON_CHECK = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

const CELLS_KEY      = 'dreaming-polar-cells';
const OLD_CODE_KEY   = 'dreaming-polar-code';
const INJECT_KEY     = 'dreaming-polar-inject-store'; // persists pending inject data across page loads
const CODE_FILE_KEY  = 'dp-code-file-store';

const LANG_EXT = { python: '.py', markdown: '.md', latex: '.tex', mathjax: '.html' };

function _normalizeLang(lang) {
  if (!lang) return 'python';
  const map = {
    latex: 'latex',
    LaTeX: 'latex',
    LATEX: 'latex',
    markdown: 'markdown',
    Markdown: 'markdown',
    md: 'markdown',
    mathjax: 'mathjax',
    MathJax: 'mathjax',
    html: 'html',
    HTML: 'html',
    python: 'python',
    Python: 'python',
  };
  return map[lang] ?? String(lang).toLowerCase();
}

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
  // Merge-save: start from existing store so file-manager entries (keyed by
  // "fm_*") and any cell entries whose _pendingInject is temporarily null
  // (e.g. during kernel reset) are NOT wiped out by an intermediate saveAll().
  let store;
  try { store = JSON.parse(localStorage.getItem(INJECT_KEY) ?? '{}'); }
  catch { store = {}; }

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
    // If _pendingInject is null (kernel reset in progress), leave existing
    // store[c.id] untouched — it will be re-armed by _restoreInjectData().
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

// ── Shared code-generation helper ─────────────────────────────────────────────
// Used by csvBtn.onLoad, _restoreInjectData (empty-editor fill), and the
// runBtn auto-fill path.  Kept here to avoid circular imports with hooks.js.
const _DATE_COL_RE = /^(date|time|datetime|timestamp|dt|日期|时间|当日|yearmonth|month|year|week)$/i;

function _buildImportCellCode(varName, rows, filename, columns, columnNames, fileType) {
  const dateCol = (columnNames ?? []).find(c => _DATE_COL_RE.test(c.trim()));
  if (dateCol && columns >= 2 && fileType === 'csv') {
    return (
      `# "${filename}" → ${varName} (${Number(rows).toLocaleString()} rows, ${columns} cols)\n` +
      `import pandas as pd\n` +
      `import matplotlib.pyplot as plt\n` +   // explicit import so loadPackagesFromImports loads matplotlib
      `${varName}["${dateCol}"] = pd.to_datetime(${varName}["${dateCol}"])\n` +
      `${varName} = ${varName}.set_index("${dateCol}")\n` +
      `print(${varName}.shape)\n` +
      `${varName}.select_dtypes(include="number").plot(\n` +
      `    figsize=(12, 5), grid=True, linewidth=1.2,\n` +
      `    title="${varName}"\n` +
      `)\n` +
      `${varName}.head()`
    );
  }
  return (
    `# "${filename}" → ${varName} (${Number(rows).toLocaleString()} rows, ${columns} cols)\n` +
    `print(${varName}.shape)\n${varName}.head()`
  );
}

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
        if (c._dsClearBtn) c._dsClearBtn.style.display = '';
      }
      // If the cell's editor is empty (placeholder visible), regenerate the
      // import code so the user doesn't have to re-import just to get code back.
      if (showLabels && c.editor && !c.editor.value.trim()) {
        c.editor.value = _buildImportCellCode(
          saved.varName, saved.rows, saved.filename,
          saved.columns, columnNames, saved.fileType,
        );
        requestAnimationFrame(() => {
          autoResize(c.editor);
          c.editor.dispatchEvent(new Event('input'));
        });
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
let _lastFocusedCellId = null; // track most recently focused cell for rb-insert-file

// ── FileTracker — persistent filename→cellId registry ────────────────────────
// Single source of truth for which cell "owns" a given file. Used by the
// file manager smart-click to navigate rather than re-insert.
const _FILE_CELL_MAP_KEY = 'dp-file-cell-map';
const FileTracker = {
  _get() {
    try { return JSON.parse(localStorage.getItem(_FILE_CELL_MAP_KEY) ?? '{}'); } catch { return {}; }
  },
  _set(map) {
    try { localStorage.setItem(_FILE_CELL_MAP_KEY, JSON.stringify(map)); } catch {}
  },
  /** Register that `filename` lives in `cellId`. */
  track(filename, cellId) {
    if (!filename || !cellId) return;
    const map = this._get(); map[filename] = cellId; this._set(map);
  },
  /** Remove all entries pointing to `cellId` (called on cell delete). */
  untrackCell(cellId) {
    const map = this._get();
    let changed = false;
    for (const fn of Object.keys(map)) { if (map[fn] === cellId) { delete map[fn]; changed = true; } }
    if (changed) this._set(map);
  },
  /** Remove entry for a specific filename (cell code was cleared). */
  untrackFile(filename) {
    const map = this._get(); delete map[filename]; this._set(map);
  },
  /**
   * Find the live cell that owns `filename`.
   * Returns the cell object or null if stale (deleted or code no longer contains the file).
   * Self-healing: prunes stale entries automatically.
   */
  findCell(filename) {
    if (!filename) return null;
    const map  = this._get();
    const cid  = map[filename];
    if (!cid) return null;
    const cell = _cells.find(c => c.id === cid);
    if (!cell) { this.untrackFile(filename); return null; } // cell deleted
    // Verify cell code still actually references this file (user may have cleared it)
    const v = cell.editor.value;
    if (!v.includes(`"${filename}"`) && !v.includes(`'${filename}'`)) {
      this.untrackFile(filename); return null; // code cleared — allow re-insert
    }
    return cell;
  },
};

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
  return `Cell ${_cells.indexOf(cell) + 1} · ${_normalizeLang(cell.lang)}`;
}

// ── Ctrl+I inline AI completion ───────────────────────────────────────────────
const _INLINE_AI_LANG_PROMPTS = {
  python: 'You are a Python code assistant. Output only Python code.',
  latex: 'You are a LaTeX assistant. Output only LaTeX code.',
  markdown: 'You are a Markdown assistant. Output only Markdown.',
  mathjax: 'You are a MathJax/LaTeX math assistant. Output only math expressions.',
  javascript: 'You are a JavaScript assistant. Output only JS code.',
};

function _getInlineAISystemPrompt(cell) {
  const cellEl = cell?.el ?? null;
  const langSelect = cellEl?.querySelector('.nb-lang-select');
  const currentLang = _normalizeLang(langSelect?.value || 'python');
  return _INLINE_AI_LANG_PROMPTS[currentLang]
    ?? `You are a ${currentLang} code assistant. Output only ${currentLang} code.`;
}

async function* _streamGhostChat(messages, systemPrompt, maxTokens = 500, signal) {
  const res = await fetch('/api/ghost', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages,
      system: systemPrompt,
      max_tokens: maxTokens,
      stream: true,
    }),
    signal,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `Request failed (${res.status})`);
  }

  const reader = res.body?.getReader?.();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (raw === '[DONE]') return;
      try {
        const json = JSON.parse(raw);
        if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta' && json.delta.text) {
          yield json.delta.text;
        }
        const delta = json.choices?.[0]?.delta?.content ?? null;
        if (delta) yield delta;
      } catch (_) {
        // ignore partial JSON lines
      }
    }
  }
}

function _getCursorLine(editor) {
  return editor.value.slice(0, editor.selectionStart).split('\n').length - 1;
}

function _inlineAIPlaceholder(cell) {
  const ds   = cell._datasetInfo;
  const code = cell.editor?.value ?? '';

  if (ds?.columnNames?.length) {
    const cols   = ds.columnNames;
    const varName = ds.varName ?? 'df';
    // Pick a contextual example from column types
    const dateLike = cols.find(c => /date|time|dt|year|month|day/i.test(c));
    const numLike  = cols.find(c => !/id|index|name|code|identifier/i.test(c) && /price|count|score|amount|sales|revenue|value|num|qty|total/i.test(c));
    const catLike  = cols.find(c => /category|type|status|group|label|industry|country|region/i.test(c));

    if (dateLike) return `如: 把 ${dateLike} 列转为 datetime 并设为索引`;
    if (numLike)  return `如: 对 ${varName} 的 ${numLike} 列做归一化处理`;
    if (catLike)  return `如: 统计 ${catLike} 列的值分布`;
    return `如: 对 ${varName} 过滤空值并重置索引`;
  }

  // Fallback: inspect cursor-line code for variable names
  const curLine = (code.split('\n')[_getCursorLine(cell.editor)] ?? '').trim();
  if (/pd\.read_csv|pd\.read_excel/.test(curLine)) return '如: 打印数据形状并预览前5行';
  if (/import/.test(curLine))                       return '如: 读取 CSV 并赋值给 df';
  if (/\.plot|plt\./.test(curLine))                 return '如: 添加标题和坐标轴标签';
  return '描述你想要的代码…';
}

function _openInlineAI(cell, editor) {
  // Prevent duplicate popups on the same cell
  if (cell._inlineAIPopup) {
    cell._inlineAIPopup.querySelector('.nb-inline-ai-input')?.focus();
    return;
  }

  const cursorLine = _getCursorLine(editor);

  // ── Popup mounted inside .mirror-code-pane as flow element ────────────────
  // The cell/pane expand naturally; no fixed positioning needed.
  const codePaneEl = cell.el.querySelector('.mirror-code-pane');
  if (!codePaneEl) return;

  const popup = document.createElement('div');
  popup.className = 'nb-inline-ai';
  cell._inlineAIPopup = popup;

  // ── Close logic ───────────────────────────────────────────────────────────
  function _close() {
    popup.remove();
    cell._inlineAIPopup = null;
    document.removeEventListener('pointerdown', _outsideClick, true);
    // Let autoResize recalculate editor height
    autoResize(editor);
  }
  function _outsideClick(e) { if (!popup.contains(e.target)) _close(); }
  setTimeout(() => document.addEventListener('pointerdown', _outsideClick, true), 0);

  // ── State 1: input row ─────────────────────────────────────────────────────
  const topRow = document.createElement('div');
  topRow.className = 'nb-inline-ai-top';

  const sparkIcon = document.createElement('i');
  sparkIcon.className = 'ti ti-sparkles nb-inline-ai-spark';

  const input = document.createElement('input');
  input.className    = 'nb-inline-ai-input';
  input.type         = 'text';
  input.placeholder  = _inlineAIPlaceholder(cell);
  input.autocomplete = 'off';
  input.spellcheck   = false;

  const sendBtn = document.createElement('button');
  sendBtn.className = 'nb-inline-ai-send';
  sendBtn.title     = '发送 (Enter)';
  sendBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;

  topRow.append(sparkIcon, input, sendBtn);

  const hintBar = document.createElement('div');
  hintBar.className = 'nb-inline-ai-hint';
  hintBar.innerHTML =
    `<kbd>Enter</kbd> 发送 &nbsp;·&nbsp; <kbd>Esc</kbd> 关闭 &nbsp;·&nbsp; <kbd>↑</kbd> 读取当前行注释`;

  popup.append(topRow, hintBar);
  codePaneEl.appendChild(popup);
  autoResize(editor);   // recalc after DOM change
  input.focus();

  // ── ↑ reads comment ───────────────────────────────────────────────────────
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape')  { e.preventDefault(); _close(); return; }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const line    = (editor.value.split('\n')[cursorLine] ?? '').trimStart();
      const comment = line.startsWith('#') ? line.replace(/^#+\s*/, '') : '';
      if (comment) { input.value = comment; input.setSelectionRange(comment.length, comment.length); }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _send(); }
  });
  sendBtn.addEventListener('click', _send);

  // ── State 2 + 3: send → stream → actions ──────────────────────────────────
  let _abort = null;
  let _code  = '';

  async function _send() {
    const instruction = input.value.trim();
    if (!instruction) return;

    // Lock input
    input.readOnly = true;
    sendBtn.remove();

    // Build prompt
    const cellCode = editor.value;
    let   kernelCtx = '';
    try {
      const dfs = await queryKernelContext();
      if (dfs.length) kernelCtx = '\n\nKernel variables:\n' + dfs.map(d =>
        `  ${d.varName}: shape=${d.shape.join('×')}, cols=[${d.columns.join(', ')}]`
      ).join('\n');
    } catch {}

    const userMsg =
      `Cell code:\n\`\`\`python\n${cellCode}\n\`\`\`\n` +
      `Cursor line: ${cursorLine + 1}${kernelCtx}\n\n` +
      `Instruction: ${instruction}`;

    // Stop button in top row
    const stopBtn = document.createElement('button');
    stopBtn.className = 'nb-inline-ai-stop';
    stopBtn.innerHTML = `<i class="ti ti-player-stop-filled"></i> 停止`;
    topRow.appendChild(stopBtn);

    // Preview card
    const previewCard = document.createElement('div');
    previewCard.className = 'nb-inline-ai-preview';
    const previewLabel = document.createElement('div');
    previewLabel.className = 'nb-inline-ai-preview-label';
    previewLabel.textContent = '预览';
    const pre = document.createElement('pre');
    pre.className = 'nb-inline-ai-code';
    previewCard.append(previewLabel, pre);

    hintBar.remove();   // hide hint during generation
    popup.appendChild(previewCard);

    _abort = new AbortController();
    stopBtn.addEventListener('click', () => _abort.abort());

    _code = '';
    try {
      const systemPrompt = _getInlineAISystemPrompt(cell);
      for await (const chunk of _streamGhostChat(
        [{ role: 'user', content: userMsg }],
        systemPrompt,
        500,
        _abort.signal,
      )) {
        if (_abort.signal.aborted) break;
        _code += chunk;
        pre.textContent = _code;
        previewCard.scrollTop = previewCard.scrollHeight;
      }
    } catch (err) {
      if (!_abort.signal.aborted)
        previewLabel.textContent = `错误: ${err.message}`;
    }

    // ── State 3: generation done ──────────────────────────────────────────
    stopBtn.remove();
    previewLabel.className  = 'nb-inline-ai-preview-label nb-inline-ai-preview-label--done';
    previewLabel.textContent = '生成完成';

    const actRow = document.createElement('div');
    actRow.className = 'nb-inline-ai-actions';

    const replBtn = document.createElement('button');
    replBtn.className = 'nb-inline-ai-act nb-inline-ai-act--primary';
    replBtn.innerHTML = `<i class="ti ti-replace"></i> 替换当前行`;

    const insBtn = document.createElement('button');
    insBtn.className = 'nb-inline-ai-act';
    insBtn.innerHTML = `<i class="ti ti-row-insert-bottom"></i> 插入到下方`;

    const discBtn = document.createElement('button');
    discBtn.className = 'nb-inline-ai-act nb-inline-ai-act--muted';
    discBtn.textContent = '取消';

    actRow.append(replBtn, insBtn, discBtn);
    popup.appendChild(actRow);

    function _stripFences(raw) {
      // Strip markdown code fences the model may output despite instructions
      return raw
        .replace(/^```[\w]*\n?/m, '')   // opening fence: ```python or ```
        .replace(/\n?```\s*$/m, '')      // closing fence
        .trim();
    }

    function _apply(mode) {
      const lines    = editor.value.split('\n');
      const genLines = _stripFences(_code).split('\n');
      if (mode === 'replace') lines.splice(cursorLine, 1, ...genLines);
      else                    lines.splice(cursorLine + 1, 0, ...genLines);
      editor.value = lines.join('\n');
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      _close();
    }

    replBtn.addEventListener('click', () => _apply('replace'));
    insBtn.addEventListener('click',  () => _apply('insert'));
    discBtn.addEventListener('click', _close);

    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') _close();
    }, { once: true });
  }
}

// ── Cell factory ──────────────────────────────────────────

function makeCell(lang = 'python', code = '', id = uid()) {
  lang = _normalizeLang(lang);
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
  dsLabel.title = '点击查看 schema';
  dsLabel.style.cursor = 'pointer';
  dsLabel.addEventListener('click', () => {
    const varName = cell._datasetInfo?.varName;
    if (!varName) return;
    document.dispatchEvent(new CustomEvent('ds-schema-request', {
      detail: { varName, cellId: id, cellLabel: `Cell ${_cells.indexOf(cell) + 1} · python` },
    }));
  });
  cell.dsLabel = dsLabel;

  // × button clears stale inject data from this cell without affecting others
  const dsClearBtn = document.createElement('button');
  dsClearBtn.className = 'nb-btn nb-ds-clear-btn';
  dsClearBtn.title = 'Clear imported dataset from this cell';
  dsClearBtn.textContent = '×';
  dsClearBtn.style.display = 'none';
  cell._dsClearBtn = dsClearBtn;
  dsClearBtn.addEventListener('click', () => {
    cell._pendingInject = null;
    cell._datasetInfo   = null;
    dsLabel.textContent  = '';
    dsLabel.style.display = 'none';
    dsClearBtn.style.display = 'none';
    _removeFromInjectStore(cell.id);
    document.dispatchEvent(new CustomEvent('nb-file-imported')); // refresh file manager
  });

  const csvBtn = createLoadDataBtn({
    resolveVarName: (filename) => {
      // Same file re-imported to the same cell → reuse the variable name so
      // the cell's code stays consistent and data is simply overwritten.
      // Different file → allocate a fresh name so the label correctly reflects
      // what the variable actually contains.
      if (cell._datasetInfo?.varName && cell._datasetInfo?.filename === filename) {
        return cell._datasetInfo.varName;
      }
      return _varNameResolver ? _varNameResolver(filename) : 'df';
    },
    lazyMode: true,
    onLoad: (varName, rows, filename, injectData, fileType, columns, columnNames = []) => {
      const cellNum = _cells.indexOf(cell) + 1;

      const code = _buildImportCellCode(varName, rows, filename, columns, columnNames, fileType);
      cell.editor.value = code;
      autoResize(cell.editor);
      cell.editor.dispatchEvent(new Event('input'));
      saveAll();
      cell._pendingInject  = { varName, data: injectData, fileType };
      cell._datasetInfo    = { varName, rows, columns, filename, columnNames };
      dsLabel.textContent  = `${varName} · ${rows.toLocaleString()} rows`;
      dsLabel.style.display = '';
      dsClearBtn.style.display = '';
      _onDataImported?.(varName, rows, filename, cell.id, cellNum);
      _saveInjectStore(); // persist so data survives page refresh
      // Update dataset_store so ARIA tabs reflect the new import immediately
      setDataset({
        name:    filename,
        columns: columnNames,
        dtypes:  {},
        rows:    [], // metadata only — actual row objects not needed here
      });
      // Notify file manager and other listeners that a new file was imported
      document.dispatchEvent(new CustomEvent('nb-file-imported', {
        detail: { varName, rows, columns, filename, fileType, cellId: cell.id }
      }));
      // No auto-run: Pyodide only boots when the user clicks ▶
    },
  });
  csvBtn.className = 'nb-btn nb-csv-btn';
  csvBtn.title     = 'Load CSV / Excel as DataFrame into this cell';

  // ── Save as file button ────────────────────────────────────────────────
  const saveFileBtn = mkBtn('nb-save-file-btn', '保存为文件 (Ctrl+S)',
    `<i class="ti ti-device-floppy"></i>`);

  // Inline filename input (hidden by default)
  const saveInlineWrap = document.createElement('div');
  saveInlineWrap.className = 'nb-save-inline';
  saveInlineWrap.style.display = 'none';

  const saveInput = document.createElement('input');
  saveInput.type = 'text';
  saveInput.className = 'nb-save-input';
  saveInput.autocomplete = 'off';
  saveInput.spellcheck = false;

  const saveConfirmBtn = mkBtn('nb-save-confirm-btn', '确认保存', `<i class="ti ti-check"></i>`);
  const saveCancelBtn  = mkBtn('nb-save-cancel-btn',  '取消',     `<i class="ti ti-x"></i>`);

  saveInlineWrap.append(saveInput, saveConfirmBtn, saveCancelBtn);
  cell._savedFilename = null;

  function _showSaveInput() {
    const ext = LANG_EXT[_normalizeLang(cell.lang)] ?? '.py';
    saveInput.value = cell._savedFilename ?? `untitled_${_cells.indexOf(cell) + 1}${ext}`;
    saveInlineWrap.style.display = '';
    saveFileBtn.style.display = 'none';
    requestAnimationFrame(() => { saveInput.select(); saveInput.focus(); });
  }

  function _hideSaveInput() {
    saveInlineWrap.style.display = 'none';
    saveFileBtn.style.display = '';
  }

  function _doSaveFile(filename) {
    filename = filename.trim();
    if (!filename) return;
    const store = JSON.parse(localStorage.getItem(CODE_FILE_KEY) ?? '{}');
    store[filename] = { filename, language: _normalizeLang(cell.lang), cellId: cell.id, code: cell.editor.value, savedAt: Date.now() };
    localStorage.setItem(CODE_FILE_KEY, JSON.stringify(store));
    writeCodeFileToFS(filename, cell.editor.value);
    cell._savedFilename = filename;
    _hideSaveInput();
    document.dispatchEvent(new CustomEvent('nb-code-file-saved', { detail: { filename, language: _normalizeLang(cell.lang) } }));
    if (getSettings().saveFileRemoveCell) {
      const cells = getCells();
      if (cells.length > 1) {
        cell._outputAC?.abort();
        setCells(cells.filter(c => c !== cell));
        rebuildCells();
        saveAll();
      }
    }
  }

  saveFileBtn.addEventListener('click', () => {
    if (cell._savedFilename) { _doSaveFile(cell._savedFilename); } else { _showSaveInput(); }
  });
  saveConfirmBtn.addEventListener('click', () => _doSaveFile(saveInput.value));
  saveCancelBtn.addEventListener('click',  _hideSaveInput);
  saveInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); _doSaveFile(saveInput.value); }
    if (e.key === 'Escape') { e.preventDefault(); _hideSaveInput(); }
  });

  toolbar.append(numEl, sel, runBtn, upBtn, downBtn, delBtn, copyBtn, dsLabel, dsClearBtn, importBtn, saveFileBtn, saveInlineWrap);

  const editor = document.createElement('textarea');
  editor.className    = 'nb-editor';
  editor.spellcheck   = false;
  editor.autocorrect  = 'off';
  editor.autocomplete = 'off';
  editor.placeholder  = PLACEHOLDER[lang] ?? '';
  editor.value        = code;
  cell.editor = editor;

  body.append(editor);
  // Ghost text prediction overlay (ICM-gated, Python only)
  attachGhostText({ body, editor, cell, icmEnabled, icmOnChange });

  // Ctrl+I hover hint — visible only when ICM is on
  const aiHint = document.createElement('span');
  aiHint.className = 'nb-ai-hint';
  aiHint.textContent = 'Ctrl+I进入智能对话';
  aiHint.style.display = icmEnabled() ? '' : 'none';
  icmOnChange(on => { aiHint.style.display = on ? '' : 'none'; });
  body.appendChild(aiHint);
  // Ensure editor height is correct on first paint (autoResize needs the element in DOM)
  requestAnimationFrame(() => autoResize(editor));
  const lowerRow = document.createElement('div');
  lowerRow.className = 'nb-cell-lower';
  lowerRow.append(gutter, body);

  // ── Legacy inline output section (kept for closure refs; not mounted; CSS hides it) ──
  const outputSection = document.createElement('div');
  outputSection.className = 'nb-output-section';
  const cellSourceWidget = createSourceWidget();
  const outputBody = document.createElement('div');
  outputBody.className = 'nb-output-section-body';
  outputSection.append(outputBody);

  // ── Mirror split: code pane │ handle │ output pane ────────────────────
  const mirrorCodePane = document.createElement('div');
  mirrorCodePane.className = 'mirror-code-pane';
  mirrorCodePane.append(toolbar, lowerRow);

  const mirrorHandlePill = document.createElement('div');
  mirrorHandlePill.className = 'mirror-handle-pill';
  const mirrorHandle = document.createElement('div');
  mirrorHandle.className = 'mirror-handle';
  mirrorHandle.appendChild(mirrorHandlePill);

  const mirrorOutPlaceholder = document.createElement('div');
  mirrorOutPlaceholder.className = 'mirror-out-placeholder';
  mirrorOutPlaceholder.textContent = 'Run to see output';
  const mirrorOutPane = document.createElement('div');
  mirrorOutPane.className = 'mirror-out-pane';
  mirrorOutPane.appendChild(mirrorOutPlaceholder);

  // ── Drag handle — rubber-band snap ────────────────────────────────────
  function _startMirrorDrag(startClientX) {
    document.body.classList.add('mirror-dragging');
    const onMove = clientX => {
      const cellRect = el.getBoundingClientRect();
      const pct = ((clientX - cellRect.left) / cellRect.width) * 100;
      mirrorCodePane.style.transition = 'none';
      mirrorCodePane.style.width = Math.min(80, Math.max(22, pct)) + '%';
      autoResize(editor);
    };
    const onUp = clientX => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup',   onMouseUp);
      document.body.classList.remove('mirror-dragging');
      const cellRect = el.getBoundingClientRect();
      const pct = ((clientX - cellRect.left) / cellRect.width) * 100;
      const clamped = Math.min(80, Math.max(22, pct));
      mirrorCodePane.style.transition = 'width 320ms cubic-bezier(0.16,1,0.3,1)';
      mirrorCodePane.style.width = clamped + '%';
      setTimeout(() => { mirrorCodePane.style.transition = ''; autoResize(editor); }, 340);
    };
    const onMouseMove = e => onMove(e.clientX);
    const onMouseUp   = e => onUp(e.clientX);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup',   onMouseUp);
  }

  mirrorHandle.addEventListener('mousedown', e => { e.preventDefault(); _startMirrorDrag(e.clientX); });
  mirrorHandle.addEventListener('touchstart', e => {
    e.preventDefault();
    document.body.classList.add('mirror-dragging');
    const onTouchMove = e => {
      e.preventDefault();
      const clientX = e.touches[0].clientX;
      const cellRect = el.getBoundingClientRect();
      const pct = ((clientX - cellRect.left) / cellRect.width) * 100;
      mirrorCodePane.style.transition = 'none';
      mirrorCodePane.style.width = Math.min(80, Math.max(22, pct)) + '%';
      autoResize(editor);
    };
    const onTouchEnd = e => {
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend',  onTouchEnd);
      document.body.classList.remove('mirror-dragging');
      const clientX = e.changedTouches[0].clientX;
      const cellRect = el.getBoundingClientRect();
      const pct = ((clientX - cellRect.left) / cellRect.width) * 100;
      const clamped = Math.min(80, Math.max(22, pct));
      mirrorCodePane.style.transition = 'width 320ms cubic-bezier(0.16,1,0.3,1)';
      mirrorCodePane.style.width = clamped + '%';
      setTimeout(() => { mirrorCodePane.style.transition = ''; autoResize(editor); }, 340);
    };
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend',  onTouchEnd);
  }, { passive: false });

  el.append(mirrorCodePane, mirrorHandle, mirrorOutPane);
  cell.el = el;

  // When any part of this cell gains focus, tell the output panel to highlight
  // and scroll to the corresponding section.
  el.addEventListener('focusin', () => {
    _lastFocusedCellId = id;
    document.dispatchEvent(new CustomEvent('notebook-cell-focused', { detail: { cellId: id } }));
  });

  const outputAC = new AbortController();
  cell._outputAC = outputAC;

  document.addEventListener('compile-result', ({ detail }) => {
    if (detail.cellId !== id) return;
    const { outputs, sourceCode, sourceLang } = detail;
    cellSourceWidget.setSource(sourceCode ?? null, sourceLang ?? null);
    outputBody.innerHTML = '';
    outputSection.classList.toggle('has-output', !!(outputs?.length));
    // Mark cell as having fresh output; clear stale indicator on the mirror pane
    el.dataset.hasOutput = '1';
    el.classList.remove('mirror--stale');
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
    el.dataset.hasOutput = '';
    el.classList.remove('mirror--stale');
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
    normalizeLang: _normalizeLang,
    flushPendingInjects:  _flushPendingInjects,
    buildImportCellCode:  _buildImportCellCode,
  });

  // Mark mirror pane stale when code is edited after a run; clear ARIA badge on any edit
  editor.addEventListener('input', () => {
    if (el.dataset.hasOutput === '1') el.classList.add('mirror--stale');
    delete el.dataset.ariaSource;
    _cloudScheduleSave();
  }, { signal: outputAC.signal });

  // Ctrl+I / Cmd+I — open inline AI completion popup
  // Ctrl+S / Cmd+S — save cell as file
  editor.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
      e.preventDefault();
      _openInlineAI(cell, editor);
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      if (cell._savedFilename) { _doSaveFile(cell._savedFilename); } else { _showSaveInput(); }
      _cloudSync();
    }
  }, { signal: outputAC.signal });

  // ── Per-cell ICM instances ────────────────────────────
  cell._icm = { hl: createSyntaxHL(), th: createTextHL(), cc: createCompletion() };

  function _icmSyncCell() {
    if (_normalizeLang(cell.lang) === 'python' && icmEnabled()) {
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

let _runAllAbort = null; // AbortController for the current Run All session

export function abortRunAll() {
  _runAllAbort?.abort();
}

async function runAll(btn) {
  // Cancel any already-running session
  _runAllAbort?.abort();
  _runAllAbort = new AbortController();
  const { signal } = _runAllAbort;

  const total = _cells.filter(c => c.editor.value.trim()).length;
  document.dispatchEvent(new CustomEvent('run-all-start', { detail: { total } }));
  // Force a browser paint so the red stop-button is visible before the loop starts.
  // Without this, microtask-resolved Promises can complete the whole loop before
  // the browser has a chance to repaint the updated DOM.
  await new Promise(r => requestAnimationFrame(r));

  document.dispatchEvent(new CustomEvent('notebook-clear-output'));

  // Save per-cell inject info before flush clears _pendingInject.
  const _cellInjectDs = new Map();
  _cells.forEach(c => {
    if (c._pendingInject && c._datasetInfo) _cellInjectDs.set(c.id, { ...c._datasetInfo });
  });

  // Inject any pending DataFrames before any cell runs so every cell can
  // reference every imported variable, including AI-generated cells.
  await _flushPendingInjects();

  let done = 0;
  for (let i = 0; i < _cells.length; i++) {
    if (signal.aborted) break;

    const cell = _cells[i];
    const code = cell.editor.value.trim();
    if (!code) continue;

    const lang = _normalizeLang(cell.lang);
    if (lang === 'python' && /\binput\s*\(/.test(code)) {
      document.dispatchEvent(new CustomEvent('run-in-terminal', { detail: { code } }));
      continue;
    }

    done++;
    document.dispatchEvent(new CustomEvent('run-all-cell-start', { detail: { done, total } }));
    cell.counter.textContent = '*';
    const cellRunBtn = cell.el.querySelector('.nb-run');
    if (cellRunBtn) cellRunBtn.disabled = true;

    const outputs = await compile(code, lang, { cellIndex: i + 1 });

    if (signal.aborted) {
      if (cellRunBtn) cellRunBtn.disabled = false;
      break;
    }

    // Dispatch progress AFTER compile so each step is visible; rAF ensures paint.
    document.dispatchEvent(new CustomEvent('run-all-progress', { detail: { done, total } }));
    await new Promise(r => requestAnimationFrame(r));

    // Ensure import-button cells get a viz-suggestion (RUNNER diff misses these)
    const _ownDs = _cellInjectDs.get(cell.id);
    if (_ownDs?.varName && lang === 'python') {
      const { varName, rows, columns } = _ownDs;
      if (!outputs.some(o => o.type === 'viz-suggestion' && o.varName === varName)) {
        outputs.push({
          type: 'viz-suggestion', varName, kind: 'dataframe',
          shape: `${Number(rows).toLocaleString()}行×${Number(columns)}列`,
        });
      }
    }
    if (lang === 'python') {
      queryKernelDataframes().then(dfs => {
        if (Object.keys(dfs).length)
          document.dispatchEvent(new CustomEvent('kernel-dfs-updated', { detail: { dfs } }));
      }).catch(() => {});
    }

    if (cellRunBtn) cellRunBtn.disabled = false;
    _runSeq++;
    cell.counter.textContent = _runSeq;

    document.dispatchEvent(new CustomEvent('compile-result', {
      detail: { outputs, cellId: cell.id, cellLabel: `Cell ${i + 1} · ${lang}`, sourceCode: code, sourceLang: lang, ariaSource: cell.el.dataset.ariaSource === '1' }
    }));
  }

  document.dispatchEvent(new CustomEvent('run-all-done', { detail: { aborted: signal.aborted } }));
  _runAllAbort = null;
}

// ── Public init ───────────────────────────────────────────

export function init(container, externalTopbar) {
  let savedData = null;
  try { savedData = JSON.parse(localStorage.getItem(CELLS_KEY)); } catch (_) {}

  if (!Array.isArray(savedData) || !savedData.length) {
    const legacyCode = localStorage.getItem(OLD_CODE_KEY) ?? '';
    savedData = [{ id: uid(), lang: 'python', code: legacyCode }];
  }

  _cells  = savedData.map(d => makeCell(_normalizeLang(d.lang ?? 'python'), d.code ?? '', d.id ?? uid()));
  _runSeq = 0;

  // Restore persisted inject data (survive page refresh)
  _restoreInjectData();

  // Clean up inject store when a cell is deleted
  document.addEventListener('notebook-cell-deleted', ({ detail: { cellId } }) => {
    _removeFromInjectStore(cellId);
    FileTracker.untrackCell(cellId); // remove file→cell mapping so next click re-inserts
  });

  // Trim empty cells — remove cells with no code, keep at least one
  document.addEventListener('trim-empty-cells', () => {
    const before = _cells.length;
    const removed = _cells.filter(c => !c.editor.value.trim());
    _cells = _cells.filter(c => c.editor.value.trim());
    if (!_cells.length) _cells = [makeCell('python', '', uid())]; // always keep ≥1
    removed.forEach(c => {
      _removeFromInjectStore(c.id);
      FileTracker.untrackCell(c.id);
      document.dispatchEvent(new CustomEvent('notebook-cell-deleted', { detail: { cellId: c.id } }));
    });
    if (_cells.length !== before) {
      rebuildCells();
      saveAll();
      // Also push to cloud immediately so refresh doesn't restore old empty cells
      window._dpSync?.syncToCloud();
    }
  });

  // Cloud restore — replace all cells with cloud data (fires after login)
  document.addEventListener('dp-cloud-restore', ({ detail: { cells } }) => {
    if (!Array.isArray(cells) || !cells.length) return;
    const sorted = [...cells].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
    _cells = sorted.map(d => makeCell(_normalizeLang(d.language ?? 'python'), d.code ?? '', d.id ?? uid()));
    rebuildCells();
    saveAll(); // persist to localStorage so next cold load also gets the cloud data
  });

  const nb = document.createElement('div');
  nb.className = 'notebook-editor-area';

  const runAllBtn = document.createElement('button');
  runAllBtn.className = 'nb-run-all-btn';
  runAllBtn.innerHTML =
    `<svg width="11" height="10" viewBox="0 0 22 16" fill="currentColor" aria-hidden="true"><path d="M1 2.5l8 5.5-8 5.5V2.5z"/><path d="M11 2.5l8 5.5-8 5.5V2.5z"/></svg>` +
    `<span class="nb-run-all-label">Run All</span>`;
  runAllBtn.title = 'Run all cells in order (⌘⏎)';

  const cellCount = document.createElement('span');
  cellCount.className = 'nb-cell-count';

  _updateCellCount = () => {
    const n = _cells.length;
    cellCount.textContent = `${n} cell${n === 1 ? '' : 's'}`;
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

  // ── Run All 状态联动 ──────────────────────────────────────────────────────────
  const _RUNALL_SVG_ORIG  = runAllBtn.innerHTML;
  const _STOP_SVG =
    `<svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">` +
    `<rect x="3" y="3" width="10" height="10" rx="1.5"/></svg>` +
    `<span class="nb-run-all-label">停止</span>`;

  function _setRunAllRunning(total) {
    runAllBtn.innerHTML = _STOP_SVG;
    runAllBtn.style.background = '#ef4444';
    runAllBtn.style.boxShadow  = '0 1px 3px rgba(239,68,68,0.35)';
    runAllBtn.style.border     = '1px solid rgba(255,255,255,0.15)';
    runAllBtn.disabled = false;
    runAllBtn.onclick  = e => { e.stopPropagation(); abortRunAll(); };
  }

  function _setRunAllIdle() {
    runAllBtn.innerHTML    = _RUNALL_SVG_ORIG;
    runAllBtn.style.background = '';
    runAllBtn.style.boxShadow  = '';
    runAllBtn.style.border     = '';
    runAllBtn.disabled = false;
    runAllBtn.onclick  = null;  // restore listener from attachNotebookHooks
    const n = _cells.length;
    cellCount.className   = 'nb-cell-count';
    cellCount.textContent = `${n} cell${n === 1 ? '' : 's'}`;
  }

  // ── Progress display helpers ──────────────────────────────────────────────────
  const _DOTS_HTML = `<span class="nb-count-dots" aria-hidden="true">` +
    `<span>·</span><span>·</span><span>·</span></span>`;

  function _setCountRunning(text) {
    cellCount.className = 'nb-cell-count';
    cellCount.innerHTML = text + _DOTS_HTML;
  }
  function _setCountDone(text) {
    cellCount.className = 'nb-cell-count nb-cell-count--done';
    cellCount.textContent = text;
  }

  let _progressTimer = null;
  let _isRunAllActive = false;
  let _currentCellProgress = null; // { done, total } — saved to restore after pkg load

  document.addEventListener('run-all-start', ({ detail: { total } }) => {
    _isRunAllActive = true;
    _currentCellProgress = null;
    _setRunAllRunning(total);
    _setCountRunning('正在初始化');
  });

  document.addEventListener('run-all-cell-start', ({ detail: { done, total } }) => {
    clearTimeout(_progressTimer);
    _currentCellProgress = { done, total };
    _setCountRunning(`第 ${done} / ${total} 个 Cell`);
  });

  document.addEventListener('run-all-progress', ({ detail: { done, total } }) => {
    clearTimeout(_progressTimer);
    _currentCellProgress = null;
    _setCountDone(`✓ Cell ${done} 完成`);
    if (done < total) {
      _progressTimer = setTimeout(() => {
        _setCountRunning(`第 ${done + 1} / ${total} 个 Cell`);
      }, 200);
    }
  });

  document.addEventListener('run-all-done', () => {
    _isRunAllActive = false;
    _currentCellProgress = null;
    clearTimeout(_progressTimer);
    _progressTimer = null;
    _setRunAllIdle();
  });

  // ── Package loading notifications (only during Run All) ───────────────────
  document.addEventListener('worker-pkg-loading', ({ detail: { packages } }) => {
    if (!_isRunAllActive) return;
    // Show up to 3 package names to keep it concise
    const names = packages.slice(0, 3).join(', ') + (packages.length > 3 ? ' …' : '');
    _setCountRunning(`正在加载 ${names}`);
  });

  document.addEventListener('worker-pkg-loaded-all', () => {
    if (!_isRunAllActive) return;
    // Restore cell-level progress after packages are done
    if (_currentCellProgress) {
      const { done, total } = _currentCellProgress;
      _setCountRunning(`第 ${done} / ${total} 个 Cell`);
    }
  });

  // Sep-hint reload: patch the active cell's import code to add sep argument
  document.addEventListener('sep-hint-reload', ({ detail: { varName, sepArg } }) => {
    const cell = _lastFocusedCellId
      ? _cells.find(c => c.id === _lastFocusedCellId)
      : _cells.find(c => c._datasetInfo?.varName === varName);
    if (!cell) return;
    // Patch: replace read_csv(...) with read_csv(..., sep=';')
    const patched = cell.editor.value
      .replace(/(pd\.read_csv\([^)]+?)(\))/, `$1, ${sepArg}$2`);
    cell.editor.value = patched;
    autoResize(cell.editor);
    cell.editor.dispatchEvent(new Event('input'));
    saveAll();
    cell.el.querySelector('.nb-run')?.click();
  });

  // "立即运行" button in viz/clean panels — run a specific cell by its ID
  document.addEventListener('run-cell-by-id', ({ detail: { cellId } }) => {
    const cell = _cells.find(c => c.id === cellId);
    cell?.el.querySelector('.nb-run')?.click();
  });

  // File manager: insert import code into the last focused cell (or create one)
  document.addEventListener('rb-insert-file', ({ detail: { code } }) => {
    const cell = _lastFocusedCellId
      ? _cells.find(c => c.id === _lastFocusedCellId)
      : _cells[0];
    if (!cell) return;
    cell.editor.value = code;
    autoResize(cell.editor);
    cell.editor.dispatchEvent(new Event('input'));
    cell.editor.focus();
    saveAll();
  });

  // File manager smart click:
  // • File tracked in FileTracker → navigate (switch screen + scroll + flash)
  // • File not tracked            → insert into first empty cell, or create one
  document.addEventListener('rb-file-smart-click', ({ detail: { code, entry } }) => {
    const filename = entry?.filename ?? '';

    // Helper: switch to coding screen (closes ARIA / ai-chat / other hero screens),
    // then scroll to and flash the target cell.
    function _navigateTo(cell) {
      // open() calls _closeGroup → closes all other hero-group screens (terminal/ai-chat/content)
      window.screenController?.open('coding');
      setTimeout(() => {
        cell.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        cell.editor.focus();
        cell.el.classList.add('nb-cell--nav-flash');
        setTimeout(() => cell.el.classList.remove('nb-cell--nav-flash'), 900);
      }, 80);
    }

    // ── Case 1: file already in a cell → navigate, never re-insert ───────
    if (getSettings().smartFileNavigation) {
      // Check FileTracker first, then verify by actual code content (avoids stale _datasetInfo)
      const byTracker = FileTracker.findCell(filename);
      const byCode    = !byTracker && _cells.find(c => {
        const v = c.editor.value;
        return v.includes(`"${filename}"`) || v.includes(`'${filename}'`);
      });
      const existing = byTracker ?? byCode ?? null;
      if (existing) {
        // Keep FileTracker in sync if we found it by code content
        if (byCode) FileTracker.track(filename, byCode.id);
        _navigateTo(existing);
        return;
      }
    }

    // ── Case 2: find first empty cell and insert ──────────────────────────
    const emptyCell = _cells.find(c => !c.editor.value.trim());
    const target = emptyCell ?? (() => {
      const c = makeCell('python', '');
      _cells.push(c);
      rebuildCells();
      return c;
    })();

    target.editor.value = code;
    autoResize(target.editor);
    target.editor.dispatchEvent(new Event('input'));
    saveAll();

    // Register in FileTracker so next click navigates here
    FileTracker.track(filename, target.id);

    _navigateTo(target);

    // Auto-run the cell if setting is ON
    if (getSettings().autoRunOnFileInsert) {
      requestAnimationFrame(() => target.el.querySelector('.nb-run')?.click());
    }
  });

  // Code file click from file manager → inject code into focused/empty cell
  document.addEventListener('nb-code-file-click', ({ detail: { filename, language, code } }) => {
    const lang = _normalizeLang(language ?? 'python');
    const focusedCell = _lastFocusedCellId ? _cells.find(c => c.id === _lastFocusedCellId) : null;
    const emptyCell   = _cells.find(c => !c.editor.value.trim());
    const target = (focusedCell && !focusedCell.editor.value.trim() ? focusedCell : null)
                ?? emptyCell
                ?? (() => {
                     const c = makeCell(lang, '');
                     _cells.push(c);
                     rebuildCells();
                     return c;
                   })();
    target.lang = lang;
    const selEl = target.el.querySelector('.nb-lang-select');
    if (selEl) selEl.value = lang;
    target.editor.value = code;
    autoResize(target.editor);
    target.editor.dispatchEvent(new Event('input'));
    saveAll();
    window.screenController?.open('coding');
    setTimeout(() => {
      target.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.editor.focus();
      target.el.classList.add('nb-cell--nav-flash');
      setTimeout(() => target.el.classList.remove('nb-cell--nav-flash'), 900);
    }, 80);
  });

  // When AI generates code while the Customise tab is active, the notebook
  // owns this event — no other component needs to know about it.
  document.addEventListener('ai-insert-and-run', async ({ detail: { code, lang, cellId } }) => {
    const st = window.screenController?.getState('coding');
    if (st !== 'normal' && st !== 'maximized') return;
    await _flushPendingInjects();
    if (cellId) {
      const cell = _cells.find(c => c.id === cellId);
      if (cell) {
        cell.editor.value = code;
        autoResize(cell.editor);
        cell.editor.dispatchEvent(new Event('input'));
        saveAll();
        cell.el.dataset.ariaSource = '1'; // mark as ARIA-generated
        cell.el.querySelector('.nb-run')?.click();
      }
      return;
    }
    const newCell = addImportedCell(lang ?? 'python', code, { autoRun: true });
    if (newCell) newCell.el.dataset.ariaSource = '1'; // mark as ARIA-generated
  });

  document.addEventListener('refactor-code', ({ detail: { code, cellId } }) => {
    setCellCode(cellId, code);
  });

  // Kernel restart: re-inject all datasets (FS survives restart, only namespace is cleared)
  document.addEventListener('reload-injected-datasets', async () => {
    try {
      await _flushPendingInjects();
      document.dispatchEvent(new CustomEvent('datasets-reloaded'));
    } catch (e) {
      console.warn('[inject] reload failed:', e);
    }
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
  // Keep labels and code visible — user sees exactly what data they had.
  // Just null out _pendingInject; _restoreInjectData will re-arm it from
  // inject-store so the next Run automatically re-injects into the kernel.
  _cells.forEach(c => { c._pendingInject = null; });
  // showLabels=true so labels stay; restoreDatasets=false because kernel is
  // empty until user Runs — dataset_store / ARIA tabs repopulate on first Run.
  _restoreInjectData(true, false);
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
  if (!_cellsEl) return null;
  const cell = makeCell(_normalizeLang(lang), code, uid());
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
  return cell;
}
