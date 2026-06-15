import { getCurrentMode } from '../compiler/compiler_mode_switcher/compiler_mode_switcher.js';

function setup() {
  const vtTop = document.querySelector('#vertical-toolbar .vt-top');
  if (!vtTop) return;

  const btn = document.createElement('button');
  btn.className = 'ai-header-btn';
  btn.id        = 'ai-header-btn';
  btn.title     = 'Open AI chat';
  btn.setAttribute('aria-label', 'Toggle AI chat');
  btn.innerHTML = `<img src="${window.BASE}/assets/buttons/ai.png" alt="AI" class="ai-header-icon">`;

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

  // External sources can signal chat closed (e.g. content item selected)
  document.addEventListener('content-chat-closed-externally', () => {
    _chatOpen = false;
    btn.classList.remove('active');
    btn.title = 'Open AI chat';
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setup);
} else {
  setup();
}
