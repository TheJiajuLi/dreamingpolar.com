import { getCurrentMode, mountModeSwitcher } from '../../compiler/compiler_mode_switcher/compiler_mode_switcher.js';
import { init as initNotebook } from '../../customise_code_block/customise_code_block.js';
import { compile } from '../../compiler/compiler.js';
import { createClearCellsBtn } from './coding_screen_utility.js';
import { renderBlocks, parseAIResponse } from '../compiling_screen/compiling_screen_utility.js';
import { ask, systemExplainForLang } from '../../ai/ai_client.js';
import { createRefactorBtn } from '../compiling_screen/refactorization_button/refactorization_button.js';
import { isEnabled as icmEnabled, onChange as icmOnChange, mount as mountICM } from './intelligent_coding_mode/intelligent_coding_mode.js';
import * as SyntaxHL from './coding_screen_python/python_syntax_highlight/python_syntax_highlight.js';
import * as TextHL   from './coding_screen_python/python_text_highlight/python_text_highlight.js';
import * as Completion from './coding_screen_python/python_code-completion/python_code_completion.js';
import { createImportBtn } from '../../import/import_btn.js';
import { addImportedCell, setCellCode } from '../../customise_code_block/customise_code_block.js';

const CODE_KEY = 'dreaming-polar-code';

const PLACEHOLDERS = {
  python: `# Example — try running this:
from sympy import symbols, expand, latex
x = symbols('x')
expand((x + 1)**4)

# SymPy, matplotlib, pandas & numpy are preloaded.
# Ctrl/Cmd+Enter to run.`,

  latex: `\\documentclass{article}
\\begin{document}

The Pythagorean theorem: \\(a^2 + b^2 = c^2\\)

\\[
  \\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}
\\]

\\end{document}`,

  mathjax: `Mixed text and math:

The equation \\(E = mc^2\\) changed physics.

$$\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}$$`,

  markdown: `## Heading

Write **bold**, *italic*, or \`inline code\`.

- Item one
- Item two

> A blockquote.`,
};

