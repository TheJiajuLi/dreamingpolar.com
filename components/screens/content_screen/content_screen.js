import { escapeHtml, renderJson,
         createMaximizeBtn, createMinimizeBtn }             from './content_screen_utility.js';
import { CONTENT_PATH_KEY,
         attachContentScreenHooks, restoreLastContent }     from './content_screen_hook.js';

// ── Setup ──────────────────────────────────────────────
function setupContentScreen() {
  const hero = document.getElementById('content-screen');
  if (!hero) return;

  const maximizeBtn = createMaximizeBtn();
  const minimizeBtn = createMinimizeBtn();

  const clearChatBtn = document.createElement('button');
  clearChatBtn.className = 'sc-btn cs-clear-chat-btn';
  clearChatBtn.title = 'Clear chat';
  clearChatBtn.textContent = '⊘';
  clearChatBtn.style.display = 'none';
  clearChatBtn.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('cs-chat-clear'));
  });

  const toolbar = document.createElement('div');
  toolbar.className = 'sc-toolbar';
  toolbar.append(clearChatBtn, maximizeBtn, minimizeBtn);

  const backBtn = document.createElement('button');
  backBtn.className = 'cs-back-btn sc-btn';
  backBtn.title = 'Back to navigation';
  backBtn.style.display = 'none';
  backBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 2 4 7 9 12"/></svg>`;
  backBtn.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('cs-back-to-nav'));
  });

  const labelEl = document.createElement('span');
  labelEl.className = 'content-screen-label';
  labelEl.textContent = 'Content';

  const header = document.createElement('div');
  header.className = 'content-screen-header';
  header.append(backBtn, labelEl, toolbar);

  const body = document.createElement('div');
  body.className = 'content-screen-body';
  body.id        = 'content-screen-body';
  body.innerHTML = '<p class="content-loading">Select a topic from the navigation panel.</p>';

  hero.classList.add('content-screen');
  hero.append(header, body);

  const getBody = () => document.getElementById('content-screen-body');

  attachContentScreenHooks(hero, maximizeBtn, minimizeBtn, getBody);

  // ── Three-view slots ───────────────────────────────────
  let _chatSlot  = null;
  let _navSlot   = null;
  let _navUsed   = false;  // show back btn once nav has been opened

  const VIEW_LABELS = { content: 'Content', chat: '小梦', nav: '导航' };

  function _setView(name) {
    hero.classList.add('cs-active');
    getBody().style.display                = name === 'content' ? '' : 'none';
    if (_chatSlot) _chatSlot.style.display = name === 'chat'    ? '' : 'none';
    if (_navSlot)  _navSlot.style.display  = name === 'nav'     ? '' : 'none';
    hero.classList.toggle('cs-chat-mode', name === 'chat');
    hero.classList.toggle('cs-nav-mode',  name === 'nav');
    clearChatBtn.style.display = name === 'chat' ? '' : 'none';
    backBtn.style.display      = (name === 'content' && _navUsed) ? '' : 'none';
    labelEl.textContent = VIEW_LABELS[name] ?? 'Content';
    if (name !== 'chat') document.dispatchEvent(new CustomEvent('content-chat-closed-externally'));
    if (name !== 'nav')  document.dispatchEvent(new CustomEvent('content-nav-closed'));
    if (name === 'nav')  _navUsed = true;
  }

  window.contentScreen = {
    render(html) { getBody().innerHTML = html; },
    clear()      { getBody().innerHTML = ''; },
    getBody,

    async renderFromJson(jsonPath, { openScreen = true } = {}) {
      if (openScreen) window.screenController?.ensureVisible('content');
      _setView('content');
      localStorage.setItem(CONTENT_PATH_KEY, jsonPath);

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
