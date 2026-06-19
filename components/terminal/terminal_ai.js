// ── Terminal AI — response processing & conversation mode ─────────────────────
//
//  Imported by both terminal_commands.js (for runAiPrompt) and
//  terminal.js (for chat-mode state: isAiChatActive / exitAiChat / consumeAiChat).
//  Lives here to avoid a circular dependency between those two files.
//
//  Low-level text utilities live in terminal_ai_utils.js.

import {
  stripMd,
  extractCodeBlock,
  trimHistory,
  compressLastAssistant,
  tokenBudget,
} from './terminal_ai_utils.js';

// ── Injected callbacks (set by terminal.js / generative_screen.js) ────────────

let _confirmFn         = null; // (question, print) => Promise<boolean>
let _streamLineFn      = null; // () => { update(text) }
let _codeBlockRenderer = null; // (lang, code) => void  — set by generative_screen

export function setConfirmFn(fn)          { _confirmFn         = fn; }
export function setStreamLineFn(fn)       { _streamLineFn      = fn; }
export function setCodeBlockRendererFn(fn){ _codeBlockRenderer = fn; }

export async function askConfirm(question, print) {
  if (!_confirmFn) return false;
  return _confirmFn(question, print);
}

// ── Chat-mode state + conversation history ─────────────────────────────────────

let _aiChatActive = false;
let _history      = []; // [{ role:'user'|'assistant', content }]

export function isAiChatActive() { return _aiChatActive; }

export function exitAiChat(print) {
  _aiChatActive = false;
  _history      = [];
  document.dispatchEvent(new CustomEvent('terminal-ai-mode', { detail: { active: false } }));
  print?.('\x1b[2m← Exited ARIA chat\x1b[0m');
}

export async function consumeAiChat(line, print) {
  if (!_aiChatActive) return false;
  const trimmed = line.trim();
  if (trimmed) await _runAiTextReply(trimmed, print);
  return true;
}

// ── Streaming helper ──────────────────────────────────────────────────────────
//
//  Uses streamChat() when a stream-line factory is available (injected by
//  terminal.js). Falls back to chat() otherwise.
//  Returns { reply: string, update: fn|null } where update() lets callers
//  patch the already-streamed text (e.g. strip the raw code fence after dispatch).

async function _stream(messages, system, maxTokens) {
  if (_streamLineFn) {
    const line = _streamLineFn();
    let reply = '';
    const { streamChat } = await import('../ai/ai_client.js');
    for await (const chunk of streamChat(messages, system, maxTokens)) {
      reply += chunk;
      line.update(stripMd(reply));
    }
    return { reply, update: (text) => line.update(stripMd(text)) };
  }
  const { chat } = await import('../ai/ai_client.js');
  const reply = await chat(messages, system, maxTokens);
  return { reply, update: null };
}

// ── Code block dispatch ────────────────────────────────────────────────────────
//  If a code block renderer is registered (generative screen), render an
//  interactive card in the terminal. Otherwise fall back to the classic
//  Y/N + ai-insert-and-run path used in the coding screen's terminal.

async function _dispatchCode(lang, code, print) {
  if (_codeBlockRenderer) {
    _codeBlockRenderer(lang, code);
    print('\x1b[2m— code card above — Run · Insert · Edit\x1b[0m');
    compressLastAssistant(_history, lang, code.split('\n').length);
    return true;
  }
  // Fallback: classic dispatch with Y/N for coding screen
  if (_confirmFn) {
    const isMedia = lang === 'mathjax' && /<(img|iframe)\b/i.test(code);
    const question = isMedia
      ? '\x1b[33m▶ 是否在内容区显示此内容？(y/n)\x1b[0m'
      : '\x1b[33m⚠ 即将覆盖代码编辑器中的内容，确认继续？(y/n)\x1b[0m';
    const ok = await _confirmFn(question, print);
    if (!ok) { print('\x1b[2m✕ 已取消\x1b[0m'); return false; }
  }
  const { setMode } = await import('../compiler/compiler_mode_switcher/compiler_mode_switcher.js');
  setMode(lang);
  document.dispatchEvent(new CustomEvent('ai-insert-and-run', { detail: { code, lang } }));
  print(`\x1b[2m✓ ${lang} → Code panel.\x1b[0m`);
  compressLastAssistant(_history, lang, code.split('\n').length);
  return true;
}

