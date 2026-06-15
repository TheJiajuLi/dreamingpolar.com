// ── AI Chat Screen ────────────────────────────────────────────────────────────
//
//  Registers the #ai-chat-screen panel with screenController.
//  Opens when compiler mode switches to 'ai_chat'; closes otherwise.
//  Also listens to the 'ai-chat-send' event dispatched by ai_header.js
//  when input_filter routes a prompt as conversational.

import { sendMessage, getHistory, clearHistory, getRemainingTokens } from '../ai_chat/ai_chat.js';
import { getCurrentMode } from '../../compiler/compiler_mode_switcher/compiler_mode_switcher.js';
import { getActivePersona, cyclePersona } from '../ai_persona_switch.js';

const SCREEN_ID = 'ai-chat';

// ── Shared helpers (module scope) ─────────────────────────────────────────────
function escHtml(str) {
  return (str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const COPY_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;

function makeBubble(role, content) {
  const wrap  = document.createElement('div');
  wrap.className = `aic-bubble aic-bubble--${role}`;
  const inner = document.createElement('div');
  inner.className = 'aic-bubble-inner';

  const textSpan = document.createElement('span');
  textSpan.className = 'aic-bubble-text';
  textSpan.innerHTML = escHtml(content).replace(/\n/g, '<br>');
  inner.appendChild(textSpan);

  if (role === 'assistant') {
    const copyBtn = document.createElement('button');
    copyBtn.className = 'aic-copy-btn lus-copy-btn';
    copyBtn.title = 'Copy response';
    copyBtn.innerHTML = COPY_ICON;
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(textSpan.textContent);
        copyBtn.classList.add('lus-copy-btn--done');
        setTimeout(() => copyBtn.classList.remove('lus-copy-btn--done'), 1500);
      } catch (_) {}
    });
    inner.appendChild(copyBtn);
  }

  wrap.appendChild(inner);
  return wrap;
}

