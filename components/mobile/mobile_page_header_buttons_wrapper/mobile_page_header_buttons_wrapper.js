// ── Mobile Header Buttons Wrapper ────────────────────────────────────────────
//  Runs after theme_controller, font_switcher, and language_selector have
//  appended their buttons to <header>. Moves all three into a single
//  grid-trigger dropdown for mobile. On desktop the dropdown is always
//  open (trigger hidden) so layout is unchanged.

import { clearAllCaches, getCacheEntries } from '../../storage_controller/storage_controller.js';

const GRID_ICON = `<svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor" aria-hidden="true">
  <rect x="0.5"  y="0.5"  width="4" height="4" rx="1"/>
  <rect x="5.5"  y="0.5"  width="4" height="4" rx="1"/>
  <rect x="10.5" y="0.5"  width="4" height="4" rx="1"/>
  <rect x="0.5"  y="5.5"  width="4" height="4" rx="1"/>
  <rect x="5.5"  y="5.5"  width="4" height="4" rx="1"/>
  <rect x="10.5" y="5.5"  width="4" height="4" rx="1"/>
  <rect x="0.5"  y="10.5" width="4" height="4" rx="1"/>
  <rect x="5.5"  y="10.5" width="4" height="4" rx="1"/>
  <rect x="10.5" y="10.5" width="4" height="4" rx="1"/>
</svg>`;

const ICON_TERMINAL = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`;

function setupMobHeaderWrapper() {
  const header = document.querySelector('header.page-header');
  if (!header) return;

  const themeBtn = header.querySelector('.theme-controller');
  const langWrap = header.querySelector('.lang-btn-wrapper');
  const fontBtn  = header.querySelector('.font-switcher-btn');
  if (!themeBtn && !langWrap && !fontBtn) return;

  // ── Build structure ───────────────────────────────────────────────────────
  const outerWrap = document.createElement('div');
  outerWrap.className = 'mob-hdr-btns-wrapper';

  const trigger = document.createElement('button');
  trigger.className = 'mob-hdr-btns-trigger';
  trigger.setAttribute('aria-label', 'Display settings');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.innerHTML = GRID_ICON;

  const dropdown = document.createElement('div');
  dropdown.className = 'mob-hdr-btns-dropdown';
  dropdown.setAttribute('aria-hidden', 'true');

  // ── Cache cell ────────────────────────────────────────────────────────────
  const cacheBtn = document.createElement('button');
  cacheBtn.className = 'mob-hdr-cache-btn';
  cacheBtn.setAttribute('aria-label', '清除缓存');
  cacheBtn.textContent = '⊘';

  // Confirmation shelf (hidden until cacheBtn is tapped)
  const cacheShelf = document.createElement('div');
  cacheShelf.className = 'mob-hdr-cache-shelf';
  cacheShelf.innerHTML = `
    <span class="mob-hdr-cache-shelf-msg"></span>
    <button class="mob-hdr-cache-yes">是</button>
    <button class="mob-hdr-cache-no">否</button>
  `;

  function showShelf() {
    const count = getCacheEntries().length;
    cacheShelf.querySelector('.mob-hdr-cache-shelf-msg').textContent =
      `清除 ${count} 条缓存记录？`;
    cacheShelf.classList.add('visible');
    cacheBtn.classList.add('active');
  }

  function hideShelf() {
    cacheShelf.classList.remove('visible');
    cacheBtn.classList.remove('active');
  }

  cacheBtn.addEventListener('click', () => {
    if (cacheShelf.classList.contains('visible')) { hideShelf(); return; }
    showShelf();
  });

  cacheShelf.querySelector('.mob-hdr-cache-yes').addEventListener('click', () => {
    clearAllCaches();
    hideShelf();
    close();
    location.reload();
  });

  cacheShelf.querySelector('.mob-hdr-cache-no').addEventListener('click', () => {
    hideShelf();
  });

  // ── Terminal cell (mobile only) ───────────────────────────────────────────
  const termBtn = document.createElement('button');
  termBtn.className = 'dp-terminal-toolbar-btn mob-hdr-terminal-btn';
  termBtn.setAttribute('aria-label', '终端');
  termBtn.innerHTML = ICON_TERMINAL;
  termBtn.addEventListener('click', () => {
    const state = window.screenController?.getState('terminal');
    if (state === 'closed' || !state) {
      window.screenController?.open('terminal');
      // Immediately maximise on mobile so the terminal is full-screen on open
      requestAnimationFrame(() => {
        const panel = document.getElementById('terminal-panel');
        if (panel && !panel.classList.contains('terminal--max')) {
          panel.classList.add('terminal--max');
          const maxBtn = panel.querySelector('.term-max-btn');
          if (maxBtn) maxBtn.textContent = '⤡';
        }
      });
    } else {
      window.screenController?.close('terminal');
    }
    close();
  });

  // Sync active state when terminal opens/closes
  document.addEventListener('screen-opened',  ({ detail }) => { if (detail?.id === 'terminal') termBtn.classList.add('active');    });
  document.addEventListener('screen-closed',  ({ detail }) => { if (detail?.id === 'terminal') termBtn.classList.remove('active'); });

  // Wrap each button in a labelled cell
  const CELL_DEFS = [
    { el: themeBtn,  label: '主题' },
    { el: langWrap,  label: '语言' },
    { el: fontBtn,   label: '字体' },
    { el: termBtn,   label: '终端' },
    { el: cacheBtn,  label: '缓存', cls: 'mob-hdr-cache-cell' },
  ];

  CELL_DEFS.forEach(({ el, label, cls }) => {
    if (!el) return;
    const cell = document.createElement('div');
    cell.className = 'mob-hdr-btn-cell' + (cls ? ` ${cls}` : '');
    const lbl = document.createElement('span');
    lbl.className   = 'mob-hdr-btn-label';
    lbl.textContent = label;
    cell.appendChild(el);
    cell.appendChild(lbl);
    dropdown.appendChild(cell);
  });

  dropdown.appendChild(cacheShelf);

  outerWrap.appendChild(trigger);
  outerWrap.appendChild(dropdown);
  header.appendChild(outerWrap);

  // ── Toggle ────────────────────────────────────────────────────────────────
  let isOpen = false;

  function open() {
    isOpen = true;
    outerWrap.classList.add('open');
    trigger.setAttribute('aria-expanded', 'true');
    dropdown.setAttribute('aria-hidden', 'false');
  }

  function close() {
    isOpen = false;
    outerWrap.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
    dropdown.setAttribute('aria-hidden', 'true');
    hideShelf();
  }

  trigger.addEventListener('click', e => {
    e.stopPropagation();
    isOpen ? close() : open();
  });

  document.addEventListener('click', e => {
    if (isOpen && !outerWrap.contains(e.target)) close();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && isOpen) close();
  });
}

// Modules are deferred — by the time this runs, theme/font/lang buttons
// are already in the DOM (no DOMContentLoaded listener needed).
setupMobHeaderWrapper();
