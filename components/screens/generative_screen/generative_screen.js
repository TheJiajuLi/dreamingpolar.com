import { compile } from '../../compiler/compiler.js';
import { renderBlocks, parseAIResponse } from '../compiling_screen/compiling_screen_utility.js';
import { ask, systemExplainForLang } from '../../ai/ai_client.js';
import { createRefactorBtn } from '../compiling_screen/refactorization_button/refactorization_button.js';
import { setCodeBlockRendererFn } from '../../terminal/terminal_ai.js';
import { createAiCodeBlock } from '../../terminal/terminal_ai_code_block.js';

const CODE_KEY = 'dp-gen-code';

const PLACEHOLDER = `# Example — try running this:
from sympy import symbols, expand, latex
x = symbols('x')
expand((x + 1)**4)

# SymPy, matplotlib, pandas & numpy are preloaded.
# Ctrl/Cmd+Enter to run.`;

const COPY_ICON  = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
const CLEAR_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4h8v2"/></svg>`;

function setupGenerativeScreen() {
  const screen = document.getElementById('generative-screen');
  if (!screen) return;

  // ── Terminal panel fills the whole screen ─────────────────────
  const terminalPanel = document.createElement('section');
  terminalPanel.id        = 'terminal-panel';
  terminalPanel.className = 'gen-terminal-strip';

  // ── Toolbar ──────────────────────────────────────────────────
  const toolbar = document.createElement('div');
  toolbar.className = 'gen-toolbar';

  const copyBtn = document.createElement('button');
  copyBtn.className = 'lus-copy-btn gen-toolbar-btn';
  copyBtn.title     = 'Copy source';
  copyBtn.innerHTML = COPY_ICON;

  const clearEditorBtn = document.createElement('button');
  clearEditorBtn.className = 'sc-btn gen-toolbar-btn';
  clearEditorBtn.title     = 'Clear editor';
  clearEditorBtn.innerHTML = CLEAR_ICON;

  const runBtn = document.createElement('button');
  runBtn.className = 'nb-btn nb-run gen-run-btn';
  runBtn.innerHTML = '&#9654;';
  runBtn.title     = 'Run (Ctrl+Enter)';

  const toolbarRight = document.createElement('div');
  toolbarRight.className = 'gen-toolbar-right';
  toolbarRight.append(copyBtn, clearEditorBtn, runBtn);
  toolbar.append(toolbarRight);

  // ── Code panel (lives inside #terminal-output after terminal.js init) ──
  const codePanel = document.createElement('div');
  codePanel.className = 'gen-code-panel';

  const editorWrap = document.createElement('div');
  editorWrap.className = 'code-editor-area gen-editor-wrap';

  const editor = document.createElement('textarea');
  editor.className    = 'code-editor';
  editor.spellcheck   = false;
  editor.autocorrect  = 'off';
  editor.autocomplete = 'off';
  editor.setAttribute('autocapitalize', 'none');
  editor.setAttribute('inputmode', 'text');
  editor.placeholder  = PLACEHOLDER;
  editor.value        = localStorage.getItem(CODE_KEY) ?? '';
  editorWrap.appendChild(editor);
  codePanel.appendChild(editorWrap);

  // ── Output panel (lives inside .terminal-body, above input row) ──
  const outputPanel = document.createElement('div');
  outputPanel.className    = 'gen-output-panel';
  outputPanel.style.display = 'none';

  const outputHdr = document.createElement('div');
  outputHdr.className = 'gen-output-panel-hdr';

  const outputLabel = document.createElement('span');
  outputLabel.className   = 'gen-output-panel-label';
  outputLabel.textContent = 'OUTPUT';

  const outClearBtn = document.createElement('button');
  outClearBtn.className   = 'sc-btn';
  outClearBtn.title       = 'Clear output';
  outClearBtn.textContent = '⊘';

  const outMinBtn = document.createElement('button');
  outMinBtn.className   = 'sc-btn';
  outMinBtn.title       = 'Hide';
  outMinBtn.textContent = '−';

  const outToolbarEl = document.createElement('div');
  outToolbarEl.className = 'sc-toolbar';
  outToolbarEl.append(outClearBtn, outMinBtn);

  outputHdr.append(outputLabel, outToolbarEl);

  const outputBody = document.createElement('div');
  outputBody.className = 'gen-output-body';

  outputPanel.append(outputHdr, outputBody);

  // ── Assemble ──────────────────────────────────────────────────
  screen.append(toolbar, terminalPanel);

  // ── Register with screen controller ──────────────────────────
  requestAnimationFrame(() => {
    window.screenController?.register('terminal', screen, { label: 'Terminal', persisted: true, noChip: true, group: 'hero' });
  });

  // ── Inject after terminal.js initialises — retry until all elements exist ────
  function _tryInject() {
    const termOutput   = document.getElementById('terminal-output');
    const termBody     = terminalPanel.querySelector('.terminal-body');
    const termInputRow = termBody?.querySelector('.terminal-input-row');
    if (!termBody || !termInputRow || !termOutput) { requestAnimationFrame(_tryInject); return; }
    _doInject(termOutput, termBody, termInputRow);
  }
  function _doInject(termOutput, termBody, termInputRow) {

    // ── Drag-resize handle between editor and ARIA output ─────────────────
    const editorResizeHandle = document.createElement('div');
    editorResizeHandle.className = 'gen-editor-resize-handle';
    codePanel.append(editorResizeHandle, outputPanel, termOutput);

    let _rStartY = 0, _rStartH = 0;
    const _startResize = (startY) => {
      _rStartY = startY;
      _rStartH = editorWrap.getBoundingClientRect().height;
      document.body.style.cursor    = 'row-resize';
      document.body.style.userSelect = 'none';
      const onMove = (clientY) => {
        const panelH = termBody.getBoundingClientRect().height;
        const maxH   = Math.max(120, panelH * 0.72);
        const newH   = Math.max(56, Math.min(_rStartH + (clientY - _rStartY), maxH));
        editorWrap.style.height = newH + 'px';
      };
      const onUp = () => {
        document.body.style.cursor    = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup',   onMouseUp);
        document.removeEventListener('touchmove', onTouchMove);
        document.removeEventListener('touchend',  onTouchEnd);
      };
      const onMouseMove = e => onMove(e.clientY);
      const onMouseUp   = () => onUp();
      const onTouchMove = e => { e.preventDefault(); onMove(e.touches[0].clientY); };
      const onTouchEnd  = () => onUp();
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup',   onMouseUp);
      document.addEventListener('touchmove', onTouchMove, { passive: false });
      document.addEventListener('touchend',  onTouchEnd);
    };
    editorResizeHandle.addEventListener('mousedown', e => { e.preventDefault(); _startResize(e.clientY); });
    editorResizeHandle.addEventListener('touchstart', e => { e.preventDefault(); _startResize(e.touches[0].clientY); }, { passive: false });

    // Put gen-code-panel into terminal-body above the input row
    termBody.insertBefore(codePanel, termInputRow);

    // ── Register ARIA code block renderer ─────────────────────────────
    setCodeBlockRendererFn((lang, code) => {
      const card = createAiCodeBlock(lang, code, {
        onInsert: (src) => {
          editor.value = src;
          editor.dispatchEvent(new Event('input'));
          // Flash the editor to signal insertion
          editor.classList.add('aria-inserted');
          setTimeout(() => editor.classList.remove('aria-inserted'), 600);
        },
      });
      termOutput.appendChild(card);
      termOutput.scrollTop = termOutput.scrollHeight;
    });
  }
  requestAnimationFrame(_tryInject);

  // ── ARIA: run editor code from 'run' terminal command ────────────────────────
  document.addEventListener('aria-run-editor-code', async ({ detail: { code } }) => {
    const st = window.screenController?.getState('terminal');
    if (st !== 'normal' && st !== 'maximized') return;
    outputPanel.style.display = '';
    outputBody.innerHTML = '';
    try {
      const outputs = await compile(code, 'python');
      renderBlocks(outputs, outputBody);
    } catch (e) {
      const errDiv = document.createElement('div');
      errDiv.className = 'output-block output-error';
      errDiv.innerHTML = `<div class="output-text">${String(e)}</div>`;
      outputBody.appendChild(errDiv);
    }
  });

  // ── Ctrl+Shift+A in editor → ask ARIA about current code ─────────────────────
  editor.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'a') {
      e.preventDefault();
      const termInput = document.getElementById('terminal-input');
      if (!termInput) return;
      const code = editor.value.trim();
      if (code) {
        termInput.value = `ai Explain or improve this code: \`\`\`python\n${code.slice(0, 400)}\n\`\`\``;
      } else {
        termInput.value = 'ai ';
      }
      termInput.focus();
      termInput.setSelectionRange(termInput.value.length, termInput.value.length);
    }
  });

  // ── Toolbar actions ───────────────────────────────────────────
  copyBtn.addEventListener('click', async () => {
    const code = editor.value;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      copyBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
      copyBtn.classList.add('lus-copy-btn--done');
      setTimeout(() => { copyBtn.innerHTML = COPY_ICON; copyBtn.classList.remove('lus-copy-btn--done'); }, 1600);
    } catch (_) {}
  });

  clearEditorBtn.addEventListener('click', () => {
    editor.value = '';
    localStorage.removeItem(CODE_KEY);
    editor.focus();
  });

  outClearBtn.addEventListener('click', () => { outputBody.innerHTML = ''; });
  outMinBtn.addEventListener('click',   () => { outputPanel.style.display = 'none'; });

  document.addEventListener('compile-result', () => { outputPanel.style.display = ''; });

  // ── Compile & run ─────────────────────────────────────────────
  async function run() {
    const code = editor.value.trim();
    if (!code) return;
    localStorage.setItem(CODE_KEY, editor.value);

    runBtn.disabled           = true;
    outputPanel.style.display = '';
    outputBody.innerHTML      = '';

    try {
      const outputs = await compile(code, 'python');
      renderBlocks(outputs, outputBody, {
        onAskAI: async (errorText, block, btn) => {
          btn.disabled = true;
          btn.textContent = 'Thinking…';
          try {
            const ctx = `Code (python):\n${code}\n\nError:\n${errorText}`;
            const explanation = await ask(ctx, systemExplainForLang('python'), 512);
            const explDiv = document.createElement('div');
            explDiv.className = 'output-ai-explanation';
            const lbl    = document.createElement('div');
            lbl.className = 'ai-explanation-label';
            lbl.textContent = '小梦 suggests:';
            const bodyEl = document.createElement('div');
            bodyEl.className = 'ai-explanation-body';
            explDiv.append(lbl, bodyEl);
            block.after(explDiv);
            lbl.appendChild(createRefactorBtn({ sourceCode: code, sourceLang: 'python', explanation }));
            renderBlocks(parseAIResponse(explanation), bodyEl);
          } catch { /* ignore */ }
          finally { btn.disabled = false; btn.textContent = 'Ask AI'; }
        },
      });
    } catch (e) {
      const errDiv = document.createElement('div');
      errDiv.className = 'output-block output-error';
      errDiv.innerHTML = `<div class="output-text">${String(e)}</div>`;
      outputBody.appendChild(errDiv);
    }

    runBtn.disabled = false;
  }

  runBtn.addEventListener('click', run);
  editor.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); }
  });
  editor.addEventListener('input', () => localStorage.setItem(CODE_KEY, editor.value));

  document.addEventListener('ai-insert-and-run', ({ detail: { code, lang } }) => {
    const st = window.screenController?.getState('terminal');
    if (st !== 'normal' && st !== 'maximized') return;
    outputPanel.style.display = '';
    if (lang === 'python') {
      editor.value = code;
      localStorage.setItem(CODE_KEY, code);
      run();
      return;
    }
    outputBody.innerHTML = '';
    const type = (lang === 'mathjax' || lang === 'latex') ? 'latex'
               : lang === 'html' ? 'html'
               : 'text';
    renderBlocks([{ type, content: code }], outputBody);
  });

}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupGenerativeScreen);
} else {
  setupGenerativeScreen();
}
