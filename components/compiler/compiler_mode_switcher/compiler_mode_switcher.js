// ── Compiler Mode Switcher ──────────────────────────────
// Renders a pill of mode buttons and exports getCurrentMode().

const MODES = [
  { id: 'python',    label: 'Python'    },
  { id: 'latex',     label: 'LaTeX'     },
  { id: 'mathjax',   label: 'MathJax'   },
  { id: 'markdown',  label: 'Markdown'  },
  { id: 'customise', label: 'Customise' },
];

const MODE_KEY = 'dreaming-polar-mode';

const _saved = localStorage.getItem(MODE_KEY);
let _currentMode = (MODES.some(m => m.id === _saved) ? _saved : 'python');

export function getCurrentMode() { return _currentMode; }

export function setMode(id) {
  if (!MODES.some(m => m.id === id) || id === _currentMode) return;
  _currentMode = id;
  localStorage.setItem(MODE_KEY, _currentMode);
  document.querySelectorAll('.compiler-mode-select').forEach(sel => { sel.value = id; });
  document.dispatchEvent(new CustomEvent('compiler-mode-change', { detail: { mode: id } }));
}

export function mountModeSwitcher(container) {
  const sel = document.createElement('select');
  sel.className = 'compiler-mode-select nb-lang-select';

  for (const m of MODES) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.label;
    if (m.id === _currentMode) opt.selected = true;
    sel.appendChild(opt);
  }

  sel.addEventListener('change', () => {
    _currentMode = sel.value;
    localStorage.setItem(MODE_KEY, _currentMode);
    document.querySelectorAll('.compiler-mode-select').forEach(s => { if (s !== sel) s.value = _currentMode; });
    document.dispatchEvent(new CustomEvent('compiler-mode-change', { detail: { mode: _currentMode } }));
  });

  container.appendChild(sel);
}
