import { executeCommand, consumeAiPending } from './terminal_commands.js';
import { consumeAiChat, isAiChatActive, exitAiChat, setConfirmFn, setStreamLineFn } from './terminal_ai.js';

const ICON_TERMINAL = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="12" cy="6" rx="7" ry="2.5"/><path d="M5 6v4c0 1.38 3.13 2.5 7 2.5s7-1.12 7-2.5V6"/><path d="M5 10v4c0 1.38 3.13 2.5 7 2.5s7-1.12 7-2.5v-4"/><path d="M5 14v3c0 1.38 3.13 2.5 7 2.5s7-1.12 7-2.5v-3"/></svg>`;
const ICON_CLEAR    = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4h8v2"/></svg>`;
const ICON_CLOSE    = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

let _toggleBtn     = null;
let _output        = null;
let _input         = null;
let _pendingConfirm = null; // set while waiting for y/n from user

export function openTerminal()  { window.screenController?.open('terminal'); }
export function closeTerminal() { window.screenController?.close('terminal'); }

function syncToggleBtn(open) {
  _toggleBtn?.classList.toggle('active', open);
}

// ── ANSI → HTML ────────────────────────────────────────────
const ANSI_MAP = { '1':'bold','2':'dim','31':'red','32':'green','33':'yellow','34':'blue','35':'magenta','36':'cyan' };

