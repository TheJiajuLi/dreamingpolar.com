// ── Kernel Boot Screen ────────────────────────────────────────────────────────
// Bloomberg Terminal-style overlay that surfaces Pyodide initialisation phases.
// Listens to 'compiler-status' events (dispatched by compiler.js).
// Shows ONLY during the one-time Python runtime init (status === 'loading').
// Auto-dismisses with a fade when status === 'ready'.
// Running/error states are handled by the existing bottom status bar.

const _PANEL_ID = 'kbs-panel';
const _LOG_ID   = 'kbs-log';
const _BAR_ID   = 'kbs-bar';

let _overlay = null;
let _log     = null;
let _bar     = null;
let _cursor  = null;
let _active  = false;   // true once the overlay has been mounted this session
let _done    = false;   // true after the first full boot cycle completes
                        // prevents re-triggering when compile() dispatches 'ready' later

// ── DOM builder ───────────────────────────────────────────────────────────────
function _mount() {
  if (_overlay) return;

  const el = document.createElement('div');
  el.id        = _PANEL_ID;
  el.className = 'kbs-overlay';
  el.setAttribute('role',      'status');
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('aria-label','Python runtime initialising');

  el.innerHTML = `
    <div class="kbs-panel">
      <div class="kbs-header">
        <span class="kbs-header-label">PYTHON RUNTIME</span>
        <span class="kbs-header-tag">INIT</span>
      </div>
      <div class="kbs-log" id="${_LOG_ID}"></div>
      <div class="kbs-progress-wrap">
        <div class="kbs-progress-bar" id="${_BAR_ID}"></div>
      </div>
      <div class="kbs-footer">
        numpy &nbsp;·&nbsp; pandas &nbsp;·&nbsp; matplotlib &nbsp;·&nbsp; sympy
      </div>
    </div>
  `;

  document.body.appendChild(el);
  _overlay = el;
  _log     = el.querySelector(`#${_LOG_ID}`);
  _bar     = el.querySelector(`#${_BAR_ID}`);
  _active  = true;
}

// ── Append a status line ──────────────────────────────────────────────────────
function _addLine(text) {
  if (!_log) return;

  // Remove cursor from previous line
  _cursor?.remove();
  _cursor = null;

  const line = document.createElement('div');
  line.className = 'kbs-line';
  line.innerHTML =
    `<span class="kbs-prompt" aria-hidden="true">&rsaquo;</span>` +
    `<span class="kbs-line-text">${_esc(text)}</span>`;

  const cur = document.createElement('span');
  cur.className   = 'kbs-cursor';
  cur.textContent = '█';
  cur.setAttribute('aria-hidden', 'true');
  line.appendChild(cur);
  _cursor = cur;

  _log.appendChild(line);
  _log.scrollTop = _log.scrollHeight;
}

function _esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Progress bar ──────────────────────────────────────────────────────────────
function _setProgress(pct) {
  if (_bar) _bar.style.width = `${pct}%`;
}

// ── Dismiss ───────────────────────────────────────────────────────────────────
function _dismiss() {
  if (!_overlay) return;
  _overlay.classList.add('kbs-overlay--done');
  const ref = _overlay;
  setTimeout(() => {
    ref.remove();
    if (_overlay === ref) { _overlay = _log = _bar = _cursor = null; }
  }, 550);
}

// ── compiler-status listener ──────────────────────────────────────────────────
document.addEventListener('compiler-status', ({ detail: { status, message, percent } }) => {
  // Once the first boot cycle is complete, ignore ALL subsequent events.
  // Every compile() call dispatches 'ready', which would otherwise re-trigger
  // dismiss/animation logic during the 550ms overlay fade-out window.
  if (_done) return;

  // Mount on first 'loading' event; ignore everything before that
  if (!_active && status !== 'loading') return;

  if (!_active && status === 'loading') {
    _mount();
  }

  switch (status) {
    case 'loading':
      _addLine(message);
      if (percent != null) _setProgress(percent);
      break;

    case 'ready':
      _addLine('Python ready');
      _setProgress(100);
      _done = true;  // mark done BEFORE scheduling dismiss
      setTimeout(_dismiss, 700);
      break;

    // 'running' / 'error' during normal execution: let the bottom bar handle it
    default:
      break;
  }
});
