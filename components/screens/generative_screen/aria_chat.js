// ── ARIA Chat — Quick Analysis conversation interface ─────────────────────────
// A clean chat panel for generative_screen that replaces the terminal UI.
// Uses streamChat() directly — no terminal.js infrastructure needed.
// df context (schema + head-3) is fetched from the kernel before each reply.

import { compile } from '../../compiler/compiler.js';

// ── df context Python snippet ─────────────────────────────────────────────────
const _DF_CTX_PY = `
import json as _j, pandas as _pd
try:
    _df = globals().get('df')
    if isinstance(_df, _pd.DataFrame) and len(_df) > 0:
        _recs = []
        for _, _row in _df.head(3).iterrows():
            _r = {}
            for _c in _df.columns:
                _v = _row[_c]
                try:
                    import math as _m
                    _r[str(_c)] = (None if isinstance(_v, float) and _m.isnan(_v)
                                   else (_v if isinstance(_v, (int, float, str, bool, type(None))) else str(_v)))
                except Exception:
                    _r[str(_c)] = str(_v)
            _recs.append(_r)
        print(_j.dumps({
            'shape':   [int(_df.shape[0]), int(_df.shape[1])],
            'columns': list(_df.columns),
            'dtypes':  {str(c): str(t) for c, t in _df.dtypes.items()},
            'head3':   _recs,
            'nulls':   int(_df.isnull().sum().sum()),
        }))
    else:
        print(_j.dumps({}))
except Exception:
    print(_j.dumps({}))
`.trim();

async function _getDfContext() {
  try {
    const outputs = await compile(_DF_CTX_PY, 'python');
    const text    = outputs.find(o => o.type === 'text')?.content?.trim() ?? '';
    if (!text) return null;
    const info = JSON.parse(text);
    return info.shape ? info : null;
  } catch { return null; }
}

function _buildPrompt(dfInfo, question) {
  if (!dfInfo) return question;
  const colLines = dfInfo.columns.map(c => `  ${c}: ${dfInfo.dtypes[c]}`).join('\n');
  const headJson = JSON.stringify(dfInfo.head3, null, 2);
  return (
    `[当前 DataFrame 上下文]\n` +
    `df — ${dfInfo.shape[0].toLocaleString()} 行 × ${dfInfo.shape[1]} 列，${dfInfo.nulls} 个空值\n` +
    `列名与类型:\n${colLines}\n\n` +
    `前3行样本:\n${headJson}\n\n` +
    `用户问题: ${question}`
  );
}

// ── System prompt ─────────────────────────────────────────────────────────────
const _SYSTEM =
  `你是 ARIA，Dreaming Polar 的数据分析助理。` +
  `用户已上传一个 DataFrame，你的任务是用清晰、有见地的语言回答关于这份数据的问题。\n\n` +
  `分析原则：\n` +
  `• 始终引用真实的列名和具体数字，不要泛泛而谈\n` +
  `• 发现电商字段（customer_id / purchase_date / amount 等）时主动建议 RFM 分层或复购分析\n` +
  `• 发现时间字段时建议趋势分析或同比环比\n` +
  `• 回答简洁有结构，用数字和列表突出重点\n` +
  `• 如果需要代码才能回答，给出简短的可运行 Python 片段（勿超过 15 行）\n` +
  `• 语言跟随用户（中文或英文）\n` +
  `• 没有数据上下文时告知用户需要先导入数据`;

// ── Inline markdown formatter ─────────────────────────────────────────────────
function _fmt(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}