function ansiToHtml(raw) {
  const s = raw.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  let open = 0;
  const out = s.replace(/\x1b\[([0-9;]*)m/g, (_, c) => {
    if (c === '0' || c === '') { const close = '</span>'.repeat(open); open = 0; return close; }
    const cls = ANSI_MAP[c]; if (!cls) return '';
    open++; return `<span class="term-${cls}">`;
  });
  return out + '</span>'.repeat(open);
}

// ── Output helpers ─────────────────────────────────────────
export function printLine(text) {
  if (!_output) return;
  const div = document.createElement('div');
  div.className = 'term-line';
  div.innerHTML = ansiToHtml(text);
  _output.appendChild(div);
  _output.scrollTop = _output.scrollHeight;
}

export function clearOutput() {
  if (_output) _output.innerHTML = '';
}

// ── Command history ────────────────────────────────────────
const _history = [];
let   _histIdx  = -1;
let   _draft    = '';

// ── Status dot helpers ─────────────────────────────────────
function dotSet(cls) {
  const dot = document.getElementById('term-status-dot');
  if (!dot) return;
  dot.className = `terminal-status-dot${cls ? ' ' + cls : ''}`;
}

// ── Input handler ──────────────────────────────────────────
async function handleEnter() {
  const raw = _input?.value ?? '';
  if (_input) _input.value = '';
  const line = raw.trim();
  if (!line) return;

  const echo = document.createElement('div');
  echo.className = 'term-line term-echo';
  echo.innerHTML = `<span class="term-prompt-inline">›</span> ${line.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}`;
  _output?.appendChild(echo);

  // y/n confirmation gate — resolve and return without touching history
  if (_pendingConfirm) {
    const resolve = _pendingConfirm;
    _pendingConfirm = null;
    resolve(line.toLowerCase() === 'y');
    _output && (_output.scrollTop = _output.scrollHeight);
    return;
  }

  if (_history[_history.length - 1] !== line) _history.push(line);
  _histIdx = -1;
  _draft   = '';

  dotSet('running');
  try {
    if (!await consumeAiChat(line, printLine) && !consumeAiPending(line, printLine)) {
      await executeCommand(line, printLine);
    }
  } catch (e) {
    if (String(e) === '__CLEAR__') { clearOutput(); dotSet(''); return; }
    printLine(`\x1b[31m${String(e)}\x1b[0m`);
  }

  // Brief green pulse on completion, then back to idle
  dotSet('waiting');
  setTimeout(() => dotSet(''), 800);

  _output && (_output.scrollTop = _output.scrollHeight);
}

// ── Toolbar toggle button (injected into coding-toolbar) ───
function injectToggleBtn() {
  _toggleBtn = document.createElement('button');
  _toggleBtn.className = 'dp-terminal-toolbar-btn';
  _toggleBtn.title     = 'Toggle ARIA';
  _toggleBtn.innerHTML = ICON_TERMINAL;
  _toggleBtn.addEventListener('click', () => {
    const state = window.screenController?.getState('terminal');
    if (state === 'closed' || !state) {
      openTerminal();
    } else {
      closeTerminal();
    }
  });

  const vtTop = document.querySelector('#vertical-toolbar .vt-top');
  if (vtTop) vtTop.appendChild(_toggleBtn);
}

// ── Resize handle ──────────────────────────────────────────
function setupResizeHandle(panel) {
  const handle = panel.querySelector('.terminal-resize-handle');
  if (!handle) return;

  let startY = 0, startH = 0;
  handle.addEventListener('mousedown', e => {
    startY = e.clientY;
    startH = panel.offsetHeight;
    handle.classList.add('dragging');
    e.preventDefault();

    const onMove = mv => {
      const newH = Math.max(80, Math.min(startH + (startY - mv.clientY), window.innerHeight * 0.75));
      document.documentElement.style.setProperty('--terminal-h', newH + 'px');
    };
    const onUp = () => {
      handle.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

// ── Panel setup ────────────────────────────────────────────
function setup() {
  const panel = document.getElementById('terminal-panel');
  if (!panel) return;

  const content = document.createElement('div');
  content.className = 'terminal-content';
  content.innerHTML = `
    <div class="terminal-resize-handle"></div>
    <div class="terminal-header">
      <span class="terminal-label">
        <span class="terminal-status-dot" id="term-status-dot"></span>
        <img src="/assets/icons/start_data_analysis/start_data_analysis.png" width="13" height="13" style="object-fit:contain;display:inline-block;vertical-align:middle;pointer-events:none" alt="" aria-hidden="true">
        ARIA
      </span>
      <div class="sc-toolbar">
        <button class="sc-btn term-max-btn" title="Expand">⤢</button>
      </div>
    </div>
    <div class="terminal-body">
      <div class="terminal-output" id="terminal-output"></div>
      <div class="terminal-input-row">
        <span class="terminal-prompt">›</span>
        <input class="terminal-input" id="terminal-input" type="text"
               autocomplete="off" spellcheck="false" placeholder="type a command or ask ARIA…">
      </div>
    </div>
  `;
  panel.prepend(content);

  _output = document.getElementById('terminal-output');
  _input  = document.getElementById('terminal-input');

  setStreamLineFn(() => {
    const div = document.createElement('div');
    div.className = 'term-line';
    _output?.appendChild(div);
    if (_output) _output.scrollTop = _output.scrollHeight;
    return {
      update(text) {
        div.innerHTML = ansiToHtml(text);
        if (_output) _output.scrollTop = _output.scrollHeight;
      },
    };
  });

  setConfirmFn((question, print) => new Promise(resolve => {
    print(question);
    if (_input) _input.placeholder = 'y / n';
    _pendingConfirm = (confirmed) => {
      if (_input) _input.placeholder = isAiChatActive() ? 'chat with ARIA… (Esc to exit)' : 'type a command…';
      resolve(confirmed);
    };
  }));

  // Registration is handled by generative_screen.js (#generative-screen → 'terminal')

  const startOpen = window.screenController?.getState('terminal') === 'normal';
  syncToggleBtn(startOpen);
  if (startOpen && window.innerWidth > 768) requestAnimationFrame(() => _input?.focus());

  injectToggleBtn();
  setupResizeHandle(panel);

  printLine('\x1b[36mARIA\x1b[0m  \x1b[2m—  AI-powered interactive terminal\x1b[0m');
  printLine("\x1b[2mType \x1b[0m'help'\x1b[2m for commands · \x1b[0m'ai <task>'\x1b[2m to generate · \x1b[0m'fix'\x1b[2m to debug\x1b[0m");
  printLine('');

  document.addEventListener('terminal-ai-mode', ({ detail: { active } }) => {
    if (_input) _input.placeholder = active ? 'chat with ARIA… (Esc to exit)' : 'type a command…';
  });

  _input?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); handleEnter(); return; }

    if (e.key === 'Escape' && isAiChatActive()) {
      e.preventDefault();
      exitAiChat(printLine);
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!_history.length) return;
      if (_histIdx === -1) { _draft = _input.value; _histIdx = _history.length - 1; }
      else if (_histIdx > 0) _histIdx--;
      _input.value = _history[_histIdx];
      _input.setSelectionRange(_input.value.length, _input.value.length);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (_histIdx === -1) return;
      _histIdx++;
      if (_histIdx >= _history.length) { _histIdx = -1; _input.value = _draft; }
      else _input.value = _history[_histIdx];
      _input.setSelectionRange(_input.value.length, _input.value.length);
      return;
    }
  });

  panel.querySelector('.term-clear-btn')?.addEventListener('click', clearOutput);
  panel.querySelector('.term-close-btn')?.addEventListener('click', closeTerminal);

  const termMaxBtn = panel.querySelector('.term-max-btn');

  function setMax(max) {
    panel.classList.toggle('terminal--max', max);
    if (termMaxBtn) termMaxBtn.textContent = max ? '⤡' : '⤢';
  }

  termMaxBtn?.addEventListener('click', () => {
    const isMax = !panel.classList.contains('terminal--max');
    setMax(isMax);
    if (isMax) requestAnimationFrame(() => _input?.focus());
  });

  // On mobile: auto-maximise when the input is focused so the user gets a
  // full-height terminal instead of a cramped sliver above the keyboard.
  _input?.addEventListener('focus', () => {
    if (window.innerWidth <= 768 && !panel.classList.contains('terminal--max')) {
      setMax(true);
    }
  });

  document.addEventListener('screen-opened', ({ detail }) => {
    if (detail.id !== 'terminal') return;
    syncToggleBtn(true);
    document.dispatchEvent(new CustomEvent('vt-btn-activated', { detail: { id: 'terminal' } }));
    if (window.innerWidth > 768) requestAnimationFrame(() => _input?.focus());
  });
  document.addEventListener('screen-closed', ({ detail }) => {
    if (detail.id === 'terminal') syncToggleBtn(false);
  });

  // Deactivate when another VT button claims the active slot
  document.addEventListener('vt-btn-activated', ({ detail: { id } }) => {
    if (id !== 'terminal') syncToggleBtn(false);
  });
}

// Retry until #terminal-panel exists — generative_screen.js may create it
// slightly after terminal.js runs due to module load order.
function trySetup() {
  if (document.getElementById('terminal-panel')) { setup(); return; }
  requestAnimationFrame(trySetup);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', trySetup);
} else {
  trySetup();
}
