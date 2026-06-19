import { setMode } from '../compiler/compiler_mode_switcher/compiler_mode_switcher.js';

function setupStartCodingBtn() {
  const vtTop = document.querySelector('#vertical-toolbar .vt-top');
  if (!vtTop) return;

  const btn = document.createElement('button');
  btn.className = 'start-coding-btn';
  btn.id = 'start-coding-btn';
  btn.title = 'Open code editor';
  btn.setAttribute('aria-label', 'Toggle code editor');
  btn.innerHTML = `
    <svg class="start-coding-icon" xmlns="http://www.w3.org/2000/svg"
         width="20" height="20" viewBox="0 0 24 24"
         fill="none" stroke="currentColor"
         stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
         aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1"/>
      <rect x="14" y="3" width="7" height="7" rx="1"/>
      <rect x="3" y="14" width="7" height="7" rx="1"/>
      <rect x="14" y="14" width="7" height="7" rx="1"/>
      <line x1="10" y1="6.5" x2="14" y2="6.5"/>
      <line x1="6.5" y1="10" x2="6.5" y2="14"/>
      <line x1="17.5" y1="10" x2="17.5" y2="14"/>
      <line x1="10" y1="17.5" x2="14" y2="17.5"/>
    </svg>`;

  vtTop.appendChild(btn);

  function syncActiveState() {
    const state = window.screenController?.getState('coding');
    const isOpen = state === 'normal' || state === 'maximized';
    btn.classList.toggle('active', isOpen);
    btn.title = isOpen ? 'Close code editor' : 'Open code editor';
    if (isOpen) document.dispatchEvent(new CustomEvent('vt-btn-activated', { detail: { id: 'coding' } }));
  }

  btn.addEventListener('click', () => {
    const state = window.screenController?.getState('coding');
    if (!state || state === 'closed' || state === 'minimized') {
      window.screenController?.open('coding');
      setMode('customise');
    } else {
      window.screenController?.close('coding');
    }
  });

  document.addEventListener('screen-opened',   ({ detail }) => { if (detail.id === 'coding') syncActiveState(); });
  document.addEventListener('screen-closed',    ({ detail }) => { if (detail.id === 'coding') syncActiveState(); });
  document.addEventListener('screen-minimized', ({ detail }) => { if (detail.id === 'coding') syncActiveState(); });

  // Deactivate when another VT button claims the active slot
  document.addEventListener('vt-btn-activated', ({ detail: { id } }) => {
    if (id !== 'coding') btn.classList.remove('active');
  });

  // Sync after coding screen has had a chance to register (it uses rAF internally)
  requestAnimationFrame(() => requestAnimationFrame(syncActiveState));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupStartCodingBtn);
} else {
  setupStartCodingBtn();
}

// Inject @property immediately so the comet animation is ready before first click
(function injectCometProperty() {
  if (document.getElementById('sc-property')) return;
  const s = document.createElement('style');
  s.id = 'sc-property';
  s.textContent = `@property --sc-angle {
  syntax: '<angle>';
  initial-value: 0deg;
  inherits: false;
}`;
  document.head.appendChild(s);
}());