function _esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _time() {
  return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

// ── Build a chat card ─────────────────────────────────────────────────────────
function _makeCard(question, messagesEl) {
  const card = document.createElement('div');
  card.className = 'aria-chat-card';

  const hdr = document.createElement('div');
  hdr.className = 'aria-chat-card-hdr';
  hdr.innerHTML =
    `<span class="aria-chat-card-label">ARIA</span>` +
    `<span class="aria-chat-card-q">${_esc(question.length > 55 ? question.slice(0, 55) + '…' : question)}</span>` +
    `<span class="aria-chat-card-time">${_time()}</span>`;

  const body = document.createElement('div');
  body.className = 'aria-chat-card-body';

  const cursor = document.createElement('span');
  cursor.className   = 'aria-chat-card-cursor';
  cursor.textContent = '▋';
  body.appendChild(cursor);

  card.append(hdr, body);
  messagesEl.appendChild(card);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return { card, body };
}

// ── Public factory ────────────────────────────────────────────────────────────
export function createAriaChat() {
  const root = document.createElement('div');
  root.className = 'aria-chat';

  // ── Header ────────────────────────────────────────────────────────────────
  const header = document.createElement('div');
  header.className = 'aria-chat-header';
  header.innerHTML =
    `<span class="aria-chat-header-label">ARIA</span>` +
    `<span class="aria-chat-header-sub">数据分析助理</span>` +
    `<span class="aria-chat-header-dot" id="aria-chat-dot"></span>`;

  // ── Messages ──────────────────────────────────────────────────────────────
  const messages = document.createElement('div');
  messages.className = 'aria-chat-messages';

  const welcome = document.createElement('div');
  welcome.className = 'aria-chat-welcome';
  welcome.innerHTML =
    `<div class="aria-chat-welcome-title">导入数据后开始对话</div>` +
    `<div class="aria-chat-welcome-hint">上传 CSV / Excel 文件，然后用自然语言提问。ARIA 会引用真实的列名和数字，不说套话。</div>` +
    `<div class="aria-chat-welcome-chips">` +
    `<span class="aria-chat-chip" data-q="这些数据有什么特点？">这些数据有什么特点？</span>` +
    `<span class="aria-chat-chip" data-q="帮我做客户分层分析">客户分层分析</span>` +
    `<span class="aria-chat-chip" data-q="哪些列有空值？数量是多少？">空值情况</span>` +
    `<span class="aria-chat-chip" data-q="金额列的分布是什么样的？">金额分布</span>` +
    `</div>`;
  messages.appendChild(welcome);

  // ── Input row ─────────────────────────────────────────────────────────────
  const inputRow = document.createElement('div');
  inputRow.className = 'aria-chat-input-row';

  const input = document.createElement('input');
  input.className   = 'aria-chat-input';
  input.type        = 'text';
  input.autocomplete = 'off';
  input.spellcheck  = false;
  input.placeholder = '问一句关于你数据的问题…';
  input.setAttribute('aria-label', '提问 ARIA');

  const sendBtn = document.createElement('button');
  sendBtn.className = 'aria-chat-send';
  sendBtn.title     = '发送 (Enter)';
  sendBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;

  inputRow.append(input, sendBtn);
  root.append(header, messages, inputRow);

  // ── Submit logic ──────────────────────────────────────────────────────────
  let _busy = false;

  async function _submit() {
    const question = input.value.trim();
    if (!question || _busy) return;
    _busy = true;
    input.value   = '';
    input.disabled  = true;
    sendBtn.disabled = true;
    welcome.style.display = 'none';

    const dot = root.querySelector('#aria-chat-dot');
    if (dot) dot.classList.add('aria-chat-dot--active');

    const { card, body } = _makeCard(question, messages);

    try {
      // Fetch df context then stream AI response
      const dfInfo  = await _getDfContext();
      const prompt  = _buildPrompt(dfInfo, question);

      const { streamChat } = await import('../../ai/ai_client.js');
      let fullReply = '';

      body.innerHTML = '';
      const cur = document.createElement('span');
      cur.className = 'aria-chat-card-cursor'; cur.textContent = '▋';
      body.appendChild(cur);

      for await (const chunk of streamChat([{ role: 'user', content: prompt }], _SYSTEM, 1200)) {
        fullReply += chunk;
        body.innerHTML = _fmt(fullReply);
        const c2 = document.createElement('span');
        c2.className = 'aria-chat-card-cursor'; c2.textContent = '▋';
        body.appendChild(c2);
        messages.scrollTop = messages.scrollHeight;
      }

      body.innerHTML = _fmt(fullReply);

      // Small metadata badge at card bottom
      if (dfInfo) {
        const badge = document.createElement('div');
        badge.className   = 'aria-chat-card-meta';
        badge.textContent = `df: ${dfInfo.shape[0].toLocaleString()} 行 × ${dfInfo.shape[1]} 列`;
        card.appendChild(badge);
      }

    } catch (e) {
      body.innerHTML = `<span class="aria-chat-err">⚠ ${_esc(e.message)}</span>`;
    } finally {
      _busy = false;
      input.disabled  = false;
      sendBtn.disabled = false;
      input.focus();
      if (dot) dot.classList.remove('aria-chat-dot--active');
      messages.scrollTop = messages.scrollHeight;
    }
  }

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _submit(); }
  });
  sendBtn.addEventListener('click', _submit);

  // Click example chips
  messages.addEventListener('click', e => {
    const chip = e.target.closest('.aria-chat-chip');
    if (chip) { input.value = chip.dataset.q; input.focus(); }
  });

  // ── Called by generative_screen when data is injected ────────────────────
  root._onDataLoaded = (varName = 'df') => {
    welcome.style.display = 'none';

    const card = document.createElement('div');
    card.className = 'aria-chat-card aria-chat-card--info';
    card.innerHTML =
      `<div class="aria-chat-card-hdr">` +
      `<span class="aria-chat-card-label">SYSTEM</span>` +
      `<span class="aria-chat-card-q">数据已加载到内核 — 变量名: <code>${_esc(varName)}</code></span>` +
      `<span class="aria-chat-card-time">${_time()}</span>` +
      `</div>` +
      `<div class="aria-chat-card-body" style="opacity:0.75">` +
      `现在可以直接提问，ARIA 会读取 <code>${_esc(varName)}</code> 的实际内容作答。` +
      `</div>`;
    messages.appendChild(card);
    messages.scrollTop = messages.scrollHeight;
    input.focus();
  };

  return root;
}