// ── Public entry (called by terminal_commands.js 'ai' handler) ─────────────────
// options.system — override the mode-derived system prompt (used when df context
//                  is available and SYSTEM_DATA_ANALYSIS should be used instead)

export async function runAiPrompt(prompt, print, options = {}) {
  if (!prompt) { print('No prompt given.'); return; }

  // Fresh invocation outside chat mode → start clean conversation
  if (!_aiChatActive) _history = [];

  const { detectLang } = await import('../ai/input_filter/input_filter.js');
  const detected = detectLang(prompt);

  if (detected === 'ai_chat') {
    await _runAiTextReply(prompt, print);
    return;
  }

  print(`\x1b[2m⚙  ${prompt.split('\n').pop()}\x1b[0m`);  // show last line (task, not full context)

  try {
    const { SYSTEM_BY_MODE, SYSTEM_TERMINAL } = await import('../ai/ai_client.js');
    const { getActivePersona } = await import('../ai/ai_persona_switch.js');

    const lang       = detected;
    const persona    = getActivePersona();
    const modeSystem = options.system ?? (SYSTEM_BY_MODE[lang] ?? SYSTEM_TERMINAL);
    const system     = `${persona.buildSystemPrompt()}\n\n${modeSystem}${TERMINAL_PLATFORM_CONTEXT}`;

    _history.push({ role: 'user', content: prompt });
    trimHistory(_history);

    // Stream or wait — either way we get the full reply at the end
    print('');
    print('\x1b[36mARIA:\x1b[0m');
    const { reply, update } = await _stream(_history, system, tokenBudget(lang));
    _history.push({ role: 'assistant', content: reply });

    const extracted = extractCodeBlock(reply);

    if (extracted) {
      // If streaming, patch the div to show clean explanation (no raw fence)
      if (update) {
        update(extracted.text || '');
      } else {
        const lines = stripMd(extracted.text).split('\n').filter(l => l.trim());
        for (const ln of lines) print(ln);
      }
      print('');
      await _dispatchCode(extracted.lang || lang, extracted.code, print);
    } else {
      // Pure text reply — already streamed or print now
      if (!update) {
        for (const ln of stripMd(reply).split('\n')) print(ln);
        print('');
      }
      if (!_aiChatActive) {
        _aiChatActive = true;
        document.dispatchEvent(new CustomEvent('terminal-ai-mode', { detail: { active: true } }));
        print('\x1b[2m— ARIA active · Esc to exit —\x1b[0m');
      }
    }

  } catch (e) {
    print(`\x1b[31m⚠ ${e.message}\x1b[0m`);
  }
}

// ── Private: text/chat reply path ─────────────────────────────────────────────

async function _runAiTextReply(prompt, print) {
  print(`\x1b[2m⚙  ${prompt}\x1b[0m`);

  try {
    const { getActivePersona } = await import('../ai/ai_persona_switch.js');

    const persona = getActivePersona();
    const system  = persona.buildSystemPrompt() + TERMINAL_PLATFORM_CONTEXT;

    _history.push({ role: 'user', content: prompt });
    trimHistory(_history);

    print('');
    print('\x1b[36mARIA:\x1b[0m');
    // Chat path uses smaller token budget — saves quota on conversational replies
    const { reply, update } = await _stream(_history, system, tokenBudget('ai_chat'));
    _history.push({ role: 'assistant', content: reply });

    const extracted = extractCodeBlock(reply);
    if (extracted) {
      if (update) {
        update(extracted.text || '');
      } else {
        const lines = stripMd(extracted.text).split('\n').filter(l => l.trim());
        for (const ln of lines) print(ln);
      }
      print('');
      await _dispatchCode(extracted.lang, extracted.code, print);
    } else {
      if (!update) {
        for (const ln of stripMd(reply).split('\n')) print(ln);
        print('');
      }
    }

    if (!_aiChatActive) {
      _aiChatActive = true;
      document.dispatchEvent(new CustomEvent('terminal-ai-mode', { detail: { active: true } }));
      print('\x1b[2m— 已进入 AI 对话 · 按 Esc 退出 —\x1b[0m');
    }

  } catch (e) {
    print(`\x1b[31m⚠ ${e.message}\x1b[0m`);
  }
}

