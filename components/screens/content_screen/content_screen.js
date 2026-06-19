import { escapeHtml, renderJson }                           from './content_screen_utility.js';
import { CONTENT_PATH_KEY, CONTENT_TITLE_KEY, CONTENT_CHAT_KEY,
         attachContentScreenHooks, restoreLastContent }     from './content_screen_hook.js';
import { getActivePersona, cyclePersona, PERSONAS }         from '../../ai/ai_persona_switch.js';

// ── Setup ──────────────────────────────────────────────
function setupContentScreen() {
  const hero = document.getElementById('content-screen');
  if (!hero) return;

  const _CLEAR_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/></svg>`;

  const clearChatBtn = document.createElement('button');
  clearChatBtn.className = 'cs-clear-chat-btn';
  clearChatBtn.title = 'Clear chat';
  clearChatBtn.innerHTML = _CLEAR_ICON;
  clearChatBtn.style.display = 'none';
  clearChatBtn.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('cs-chat-clear'));
  });

  const backBtn = document.createElement('button');
  backBtn.className = 'cs-back-btn sc-btn';
  backBtn.title = 'Back to navigation';
  backBtn.style.display = 'none';
  backBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 2 4 7 9 12"/></svg>`;
  backBtn.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('cs-back-to-nav'));
  });

  const labelEl = document.createElement('span');
  labelEl.className   = 'content-screen-label';
  labelEl.textContent = '';
  labelEl.style.display = 'none';

  const _CYCLE_SVG = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`;

  const personaBtn = document.createElement('button');
  personaBtn.className = 'aic-persona-btn cs-persona-btn';
  personaBtn.style.display = 'none';
  function syncPersonaBtn() {
    const p    = getActivePersona();
    const idx  = PERSONAS.findIndex(x => x.id === p.id);
    const next = PERSONAS[(idx + 1) % PERSONAS.length];
    personaBtn.innerHTML = `<span class="cs-persona-label">${p.label}</span>${_CYCLE_SVG}`;
    personaBtn.title = `Switch to ${next.label}`;
    personaBtn.dataset.personaId = p.id;
  }
  syncPersonaBtn();
  personaBtn.addEventListener('click', () => { cyclePersona(); syncPersonaBtn(); });
  document.addEventListener('ai-persona-changed', syncPersonaBtn);

  const header = document.createElement('div');
  header.className = 'content-screen-header';
  header.append(backBtn, labelEl);

  const body = document.createElement('div');
  body.className = 'content-screen-body';
  body.id        = 'content-screen-body';
  body.innerHTML = '<p class="content-loading"></p>';

  hero.classList.add('content-screen');
  hero.append(header, body);

  const getBody = () => document.getElementById('content-screen-body');

  attachContentScreenHooks(hero, getBody);

  // ── Width resizer ──────────────────────────────────────
  const CS_WIDTH_KEY = 'dp-cs-width';
  const CS_MIN_W     = 220;

  const savedW = parseFloat(localStorage.getItem(CS_WIDTH_KEY));
  if (savedW) {
    requestAnimationFrame(() => {
      const maxW = hero.parentElement?.getBoundingClientRect().width ?? Infinity;
      if (savedW <= maxW) {
        hero.style.width = savedW + 'px';
        hero.style.flex  = 'none';
      } else {
        localStorage.removeItem(CS_WIDTH_KEY);
      }
    });
  }

  const resizer = document.createElement('div');
  resizer.className = 'cs-resizer';
  resizer.title = 'Drag to resize · Double-click to reset';
  hero.appendChild(resizer);

  function _startResize(clientX) {
    const startX = clientX;
    const startW = hero.getBoundingClientRect().width;
    document.body.classList.add('cs-resizing');

    function onMove(ex) {
      const maxW = hero.parentElement.getBoundingClientRect().width * 1;
      const w    = Math.min(maxW, Math.max(CS_MIN_W, startW + ex - startX));
      hero.style.width = w + 'px';
      hero.style.flex  = 'none';
    }
    function onUp(ex) {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup',   onMouseUp);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend',  onTouchEnd);
      document.body.classList.remove('cs-resizing');
      onMove(ex);
      localStorage.setItem(CS_WIDTH_KEY, parseFloat(hero.style.width));
    }
    const onMouseMove = e => onMove(e.clientX);
    const onMouseUp   = e => onUp(e.clientX);
    const onTouchMove = e => { e.preventDefault(); onMove(e.touches[0].clientX); };
    const onTouchEnd  = e => onUp(e.changedTouches[0].clientX);

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup',   onMouseUp);
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend',  onTouchEnd);
  }

  resizer.addEventListener('mousedown',  e => { e.preventDefault(); _startResize(e.clientX); });
  resizer.addEventListener('touchstart', e => { e.preventDefault(); _startResize(e.touches[0].clientX); }, { passive: false });
  resizer.addEventListener('dblclick',   () => {
    hero.style.width = '';
    hero.style.flex  = '';
    localStorage.removeItem(CS_WIDTH_KEY);
  });

  // ── Three-view slots ───────────────────────────────────
  let _chatSlot      = null;
  let _navSlot       = null;
  let _navUsed       = false;
  let _currentPageTitle = null;

  const VIEW_LABELS = { nav: 'Navigation' };

  function _setView(name) {
    hero.classList.add('cs-active');
    getBody().style.display                = name === 'content' ? '' : 'none';
    if (_chatSlot) _chatSlot.style.display = name === 'chat'    ? '' : 'none';
    if (_navSlot)  _navSlot.style.display  = name === 'nav'     ? '' : 'none';
    hero.classList.toggle('cs-chat-mode', name === 'chat');
    hero.classList.toggle('cs-nav-mode',  name === 'nav');
    backBtn.style.display = (name === 'content' && _navUsed) ? '' : 'none';
    if (name === 'chat' && _chatSlot) {
      const inputWrap = _chatSlot.querySelector('.ai-input-wrap');
      if (inputWrap) {
        if (!inputWrap.contains(personaBtn)) {
          personaBtn.style.display = '';
          inputWrap.prepend(personaBtn);
        }
        if (!inputWrap.contains(clearChatBtn)) {
          clearChatBtn.style.display = '';
          inputWrap.append(clearChatBtn);
        }
      }
    }
    const showLabel = name !== 'chat' && (name !== 'content' || !!_currentPageTitle);
    labelEl.style.display = showLabel ? '' : 'none';
    labelEl.textContent   = name === 'content'
      ? (_currentPageTitle ?? '')
      : (VIEW_LABELS[name] ?? '');
    if (name === 'chat') localStorage.setItem(CONTENT_CHAT_KEY, 'open');
    else                 localStorage.removeItem(CONTENT_CHAT_KEY);
    if (name !== 'chat') document.dispatchEvent(new CustomEvent('content-chat-closed-externally'));
    if (name !== 'nav')  document.dispatchEvent(new CustomEvent('content-nav-closed'));
    if (name === 'nav')  _navUsed = true;
  }

  window.contentScreen = {
    render(html) { getBody().innerHTML = html; },
    clear()      { getBody().innerHTML = ''; },
    getBody,

    async renderFromJson(jsonPath, { openScreen = true, title = null } = {}) {
      if (openScreen) window.screenController?.ensureVisible('content');
      _currentPageTitle = title;
      _setView('content');
      localStorage.setItem(CONTENT_PATH_KEY, jsonPath);
      if (title) localStorage.setItem(CONTENT_TITLE_KEY, title);

      const b = getBody();
      b.innerHTML = '<p class="content-loading">Loading…</p>';
      try {
        const resp = await fetch(jsonPath);
        if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
        const data = await resp.json();
        renderJson(data, b);
      } catch (err) {
        b.innerHTML = `<p class="content-error">Could not load content (${escapeHtml(err.message)})</p>`;
      }
    },

    // ── Chat slot ───────────────────────────────────────
    getChatSlot() {
      if (!_chatSlot) {
        _chatSlot = document.createElement('div');
        _chatSlot.id = 'cs-chat-slot';
        _chatSlot.className = 'cs-chat-slot';
        _chatSlot.style.display = 'none';
        hero.appendChild(_chatSlot);
      }
      return _chatSlot;
    },
    showChat() { _setView('chat'); },
    hideChat() { _setView('content'); },

    // ── Nav slot ────────────────────────────────────────
    getNavSlot() {
      if (!_navSlot) {
        _navSlot = document.createElement('div');
        _navSlot.id = 'cs-nav-slot';
        _navSlot.className = 'cs-nav-slot';
        _navSlot.style.display = 'none';
        hero.appendChild(_navSlot);
      }
      return _navSlot;
    },
    showNav() { _setView('nav'); },
    hideNav() { _setView('content'); },
  };

  restoreLastContent();
}

// ── Init ───────────────────────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupContentScreen);
} else {
  setupContentScreen();
}
