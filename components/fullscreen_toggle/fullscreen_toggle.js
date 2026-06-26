const SVG_EXPAND = `<svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
  <path d="M1 4.5V1h3.5M8.5 1H12v3.5M12 8.5V12H8.5M4.5 12H1V8.5"
        stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const SVG_COLLAPSE = `<svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
  <path d="M4.5 1v3.5H1M12 4.5H8.5V1M8.5 12V8.5H12M1 8.5h3.5V12"
        stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

let _active        = false;
let _btn           = null;
let _toastOut      = null;   // setTimeout handle for removing toast
let _fsMaximizedId = null;   // screen we maximized on fullscreen enter

// ── Toast hint ───────────────────────────────────────────
const _isTouch = () => window.matchMedia('(pointer: coarse)').matches;

function showToast() {
  clearTimeout(_toastOut);
  document.querySelector('.dp-fs-toast')?.remove();

  const toast = document.createElement('div');
  toast.className = 'dp-fs-toast';
  toast.innerHTML = _isTouch()
    ? `Tap <kbd>⛶</kbd> to exit fullscreen`
    : `Press <kbd>Esc</kbd> to exit fullscreen`;
  document.body.appendChild(toast);

  // Trigger fade-out after 2.4 s, remove after 2.8 s
  _toastOut = setTimeout(() => {
    toast.classList.add('dp-fs-toast--out');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
    setTimeout(() => toast.remove(), 450);   // safety
  }, 2400);
}

// ── State ────────────────────────────────────────────────
function setFullscreen(on) {
  _active = on;
  document.body.classList.toggle('dp-fullscreen', on);

  if (_btn) {
    _btn.innerHTML = on ? SVG_COLLAPSE : SVG_EXPAND;
    _btn.title     = on ? 'Exit fullscreen' : 'Fullscreen';
  }

  const sc = window.screenController;
  if (on && sc) {
    // Maximize the first open screen so it fills the viewport
    for (const id of ['ai-chat', 'coding', 'content']) {
      if (sc.getState(id) === 'normal') {
        _fsMaximizedId = id;
        sc.maximize(id);
        break;
      }
    }
  } else if (!on && sc && _fsMaximizedId) {
    sc.restore(_fsMaximizedId);
    _fsMaximizedId = null;
  }

  _syncExitPill(on);
  if (on) {
    showToast();
  } else {
    clearTimeout(_toastOut);
    document.querySelector('.dp-fs-toast')?.remove();
  }
}

// ── Persistent fullscreen exit pill (always visible in fullscreen) ────────────
let _exitPill = null;

function _buildExitPill() {
  if (_exitPill) return;
  _exitPill = document.createElement('button');
  _exitPill.className = 'dp-fs-exit-pill';
  _exitPill.title = 'Exit fullscreen (Esc)';
  _exitPill.innerHTML = `${SVG_COLLAPSE}<span>退出全屏</span>`;
  _exitPill.addEventListener('click', () => setFullscreen(false));
  document.body.appendChild(_exitPill);
}

function _syncExitPill(on) {
  if (on) {
    _buildExitPill();
    requestAnimationFrame(() => _exitPill?.classList.add('dp-fs-exit-pill--visible'));
  } else if (_exitPill) {
    _exitPill.classList.remove('dp-fs-exit-pill--visible');
  }
}

function setup() {
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;

    // Don't steal Esc from focused inputs / dropdowns
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (document.activeElement?.isContentEditable) return;

    e.preventDefault();
    setFullscreen(!_active);   // toggle — Esc both exits and re-enters
  });
}

// Expose so other components (right bar, keyboard shortcuts) can toggle without importing
window._dpToggleFullscreen = () => setFullscreen(!_active);
window._dpIsFullscreen     = () => _active;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setup);
} else {
  setup();
}