function setupCodingScreen() {
  const screen = document.getElementById('coding-screen');
  if (!screen) return;

  const terminalPanel = document.getElementById('terminal-panel');

  screen.innerHTML = `
    <div class="coding-screen-body" id="coding-screen-body">
      <div id="cds-notebook-view"></div>
    </div>
  `;

  if (terminalPanel) screen.appendChild(terminalPanel);

  // cds-single-view lives inside terminal-panel (RIGHT side in single mode).
  // terminal.js runs after us and uses prepend(), so this stays as the last child.
  const singleView = document.createElement('div');
  singleView.id = 'cds-single-view';
  if (terminalPanel) terminalPanel.appendChild(singleView);

  // ── Screen controller ─────────────────────────────────
  requestAnimationFrame(() => {
    window.screenController?.register('coding', screen, { label: 'Code', persisted: true, noChip: true });
  });

  const notebookView = document.getElementById('cds-notebook-view');

  // ── Single-cell view ──────────────────────────────────
  const runBtn = document.createElement('button');
  runBtn.className = 'nb-btn nb-run';
  runBtn.innerHTML = '&#9654;';
  runBtn.title = 'Run (Ctrl+Enter)';

  const toolbar = document.createElement('div');
  toolbar.className = 'coding-toolbar';

  const modeSlot = document.createElement('div');
  modeSlot.className = 'cds-mode-slot';
  mountModeSwitcher(modeSlot);

  const icmSlot = document.createElement('div');
  icmSlot.className = 'cds-icm-slot';
  mountICM(icmSlot);

  const copyBtn = document.createElement('button');
  copyBtn.className = 'lus-copy-btn cds-copy-btn';
  copyBtn.title     = 'Copy source';
  copyBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
  copyBtn.addEventListener('click', () => {
    const code = editor.value;
    if (!code) return;
    navigator.clipboard?.writeText(code).then(() => {
      copyBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
      copyBtn.classList.add('lus-copy-btn--done');
      setTimeout(() => {
        copyBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
        copyBtn.classList.remove('lus-copy-btn--done');
      }, 1600);
    });
  });

  const toolbarClearBtn = createClearCellsBtn();
  toolbarClearBtn.id = 'cds-toolbar-clear-btn';

  const importBtn = createImportBtn({
    getMode: getCurrentMode,
    onImport(content) {
      if (_editorRef) {
        _editorRef.value = content;
        _editorRef.dispatchEvent(new Event('input'));
        localStorage.setItem(CODE_KEY, content);
      }
    },
    onNotebookImport(content, lang) {
      addImportedCell(lang, content);
    },
  });

  toolbar.appendChild(modeSlot);
  toolbar.appendChild(icmSlot);
  toolbar.appendChild(importBtn);
  toolbar.appendChild(copyBtn);
  toolbar.appendChild(toolbarClearBtn);
  toolbar.appendChild(runBtn);

  const editorWrap = document.createElement('div');
  editorWrap.className = 'code-editor-area';

  let _editorRef = null;
  const editor = document.createElement('textarea');
  editor.className    = 'code-editor';
  editor.spellcheck   = false;
  editor.autocorrect  = 'off';
  editor.autocomplete = 'off';
  editor.setAttribute('autocapitalize', 'none');
  editor.setAttribute('inputmode', 'text');
  editor.placeholder  = PLACEHOLDERS[getCurrentMode()] ?? PLACEHOLDERS.python;
  editor.value        = localStorage.getItem(CODE_KEY) ?? '';
  _editorRef = editor;
  editorWrap.appendChild(editor);

  // ── Code panel (left) ─────────────────────────────────
  const codePanel = document.createElement('div');
  codePanel.className = 'cds-code-panel';
  codePanel.append(toolbar, editorWrap);

  // ── Output panel (right) ──────────────────────────────
  const outputPanel = document.createElement('div');
  outputPanel.className = 'cds-output-panel';

  const outputPanelHdr = document.createElement('div');
  outputPanelHdr.className = 'cds-output-panel-hdr';

  const outputHdrLabel = document.createElement('span');
  outputHdrLabel.className = 'cds-output-panel-label';
  outputHdrLabel.textContent = 'Output';

  const outClearBtn = document.createElement('button');
  outClearBtn.className = 'sc-btn';
  outClearBtn.title = 'Clear output';
  outClearBtn.textContent = '⊘';

  const outMaxBtn = document.createElement('button');
  outMaxBtn.className = 'sc-btn';
  outMaxBtn.title = 'Maximize';
  outMaxBtn.textContent = '⤢';

  const outMinBtn = document.createElement('button');
  outMinBtn.className = 'sc-btn';
  outMinBtn.title = 'Minimize';
  outMinBtn.textContent = '−';

  const outToolbar = document.createElement('div');
  outToolbar.className = 'sc-toolbar';
  outToolbar.append(outClearBtn, outMaxBtn, outMinBtn);

  outputPanelHdr.append(outputHdrLabel, outToolbar);

  const outputPlaceholder = document.createElement('div');
  outputPlaceholder.className = 'cds-output-placeholder';
  outputPlaceholder.textContent = 'Run to see output';

  const singleOutputBody = document.createElement('div');
  singleOutputBody.className = 'cds-output-body';

  outputPanel.append(outputPanelHdr, outputPlaceholder, singleOutputBody);

  // ── Resizer (absolutely positioned on left edge of outputPanel) ──
  const CDS_OUT_W_KEY = 'dp-cds-output-w';
  const CDS_OUT_MIN_W = 160;

  const savedOutW = parseFloat(localStorage.getItem(CDS_OUT_W_KEY))
                 || parseFloat(localStorage.getItem('dp-cs-width'))
                 || 280;
  outputPanel.style.width = savedOutW + 'px';
  outputPanel.style.flex  = 'none';

  const resizer = document.createElement('div');
  resizer.className = 'cds-resizer';
  resizer.title = 'Drag to resize · Double-click to reset';
  outputPanel.appendChild(resizer);

  function _startResize(startX) {
    document.body.classList.add('cs-resizing');

    function onMove(clientX) {
      const viewRect = singleView.getBoundingClientRect();
      const maxW = viewRect.width * 0.75;
      const newW = Math.min(maxW, Math.max(CDS_OUT_MIN_W, viewRect.right - clientX));
      outputPanel.style.width = newW + 'px';
      outputPanel.style.flex = 'none';
    }
    function onUp(clientX) {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup',   onMouseUp);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend',  onTouchEnd);
      document.body.classList.remove('cs-resizing');
      onMove(clientX);
      localStorage.setItem(CDS_OUT_W_KEY, parseFloat(outputPanel.style.width));
    }
    const onMouseMove = e => onMove(e.clientX);
    const onMouseUp   = e => onUp(e.clientX);
    const onTouchMove = e => { e.preventDefault(); onMove(e.touches[0].clientX); };
    const onTouchEnd  = e => onUp(e.changedTouches[0].clientX);

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup',   onMouseUp);
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend',  onTouchEnd);
  }

  resizer.addEventListener('mousedown',  e => { e.preventDefault(); _startResize(e.clientX); });
  resizer.addEventListener('touchstart', e => { e.preventDefault(); _startResize(e.touches[0].clientX); }, { passive: false });
  resizer.addEventListener('dblclick',   () => {
    outputPanel.style.width = '';
    outputPanel.style.flex  = '';
    localStorage.removeItem(CDS_OUT_W_KEY);
  });

  singleView.append(codePanel, outputPanel);

  // ── Output panel toolbar buttons ──────────────────────
  outClearBtn.addEventListener('click', () => {
    singleOutputBody.innerHTML = '';
    outputPlaceholder.style.display = '';
  });

  outMaxBtn.addEventListener('click', () => {
    const isMax = outputPanel.dataset.expanded === '1';
    if (isMax) {
      outputPanel.style.width = outputPanel.dataset.prevWidth || (savedOutW + 'px');
      outputPanel.style.flex  = 'none';
      delete outputPanel.dataset.expanded;
      outMaxBtn.textContent = '⤢';
      outMaxBtn.title = 'Maximize';
    } else {
      outputPanel.dataset.prevWidth = outputPanel.style.width;
      outputPanel.dataset.expanded  = '1';
      const maxW = singleView.getBoundingClientRect().width * 0.75;
      outputPanel.style.width = Math.round(maxW) + 'px';
      outputPanel.style.flex  = 'none';
      outMaxBtn.textContent = '⤡';
      outMaxBtn.title = 'Restore';
    }
  });

  outMinBtn.addEventListener('click', () => {
    outputPanel.style.display = 'none';
  });

  // Restore output panel when code is run (in case it was hidden)
  document.addEventListener('compile-result', ({ detail }) => {
    outputPanel.style.display = '';
  });

  document.addEventListener('compile-result', ({ detail }) => {
    if (detail.cellId) return;
    const mode = getCurrentMode();
    if (mode === 'customise' || mode === 'ai_chat') return;
    const { outputs, sourceCode, sourceLang } = detail;
    singleOutputBody.innerHTML = '';
    renderBlocks(outputs, singleOutputBody, {
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
            lbl.appendChild(createRefactorBtn({ sourceCode, sourceLang, cellId: '__standalone__', explanation }));
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
    outputPlaceholder.style.display = 'none';
  });

  document.addEventListener('clear-active-code', () => {
    singleOutputBody.innerHTML = '';
    outputPlaceholder.style.display = '';
  });

  // ── Python ICM features ───────────────────────────────────
  function icmActivate() {
    SyntaxHL.init(editor, editorWrap);
    TextHL.init(editor, editorWrap);
    Completion.init(editor, editorWrap);
  }
  function icmDeactivate() {
    SyntaxHL.destroy();
    TextHL.destroy();
    Completion.destroy();
  }
  function syncICM(mode) {
    if (mode !== 'python') return; // features only apply to Python
    if (icmEnabled()) { if (!SyntaxHL.isActive()) icmActivate(); }
    else              { if (SyntaxHL.isActive())  icmDeactivate(); }
  }

  syncICM(getCurrentMode());
  icmOnChange(() => syncICM(getCurrentMode()));

  // ── Notebook view ─────────────────────────────────────
  const nbLeft = document.createElement('div');
  nbLeft.className = 'cds-notebook-panel';

  const nbToolbar = document.createElement('div');
  nbToolbar.className = 'cds-notebook-toolbar';
  const runAllSlot = document.createElement('div');
  runAllSlot.id = 'cds-runall-slot';
  runAllSlot.className = 'cds-runall-slot';
  const clearCellsBtn = createClearCellsBtn();
  nbToolbar.append(runAllSlot, clearCellsBtn);
  nbLeft.appendChild(nbToolbar);
  notebookView.appendChild(nbLeft);
  initNotebook(nbLeft, runAllSlot);

  // ── Notebook output panel (right, same design as single view) ──
  const NB_OUT_W_KEY = 'dp-nb-output-w';
  const NB_OUT_MIN_W = 160;
  const savedNbOutW  = parseFloat(localStorage.getItem(NB_OUT_W_KEY)) || 280;

  const nbOutputPanel = document.createElement('div');
  nbOutputPanel.className = 'cds-output-panel';
  nbOutputPanel.style.width = savedNbOutW + 'px';
  nbOutputPanel.style.flex  = 'none';

  const nbOutputPanelHdr = document.createElement('div');
  nbOutputPanelHdr.className = 'cds-output-panel-hdr';

  const nbOutputHdrLabel = document.createElement('span');
  nbOutputHdrLabel.className = 'cds-output-panel-label';
  nbOutputHdrLabel.textContent = 'Output';

  const nbOutClearBtn = document.createElement('button');
  nbOutClearBtn.className = 'sc-btn';
  nbOutClearBtn.title = 'Clear output';
  nbOutClearBtn.textContent = '⊘';

  const nbOutMaxBtn = document.createElement('button');
  nbOutMaxBtn.className = 'sc-btn';
  nbOutMaxBtn.title = 'Maximize';
  nbOutMaxBtn.textContent = '⤢';

  const nbOutMinBtn = document.createElement('button');
  nbOutMinBtn.className = 'sc-btn';
  nbOutMinBtn.title = 'Minimize';
  nbOutMinBtn.textContent = '−';

  const nbOutToolbar = document.createElement('div');
  nbOutToolbar.className = 'sc-toolbar';
  nbOutToolbar.append(nbOutClearBtn, nbOutMaxBtn, nbOutMinBtn);

  nbOutputPanelHdr.append(nbOutputHdrLabel, nbOutToolbar);

  const nbOutputPlaceholder = document.createElement('div');
  nbOutputPlaceholder.className = 'cds-output-placeholder';
  nbOutputPlaceholder.textContent = 'Run to see output';

  const nbOutputBody = document.createElement('div');
  nbOutputBody.className = 'cds-output-body';

  nbOutputPanel.append(nbOutputPanelHdr, nbOutputPlaceholder, nbOutputBody);

  const nbResizer = document.createElement('div');
  nbResizer.className = 'cds-resizer';
  nbResizer.title = 'Drag to resize · Double-click to reset';
  nbOutputPanel.appendChild(nbResizer);

  function _startNbResize(startX) {
    document.body.classList.add('cs-resizing');
    function onMove(clientX) {
      const viewRect = notebookView.getBoundingClientRect();
      const maxW = viewRect.width * 0.75;
      const newW = Math.min(maxW, Math.max(NB_OUT_MIN_W, viewRect.right - clientX));
      nbOutputPanel.style.width = newW + 'px';
      nbOutputPanel.style.flex  = 'none';
    }
    function onUp(clientX) {
      document.removeEventListener('mousemove', onNbMouseMove);
      document.removeEventListener('mouseup',   onNbMouseUp);
      document.removeEventListener('touchmove', onNbTouchMove);
      document.removeEventListener('touchend',  onNbTouchEnd);
      document.body.classList.remove('cs-resizing');
      onMove(clientX);
      localStorage.setItem(NB_OUT_W_KEY, parseFloat(nbOutputPanel.style.width));
    }
    const onNbMouseMove = e => onMove(e.clientX);
    const onNbMouseUp   = e => onUp(e.clientX);
    const onNbTouchMove = e => { e.preventDefault(); onMove(e.touches[0].clientX); };
    const onNbTouchEnd  = e => onUp(e.changedTouches[0].clientX);
    document.addEventListener('mousemove', onNbMouseMove);
    document.addEventListener('mouseup',   onNbMouseUp);
    document.addEventListener('touchmove', onNbTouchMove, { passive: false });
    document.addEventListener('touchend',  onNbTouchEnd);
  }

  nbResizer.addEventListener('mousedown',  e => { e.preventDefault(); _startNbResize(e.clientX); });
  nbResizer.addEventListener('touchstart', e => { e.preventDefault(); _startNbResize(e.touches[0].clientX); }, { passive: false });
  nbResizer.addEventListener('dblclick',   () => {
    nbOutputPanel.style.width = '';
    nbOutputPanel.style.flex  = '';
    localStorage.removeItem(NB_OUT_W_KEY);
  });

  notebookView.appendChild(nbOutputPanel);

  const nbSections = new Map();

  function getOrCreateNbSection(cellId, cellLabel, lang) {
    if (nbSections.has(cellId)) {
      const sec = nbSections.get(cellId);
      const spanEl = sec.labelEl.querySelector('span');
      if (spanEl && cellLabel) spanEl.textContent = cellLabel;
      if (lang) sec.lang = lang;
      sec.bodyEl.innerHTML = '';
      return sec;
    }
    nbOutputPlaceholder.style.display = 'none';

    const sectionEl = document.createElement('div');
    sectionEl.className = 'cds-output-section';
    sectionEl.dataset.cellId = cellId;

    const labelEl = document.createElement('div');
    labelEl.className = 'cds-output-section-label';

    const labelInner = document.createElement('div');
    labelInner.className = 'cds-output-section-label-text';
    const labelSpan = document.createElement('span');
    labelSpan.textContent = cellLabel ?? '';
    labelInner.appendChild(labelSpan);
    labelEl.appendChild(labelInner);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'cds-output-section-close';
    closeBtn.title = 'Dismiss';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => {
      sectionEl.remove();
      nbSections.delete(cellId);
      if (nbSections.size === 0) nbOutputPlaceholder.style.display = '';
    });
    labelEl.appendChild(closeBtn);

    const bodyEl = document.createElement('div');
    bodyEl.className = 'cds-output-section-body';

    sectionEl.append(labelEl, bodyEl);
    nbOutputBody.appendChild(sectionEl);

    const sec = { sectionEl, labelEl, bodyEl, lang: lang ?? '' };
    nbSections.set(cellId, sec);
    return sec;
  }

  document.addEventListener('notebook-cells-reordered', ({ detail: { order } }) => {
    if (!Array.isArray(order)) return;
    order.forEach((cellId, idx) => {
      const sec = nbSections.get(cellId);
      if (!sec) return;
      nbOutputBody.appendChild(sec.sectionEl);
      const spanEl = sec.labelEl.querySelector('span');
      if (spanEl && sec.lang) spanEl.textContent = `Cell ${idx + 1} · ${sec.lang}`;
    });
  });

  nbOutClearBtn.addEventListener('click', () => {
    nbOutputBody.innerHTML = '';
    nbSections.clear();
    nbOutputPlaceholder.style.display = '';
  });

  document.addEventListener('notebook-clear-output', () => {
    nbOutputBody.innerHTML = '';
    nbSections.clear();
    nbOutputPlaceholder.style.display = '';
  });

  nbOutMaxBtn.addEventListener('click', () => {
    const isMax = nbOutputPanel.dataset.expanded === '1';
    if (isMax) {
      nbOutputPanel.style.width = nbOutputPanel.dataset.prevWidth || (savedNbOutW + 'px');
      nbOutputPanel.style.flex  = 'none';
      delete nbOutputPanel.dataset.expanded;
      nbOutMaxBtn.textContent = '⤢';
      nbOutMaxBtn.title = 'Maximize';
    } else {
      nbOutputPanel.dataset.prevWidth = nbOutputPanel.style.width;
      nbOutputPanel.dataset.expanded  = '1';
      const maxW = notebookView.getBoundingClientRect().width * 0.75;
      nbOutputPanel.style.width = Math.round(maxW) + 'px';
      nbOutputPanel.style.flex  = 'none';
      nbOutMaxBtn.textContent = '⤡';
      nbOutMaxBtn.title = 'Restore';
    }
  });

  nbOutMinBtn.addEventListener('click', () => {
    nbOutputPanel.style.display = 'none';
  });

  document.addEventListener('compile-result', ({ detail }) => {
    nbOutputPanel.style.display = '';
  });

  document.addEventListener('compile-result', ({ detail }) => {
    if (!detail.cellId) return;
    const { outputs, cellId, cellLabel, sourceCode, sourceLang } = detail;
    const sec = getOrCreateNbSection(cellId, cellLabel, sourceLang);
    renderBlocks(outputs, sec.bodyEl, {
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
          lbl.textContent = '小梦 suggests:';
          const bodyEl = document.createElement('div');
          bodyEl.className = 'ai-explanation-body';
          explDiv.append(lbl, bodyEl);
          block.after(explDiv);
          lbl.appendChild(createRefactorBtn({ sourceCode, sourceLang, cellId, explanation }));
          renderBlocks(parseAIResponse(explanation), bodyEl);
        } catch { /* ignore */ }
        finally { btn.disabled = false; btn.textContent = 'Ask AI'; }
      },
    });
    requestAnimationFrame(() =>
      sec.sectionEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    );
  });

  // ── Chat-mode placeholder ─────────────────────────────
  const chatPlaceholder = document.createElement('div');
  chatPlaceholder.className = 'cds-chat-placeholder';
  chatPlaceholder.innerHTML =
    '<span class="cds-chat-placeholder-icon">💬</span>' +
    '<span class="cds-chat-placeholder-text">Chat 模式 — 小梦在右侧面板等你~</span>';
  document.getElementById('coding-screen-body').appendChild(chatPlaceholder);

  // ── Switch between views ──────────────────────────────
  function applyMode(mode) {
    const isCustomise = mode === 'customise';
    const isChat      = mode === 'ai_chat';
    const isSingle    = !isCustomise && !isChat;
    singleView.style.display      = isSingle    ? 'flex' : 'none';
    notebookView.style.display    = isCustomise ? 'flex' : 'none';
    chatPlaceholder.style.display = isChat      ? 'flex' : 'none';
    screen.classList.toggle('mode-single', isSingle);
    if (!isChat) editor.placeholder = PLACEHOLDERS[mode] ?? PLACEHOLDERS.python;
  }

  applyMode(getCurrentMode());
  document.addEventListener('compiler-mode-change', ({ detail }) => {
    applyMode(detail.mode);
    syncICM(detail.mode);
  });

  // ── Single-cell events ────────────────────────────────
  editor.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const s = editor.selectionStart;
    editor.value = editor.value.slice(0, s) + '    ' + editor.value.slice(editor.selectionEnd);
    editor.selectionStart = editor.selectionEnd = s + 4;
  });

  let _saveTimer = null;
  editor.addEventListener('input', () => {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => localStorage.setItem(CODE_KEY, editor.value), 400);
  });

  async function run() {
    const code = editor.value.trim();
    if (!code) return;
    editor.blur(); // dismiss iOS keyboard before running so the tap registers cleanly
    const mode = getCurrentMode();

    if (mode === 'python' && /\binput\s*\(/.test(code)) {
      document.dispatchEvent(new CustomEvent('run-in-terminal', { detail: { code } }));
      return;
    }

    runBtn.disabled = true;
    try {
      const outputs = await compile(code, mode);
      document.dispatchEvent(new CustomEvent('compile-result', { detail: { outputs, sourceCode: code, sourceLang: mode } }));
    } catch (err) {
      const errText = err instanceof Error ? err.message : String(err);
      document.dispatchEvent(new CustomEvent('compile-result', { detail: {
        outputs: [{ type: 'error', text: errText }],
        sourceCode: code,
        sourceLang: mode,
      }}));
    } finally {
      runBtn.disabled = false;
    }
  }

  runBtn.addEventListener('click', run);

  editor.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); }
  });

  // Clear single-cell editor when clear-active-code fires in a non-notebook mode
  document.addEventListener('clear-active-code', () => {
    const m = getCurrentMode();
    if (m === 'customise' || m === 'ai_chat') return;
    editor.value = '';
    editor.dispatchEvent(new Event('input'));
    localStorage.removeItem(CODE_KEY);
  });

  // Handle ai-insert-and-run (single-view only; notebook handled by customise_code_block)
  document.addEventListener('ai-insert-and-run', ({ detail: { code } }) => {
    const m = getCurrentMode();
    if (m === 'ai_chat' || m === 'customise') return;
    editor.value = code;
    localStorage.setItem(CODE_KEY, code);
    editor.dispatchEvent(new Event('input'));
    run();
  });

  // Handle refactor-code
  document.addEventListener('refactor-code', ({ detail: { code, cellId } }) => {
    if (cellId === '__standalone__') {
      editor.value = code;
      localStorage.setItem(CODE_KEY, code);
      editor.dispatchEvent(new Event('input'));
    } else {
      setCellCode(cellId, code);
    }
  });

}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupCodingScreen);
} else {
  setupCodingScreen();
}
