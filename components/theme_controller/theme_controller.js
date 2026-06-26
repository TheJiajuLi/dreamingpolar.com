const THEMES = ['light', 'dark', 'grey', 'aurora'];

// Inline SVG — uses currentColor so it inherits --hdr-btn-fg exactly,
// matching EN and Aa without any filter approximation.
// viewBox 0 0 24 24 rendered at 13×13; stroke-width scaled to ~1.55 effective px.
const SVG_PALETTE = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="2.85" stroke-linecap="round" stroke-linejoin="round"
  aria-hidden="true">
  <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.65-.75 1.65-1.69
    0-.44-.18-.84-.44-1.12-.29-.29-.44-.65-.44-1.13a1.64 1.64 0 0 1
    1.67-1.67h1.99c3.05 0 5.56-2.5 5.56-5.55C21.97 6.01 17.46 2 12 2z"/>
  <circle cx="8.5"  cy="7.5"  r="1.5" fill="currentColor" stroke="none"/>
  <circle cx="13.5" cy="6.5"  r="1.5" fill="currentColor" stroke="none"/>
  <circle cx="17.5" cy="10.5" r="1.5" fill="currentColor" stroke="none"/>
  <circle cx="6.5"  cy="12.5" r="1.5" fill="currentColor" stroke="none"/>
</svg>`;

let _idx  = 0;
let _anim = null;

function applyTheme(key) {
  document.documentElement.setAttribute('data-theme', key);
}

function _animateIcon(el) {
  _anim?.cancel();
  _anim = el.animate(
    [
      { transform: 'translateY(0)',     opacity: 1, easing: 'cubic-bezier(0.4, 0, 1, 1)' },
      { transform: 'translateY(-108%)', opacity: 0, offset: 0.30 },
      { transform: 'translateY(108%)',  opacity: 0, offset: 0.31, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
      { transform: 'translateY(0)',     opacity: 1 },
    ],
    { duration: 300, fill: 'none' },
  );
  _anim.onfinish = () => { _anim = null; };
}

function setupThemeController() {
  const saved = localStorage.getItem('theme') ?? 'light';
  _idx = Math.max(0, THEMES.indexOf(saved));
  applyTheme(THEMES[_idx]);

  // Expose cycle function for Settings panel
  window._dpCycleTheme = () => {
    _idx = (_idx + 1) % THEMES.length;
    const key = THEMES[_idx];
    applyTheme(key);
    localStorage.setItem('theme', key);
    document.dispatchEvent(new CustomEvent('dp-theme-changed', { detail: { theme: key } }));
  };
  window._dpThemeLabel = () => THEMES[_idx];
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupThemeController);
} else {
  setupThemeController();
}