// ── Platform context (appended to every system prompt in terminal mode) ────────

const TERMINAL_PLATFORM_CONTEXT = `

[平台能力 — 必须了解]
你正在运行于 Dreaming Polar 的终端对话模式中。这是一个浏览器端编程平台，支持多种输出格式——根据问题类型选择最合适的代码块：

**Python（代码 / 图表）** — \`\`\`python
- 通过 Pyodide 在浏览器本地运行；numpy、matplotlib、pandas、sympy 均已预加载。
- 图表直接输出，不要说"无法生成图片"；用户问"画图"、"可视化"时直接写 matplotlib 代码。

**MathJax（数学公式）** — \`\`\`mathjax
- 平台原生支持 MathJax 渲染 LaTeX 公式，渲染后呈现在内容区。
- 示例：\`\`\`mathjax\\n\\\\[e^{i\\\\pi}+1=0\\\\]\\n\`\`\`
- 用户问定理、公式推导、方程时，优先用此格式。

**LaTeX（文档排版）** — \`\`\`latex
- 输出完整 LaTeX 文档；适合需要排版的长篇内容。

**Markdown** — \`\`\`markdown
- 输出富文本说明；适合带标题、列表、表格的解释性内容。

**HTML / 网络内容引用** — \`\`\`mathjax（HTML 模式）
- MathJax 模式是完整 HTML 渲染器，支持任意 HTML 标签和外部资源。

图片 — 优先使用以下可靠来源，无需用户提供 URL：
  LoremFlickr 关键词图（最推荐，始终有效，来自 Flickr 真实照片库）：
    格式：<img src="https://loremflickr.com/1200/800/arctic,iceberg" style="max-width:100%;border-radius:8px">
    关键词用英文逗号分隔，URL 路径末尾直接跟关键词，无需参数符号。
    示例：arctic → /1200/800/arctic,landscape；熊猫 → /1200/800/panda,bamboo
  注意：不要使用 source.unsplash.com（已停止服务，图片无法加载）。
  Wikimedia Commons（仅当你有把握知道准确路径时使用）
  用户自己提供的任意 URL → 直接嵌入

视频 / 音乐 — 不要猜测 YouTube VIDEO_ID（猜错会显示"Video unavailable"）。
  正确做法：生成一张可点击的搜索卡片，用户点击后直接跳转 YouTube 搜索结果。
  卡片模板（mathjax HTML）：
    <a href="https://www.youtube.com/results?search_query=ENCODED_QUERY" target="_blank"
       style="display:flex;align-items:center;gap:16px;padding:16px;border-radius:12px;
              background:#1a1a2e;color:#eee;text-decoration:none;font-family:sans-serif;
              border:1px solid #333;max-width:480px;margin:8px 0">
      <img src="https://loremflickr.com/80/80/music,concert" style="border-radius:8px;flex-shrink:0">
      <div>
        <div style="font-size:1.1em;font-weight:600">🎵 曲目名称</div>
        <div style="color:#aaa;font-size:0.85em;margin-top:4px">点击在 YouTube 搜索</div>
      </div>
    </a>
  ENCODED_QUERY：将搜索词用 + 连接英文单词，例如 Octopath+Traveler+Fate+of+Ophilia。

决策树：
  用户想看图片 → 用 LoremFlickr 关键词 URL 嵌入真实照片（mathjax HTML 代码块）
  用户想看图表/数据可视化 → python matplotlib
  用户想看公式 → mathjax LaTeX
  用户想听/看视频 → mathjax 搜索卡片（绝不猜测 VIDEO_ID）
  用户想看文档/笔记 → markdown 或 latex

规则：绝对不要编造随机 URL；LoremFlickr 关键词 URL 是安全的，随时可用。`;
