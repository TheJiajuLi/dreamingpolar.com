// ── AI Chat Screen Hooks ──────────────────────────────────────────────────────
//  Restores the chat panel's open/closed state across page reloads.
//
//  Capture the saved value at module-eval time — before ai_chat_screen.js's
//  requestAnimationFrame callback runs and overwrites localStorage with its
//  forced-close (which fires when the current mode is not ai_chat).

const STORAGE_KEY = 'dp-screen-ai-chat';
const _savedOpen  = localStorage.getItem(STORAGE_KEY) === 'open';

// Opening AI chat minimizes coding screen so only one 流光特效 runs at a time.
document.addEventListener('screen-opened', ({ detail: { id } }) => {
  if (id !== 'ai-chat') return;
  const sc = window.screenController;
  if (!sc) return;
  const state = sc.getState('coding');
  if (state && state !== 'closed' && state !== 'minimized') sc.minimize('coding');
});

function initHooks() {
  // Double rAF: guaranteed to run after ai_chat_screen.js's single rAF
  // (register + forced-close), so our open() call wins.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (!_savedOpen) return;
    const sc = window.screenController;
    if (sc) sc.open('ai-chat');
  }));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initHooks);
} else {
  initHooks();
}