function setupAiChatScreen() {
  const screen = document.getElementById('ai-chat-screen');
  if (!screen) return;

  screen.innerHTML = `
    <div class="aic-header">
      <span class="aic-label">CHAT</span>
      <button class="aic-persona-btn" id="aic-persona-btn" title="切换 AI 角色"></button>
      <div class="sc-toolbar">
        <button class="sc-btn" id="aic-clear-btn" title="Clear chat">⊘</button>
        <button class="sc-btn" id="aic-max-btn"   title="Maximize">⤢</button>
        <button class="sc-btn" id="aic-min-btn"   title="Minimize">−</button>
      </div>
    </div>
    <div class="aic-messages" id="aic-messages"></div>
    <div class="aic-input-bar">
      <div class="aic-token-row">
        每日额度剩余：<span id="aic-tokens">—</span> tokens
      </div>
      <div class="aic-dialog-wrap">
        <div class="ai-dialog-main">
          <div class="ai-input-wrap">
            <input
              id="aic-input"
              class="ai-header-input"
              type="text"
              autocomplete="off"
              spellcheck="false"
              placeholder="和小梦聊聊… (Enter 发送，Shift+Enter 换行)"
            >
          </div>
          <button class="ai-header-submit" id="aic-send">go</button>
        </div>
      </div>
    </div>
  `;

  const messagesEl    = document.getElementById('aic-messages');
  const inputEl       = document.getElementById('aic-input');
  const sendBtn       = document.getElementById('aic-send');
  const clearBtn      = document.getElementById('aic-clear-btn');
  const maxBtn      = document.getElementById('aic-max-btn');
  const minBtn      = document.getElementById('aic-min-btn');
  const tokensEl    = document.getElementById('aic-tokens');
  const personaBtn  = document.getElementById('aic-persona-btn');

  // ── Persona selector ──────────────────────────────────────────────────────
  function syncPersonaBtn() {
    const p = getActivePersona();
    personaBtn.textContent = p.label;
    personaBtn.dataset.personaId = p.id;
  }
  syncPersonaBtn();

  personaBtn.addEventListener('click', () => {
    cyclePersona();
    syncPersonaBtn();
  });

  document.addEventListener('ai-persona-changed', syncPersonaBtn);

  // ── screenController wiring ──────────────────────────────────────────────
  function syncMaxBtn(state) {
    if (maxBtn) maxBtn.textContent = state === 'maximized' ? '⤡' : '⤢';
  }

  requestAnimationFrame(() => {
    const sc = window.screenController;
    sc?.register(SCREEN_ID, screen, { onStateChange: syncMaxBtn, label: 'Chat' });
    // Start closed; opens only when ai_chat mode is active
    if (getCurrentMode() !== 'ai_chat') sc?.close(SCREEN_ID);
    maxBtn?.addEventListener('click', () => sc?.toggle(SCREEN_ID));
    minBtn?.addEventListener('click', () => sc?.minimize(SCREEN_ID));
  });

  // ── Helpers ──────────────────────────────────────────────────────────────
  function refreshTokens() {
    if (tokensEl) tokensEl.textContent = getRemainingTokens().toLocaleString();
  }

  function scrollBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function renderHistory() {
    messagesEl.innerHTML = '';
    getHistory().forEach(({ role, content }) => {
      if (role === 'user' || role === 'assistant') {
        messagesEl.appendChild(makeBubble(role, content));
      }
    });
    scrollBottom();
  }

  refreshTokens();
  renderHistory();

  // ── Send logic ────────────────────────────────────────────────────────────
  async function doSend(text) {
    text = text.trim();
    if (!text) return;
    inputEl.blur(); // dismiss iOS keyboard so viewport restores before messages scroll
    inputEl.value = '';
    sendBtn.disabled = true;
    sendBtn.textContent = '…';

    messagesEl.appendChild(makeBubble('user', text));

    // Cursor visible immediately while waiting for first chunk
    const replyBubble = makeBubble('assistant', '');
    const replyInner  = replyBubble.querySelector('.aic-bubble-inner');
    const textNode    = replyBubble.querySelector('.aic-bubble-text');
    const cursor      = document.createElement('span');
    cursor.className  = 'aic-typing';
    cursor.innerHTML  = '<i></i><i></i><i></i>';
    textNode.after(cursor);
    messagesEl.appendChild(replyBubble);
    scrollBottom();

    try {
      await sendMessage(text, {
        onChunk(chunk) {
          textNode.textContent += chunk;
          scrollBottom();
        },
      });
      cursor.remove();
    } catch (e) {
      replyBubble.remove();
      const err = makeBubble('assistant', `⚠ ${e.message}`);
      err.classList.add('aic-bubble--error');
      messagesEl.appendChild(err);
    }

    refreshTokens();
    scrollBottom();
    sendBtn.disabled = false;
    sendBtn.textContent = '->';
  }

  sendBtn.addEventListener('click', () => doSend(inputEl.value));
  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); doSend(inputEl.value); }
  });

  clearBtn?.addEventListener('click', () => {
    clearHistory();
    messagesEl.innerHTML = '';
    refreshTokens();
  });

  // ── Open/close driven by mode switcher ───────────────────────────────────
  document.addEventListener('compiler-mode-change', ({ detail: { mode } }) => {
    const sc = window.screenController;
    if (mode === 'ai_chat') {
      sc?.close('compiling');
      sc?.open(SCREEN_ID);
      inputEl?.focus();
    } else {
      sc?.close(SCREEN_ID);
      sc?.open('compiling');
    }
  });

  // ── ai_header.js routes conversational prompts here ──────────────────────
  document.addEventListener('ai-chat-send', ({ detail: { text } }) => {
    const sc = window.screenController;
    sc?.close('compiling');
    sc?.open(SCREEN_ID);
    doSend(text);
  });
}

