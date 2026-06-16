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

  if (on) {
    showToast();
  } else {
    clearTimeout(_toastOut);
    document.querySelector('.dp-fs-toast')?.remove();
  }
}

// ── Mount into header ────────────────────────────────────
function mount() {
  const header = document.querySelector('.page-header');
  if (!header) return;

  _btn = document.createElement('button');
  _btn.className = 'dp-fullscreen-btn';
  _btn.title     = 'Fullscreen';
  _btn.setAttribute('aria-label', 'Toggle fullscreen');
  _btn.innerHTML = SVG_EXPAND;
  _btn.addEventListener('click', () => setFullscreen(!_active));

  const dropdown = header.querySelector('.mob-hdr-btns-dropdown');
  if (dropdown) {
    dropdown.insertBefore(_btn, dropdown.firstChild);
  } else {
    const wrapper = header.querySelector('.mob-hdr-btns-wrapper');
    wrapper ? header.insertBefore(_btn, wrapper) : header.appendChild(_btn);
  }
}

function setup() {
  requestAnimationFrame(() => requestAnimationFrame(mount));

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

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setup);
} else {
  setup();
}
