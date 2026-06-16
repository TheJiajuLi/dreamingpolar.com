import { preloadPython } from '../compiler/compiler.js';

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
         width="20" height="20" viewBox="0 0 20 20"
         fill="none" stroke="currentColor"
         stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"
         aria-hidden="true">
      <path d="M7 5.5L2.5 10 7 14.5"/>
      <path d="M13 5.5L17.5 10 13 14.5"/>
      <line x1="11.5" y1="4.5" x2="8.5" y2="15.5"/>
    </svg>`;

  vtTop.appendChild(btn);

  function syncActiveState() {
    const state = window.screenController?.getState('coding');
    const isOpen = state === 'normal' || state === 'maximized' || state === 'minimized';
    btn.classList.toggle('active', isOpen);
    btn.title = isOpen ? 'Close code editor' : 'Open code editor';
  }

  let _preloaded = false;
  btn.addEventListener('click', () => {
    if (!_preloaded) {
      _preloaded = true;
      preloadPython();
    }
    const state = window.screenController?.getState('coding');
    if (!state || state === 'closed') {
      window.screenController?.minimize('content');
      window.screenController?.open('coding');
    } else {
      window.screenController?.close('coding');
    }
  });

  document.addEventListener('screen-opened', ({ detail }) => {
    if (detail.id === 'coding') syncActiveState();
  });
  document.addEventListener('screen-closed', ({ detail }) => {
    if (detail.id === 'coding') syncActiveState();
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