// ── Embedded chat (renders inside content screen) ─────────────────────────────
function setupEmbeddedChat() {
  let _built = false;
  let _messagesEl, _inputEl, _sendEl, _tokensEl;

  function build(slot) {
    if (_built) return;
    _built = true;

    slot.innerHTML = `
      <div class="aic-messages cs-aic-messages" id="cs-aic-messages"></div>
      <div class="aic-input-bar">
        <div class="aic-token-row">
          每日额度剩余：<span id="cs-aic-tokens">—</span> tokens
        </div>
        <div class="aic-dialog-wrap">
          <div class="ai-dialog-main">
            <div class="ai-input-wrap">
              <input id="cs-aic-input" class="ai-header-input" type="text"
                autocomplete="off" spellcheck="false"
                placeholder="和小梦聊聊… (Enter 发送，Shift+Enter 换行)">
            </div>
            <button class="ai-header-submit" id="cs-aic-send">-></button>
          </div>
        </div>
      </div>
    `;

    _messagesEl = slot.querySelector('#cs-aic-messages');
    _inputEl    = slot.querySelector('#cs-aic-input');
    _sendEl     = slot.querySelector('#cs-aic-send');
    _tokensEl   = slot.querySelector('#cs-aic-tokens');

    function refreshTokens() {
      if (_tokensEl) _tokensEl.textContent = getRemainingTokens().toLocaleString();
    }
    function scrollBottom() {
      _messagesEl.scrollTop = _messagesEl.scrollHeight;
    }
    function renderHistory() {
      _messagesEl.innerHTML = '';
      getHistory().forEach(({ role, content }) => {
        if (role === 'user' || role === 'assistant')
          _messagesEl.appendChild(makeBubble(role, content));
      });
      scrollBottom();
    }

    refreshTokens();
    renderHistory();

    async function doSend(text) {
      text = text.trim();
      if (!text) return;
      _inputEl.blur();
      _inputEl.value = '';
      _sendEl.disabled = true;
      _sendEl.textContent = '…';

      _messagesEl.appendChild(makeBubble('user', text));

      const replyBubble = makeBubble('assistant', '');
      const textNode    = replyBubble.querySelector('.aic-bubble-text');
      const cursor      = document.createElement('span');
      cursor.className  = 'aic-typing';
      cursor.innerHTML  = '<i></i><i></i><i></i>';
      textNode.after(cursor);
      _messagesEl.appendChild(replyBubble);
      scrollBottom();

      try {
        await sendMessage(text, {
          onChunk(chunk) { textNode.textContent += chunk; scrollBottom(); },
        });
        cursor.remove();
      } catch (e) {
        replyBubble.remove();
        const err = makeBubble('assistant', `⚠ ${e.message}`);
        err.classList.add('aic-bubble--error');
        _messagesEl.appendChild(err);
      }

      refreshTokens();
      scrollBottom();
      _sendEl.disabled = false;
      _sendEl.textContent = '->';
    }

    _sendEl.addEventListener('click', () => doSend(_inputEl.value));
    _inputEl.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); doSend(_inputEl.value); }
    });

    document.addEventListener('cs-chat-clear', () => {
      clearHistory();
      _messagesEl.innerHTML = '';
      refreshTokens();
    });

    // ai-chat-send from input_filter routes here too
    document.addEventListener('ai-chat-send', ({ detail: { text } }) => {
      window.screenController?.ensureVisible('content');
      window.contentScreen?.showChat();
      doSend(text);
    });
  }

  document.addEventListener('open-ai-in-content', () => {
    const cs = window.contentScreen;
    if (!cs) return;
    build(cs.getChatSlot());
    cs.showChat();
    _inputEl?.focus();
  });

  document.addEventListener('close-ai-in-content', () => {
    window.contentScreen?.hideChat();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setupAiChatScreen();
    setupEmbeddedChat();
  });
} else {
  setupAiChatScreen();
  setupEmbeddedChat();
}
