// ── AI Chat button in the vertical toolbar ────────────────────────────────────
// Opens / closes the #ai-chat-screen panel via screenController,
// matching the same open↔close toggle pattern used by start_coding.js.

function setup() {
  const vtTop = document.querySelector('#vertical-toolbar .vt-top');
  if (!vtTop) return;

  const btn = document.createElement('button');
  btn.className = 'ai-chat-btn';
  btn.id        = 'ai-chat-btn';
  btn.title     = 'Open AI chat';
  btn.setAttribute('aria-label', 'Toggle AI chat');
  btn.innerHTML = `<img src="${window.BASE}/assets/buttons/chat_ai.png" alt="AI" class="ai-header-icon">`;

  vtTop.appendChild(btn);

  // ── Sync active state from screenController truth ─────────────────────────
  function _syncActive() {
    const state = window.screenController?.getState('ai-chat');
    const isOpen = state === 'normal' || state === 'maximized';
    btn.classList.toggle('active', isOpen);
    btn.title = isOpen ? 'Close AI chat' : 'Open AI chat';
    if (isOpen) document.dispatchEvent(new CustomEvent('vt-btn-activated', { detail: { id: 'ai-chat' } }));
  }

  // ── Toggle: open if closed/minimized, close if open ──────────────────────
  btn.addEventListener('click', () => {
    const state = window.screenController?.getState('ai-chat');
    if (!state || state === 'closed' || state === 'minimized') {
      window.screenController?.open('ai-chat');
    } else {
      window.screenController?.close('ai-chat');
    }
  });

  // ── Keep button in sync with screenController state changes ──────────────
  document.addEventListener('screen-opened',    e => { if (e.detail?.id === 'ai-chat') _syncActive(); });
  document.addEventListener('screen-closed',    e => { if (e.detail?.id === 'ai-chat') _syncActive(); });
  document.addEventListener('screen-minimized', e => { if (e.detail?.id === 'ai-chat') _syncActive(); });

  // ── Deactivate when another VT button claims the active slot ─────────────
  document.addEventListener('vt-btn-activated', ({ detail: { id } }) => {
    if (id !== 'ai-chat') {
      btn.classList.remove('active');
      btn.title = 'Open AI chat';
    }
  });

  // ── Sync initial state after ai_chat_screen.js has registered ────────────
  requestAnimationFrame(() => requestAnimationFrame(_syncActive));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setup);
} else {
  setup();
}
