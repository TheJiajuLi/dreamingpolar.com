const _isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const PROXY_URL = _isLocal
  ? 'http://localhost:3001/api/ai'
  : 'https://api.dreamingpolar.com/api/ai';
const _NETWORK_ERR = _isLocal
  ? 'Cannot reach Polar Bear proxy. Is the backend running? (cd backend && npm start)'
  : '小梦暂时离线，请稍后再试 🌙';

// All personas live in ai_without_personalities.js — edit there for prompt engineering.
export {
  SYSTEM_DEFAULT,
  SYSTEM_PYTHON,
  SYSTEM_EXPLAIN,
  SYSTEM_TERMINAL,
  SYSTEM_CONTENT,
  SYSTEM_LATEX,
  SYSTEM_MATHJAX,
  SYSTEM_MARKDOWN,
  SYSTEM_BY_MODE,
  systemExplainForLang,
  systemRefactorForLang,
} from './ai_personalities.js';

function stripFences(raw) {
  return raw.replace(/^```[a-zA-Z]*\r?\n?/, '').replace(/\r?\n?```\s*$/, '').trim();
}

/**
 * Send a message to Polar Bear.
 * @param {string} userMessage
 * @param {string} [systemPrompt] — override system prompt
 * @param {number} [maxTokens]
 * @returns {Promise<string>} — AI response text (code fences stripped)
 */
export async function ask(userMessage, systemPrompt = SYSTEM_DEFAULT, maxTokens = 1024) {
  let res;
  try {
    res = await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages:   [{ role: 'user', content: userMessage }],
        system:     systemPrompt,
        max_tokens: maxTokens,
      }),
    });
  } catch {
    throw new Error(_NETWORK_ERR);
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `Request failed (${res.status})`);
  }

  const { content } = await res.json();
  return stripFences(content);
}

/**
 * Send a conversation (multi-turn) to Polar Bear.
 * @param {Array<{role:'user'|'assistant', content:string}>} messages
 * @param {string} [systemPrompt]
 */
export async function chat(messages, systemPrompt = SYSTEM_DEFAULT, maxTokens = 1024) {
  let res;
  try {
    res = await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages,
        system:     systemPrompt,
        max_tokens: maxTokens,
      }),
    });
  } catch {
    throw new Error(_NETWORK_ERR);
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `Request failed (${res.status})`);
  }

  const { content } = await res.json();
  return content;
}

/**
 * Streaming multi-turn chat. Yields text chunks as they arrive.
 * @param {Array<{role:'user'|'assistant', content:string}>} messages
 * @param {string} [systemPrompt]
 * @param {number} [maxTokens]
 * @yields {string} text chunk
 */
export async function* streamChat(messages, systemPrompt = SYSTEM_DEFAULT, maxTokens = 1024) {
  let res;
  try {
    res = await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages,
        system:     systemPrompt,
        max_tokens: maxTokens,
        stream:     true,
      }),
    });
  } catch {
    throw new Error(_NETWORK_ERR);
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `Request failed (${res.status})`);
  }

  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let   buf     = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();           // keep incomplete last line in buffer
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (raw === '[DONE]') return;
      try {
        const json = JSON.parse(raw);
        // Anthropic streaming: content_block_delta events carry text_delta
        if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta') {
          if (json.delta.text) yield json.delta.text;
        }
        // OpenAI-compatible streaming fallback
        const delta = json.choices?.[0]?.delta?.content ?? null;
        if (delta) yield delta;
      } catch { /* partial JSON — skip */ }
    }
  }
}
