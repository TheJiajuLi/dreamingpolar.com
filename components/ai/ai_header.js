import { getCurrentMode } from '../compiler/compiler_mode_switcher/compiler_mode_switcher.js';
import { CONTENT_CHAT_KEY } from '../screens/content_screen/content_screen_hook.js';

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

  let _chatOpen = false;

  function setOpen(open) {
    _chatOpen = open;
    btn.classList.toggle('active', open);
    btn.title = open ? 'Close AI chat' : 'Open AI chat';
    if (open) {
      window.screenController?.ensureVisible('content');
      document.dispatchEvent(new CustomEvent('open-ai-in-content'));
    } else {
      document.dispatchEvent(new CustomEvent('close-ai-in-content'));
    }
  }

  btn.addEventListener('click', () => setOpen(!_chatOpen));

  function _deactivate() {
    _chatOpen = false;
    btn.classList.remove('active');
    btn.title = 'Open AI chat';
  }

  // Deactivate when chat view is replaced by content/nav view
  document.addEventListener('content-chat-closed-externally', _deactivate);

  // Deactivate when content screen is minimized or closed via sc-btn
  document.addEventListener('screen-minimized', e => { if (e.detail?.id === 'content') _deactivate(); });
  document.addEventListener('screen-closed',    e => { if (e.detail?.id === 'content') _deactivate(); });

  // Restore chat-open state after all module listeners are registered
  if (localStorage.getItem(CONTENT_CHAT_KEY) === 'open') {
    requestAnimationFrame(() => setOpen(true));
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setup);
} else {
  setup();
}
