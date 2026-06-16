import { compile } from '../../../compiler/compiler.js';
import { mountModeSwitcher, getCurrentMode } from '../../../compiler/compiler_mode_switcher/compiler_mode_switcher.js';
import { loadCode, saveCode } from './coding_screen_python_hooks.js';

const PLACEHOLDER = `# Example — try running this:
from sympy import symbols, expand, latex
x = symbols('x')
expand((x + 1)**4)

# SymPy, matplotlib, pandas & numpy are preloaded.
# Ctrl/Cmd+Enter to run.`;

export function init() {
  const body = document.getElementById('coding-screen-body');
  if (!body) return;

  // ── Toolbar ───────────────────────────────────────────
  const toolbar = document.createElement('div');
  toolbar.className = 'coding-toolbar';

  const modeSwitcherSlot = document.createElement('div');
  mountModeSwitcher(modeSwitcherSlot);
  toolbar.appendChild(modeSwitcherSlot);

  const runBtn = document.createElement('button');
  runBtn.className  = 'nb-btn nb-run';
  runBtn.innerHTML  = '&#9654;';
  runBtn.title      = 'Run (Ctrl+Enter)';
  toolbar.appendChild(runBtn);

  // ── Editor ────────────────────────────────────────────
  const editorWrap = document.createElement('div');
  editorWrap.className = 'code-editor-area';

  const editor = document.createElement('textarea');
  editor.className    = 'code-editor';
  editor.spellcheck   = false;
  editor.autocorrect  = 'off';
  editor.autocomplete = 'off';
  editor.placeholder  = PLACEHOLDER;
  editor.value        = loadCode();
  editorWrap.appendChild(editor);

  // ── Status bar ────────────────────────────────────────
  const statusBar = document.createElement('div');
  statusBar.className = 'compiler-status-bar';
  statusBar.textContent = 'Idle — Python loads on first run.';

  body.appendChild(toolbar);
  body.appendChild(editorWrap);
  body.appendChild(statusBar);

  // ── Tab key ───────────────────────────────────────────
  editor.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const s = editor.selectionStart;
    const v = editor.value;
    editor.value = v.slice(0, s) + '    ' + v.slice(editor.selectionEnd);
    editor.selectionStart = editor.selectionEnd = s + 4;
  });

  // ── Persist code across refreshes ────────────────────
  let _saveTimer = null;
  editor.addEventListener('input', () => {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => saveCode(editor.value), 400);
  });

  // ── Compiler status → status bar ─────────────────────
  document.addEventListener('compiler-status', ({ detail }) => {
    const spinning = detail.status === 'loading' || detail.status === 'running';
    statusBar.className = `compiler-status-bar ${detail.status}`;
    if (detail.percent != null) statusBar.style.setProperty('--pct', `${detail.percent}%`);
    const pctLabel = (detail.percent != null && detail.status === 'loading')
      ? `<span class="status-pct">${detail.percent}%</span>` : '';
    statusBar.innerHTML = spinning
      ? `<span class="status-spinner"><i></i><i></i><i></i></span>${detail.message}${pctLabel}`
      : detail.message;
  });

  // ── Run ───────────────────────────────────────────────
  async function run() {
    const code = editor.value.trim();
    if (!code) return;
    runBtn.disabled = true;
    const mode    = getCurrentMode();
    const outputs = await compile(code, mode);
    runBtn.disabled = false;
    document.dispatchEvent(new CustomEvent('compile-result', { detail: { outputs, mode } }));
  }

  runBtn.addEventListener('click', run);
  editor.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); }
  });

}
