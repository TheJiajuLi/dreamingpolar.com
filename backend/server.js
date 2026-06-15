import 'dotenv/config';
import express from 'express';
import cors from 'cors';

const app  = express();
const PORT = process.env.PORT ?? 3001;

// ── 配置 ──────────────────────────────────────────────────────
const CONFIG = {
  model:  process.env.AI_MODEL ?? 'claude-haiku-4-5',
  apiUrl: 'https://api.anthropic.com/v1/messages',
  apiKey: process.env[process.env.ACTIVE_KEY] ?? process.env.AI_API_KEY,
};

const SYSTEM_PROMPT = `You are 小梦, a polar bear AI assistant built into Dreaming Polar (极梦) — an interactive mathematics and Python learning platform. You help students learn math, generate Python code for visualization and computation, explain errors, and answer questions about mathematics. You are friendly, encouraging, and precise. When asked to generate code, return ONLY the Python code with no markdown fences and no explanation unless the user asks for one.`;

const ALLOWED_ORIGINS = [
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://dreamingpolar.com',
  'https://www.dreamingpolar.com',
  'https://api.dreamingpolar.com',
  /^https:\/\/thejiajuli\.github\.io$/,
  /^https:\/\/.*\.onrender\.com$/,
];

// ── 中间件 ────────────────────────────────────────────────────
app.use(cors({ origin: ALLOWED_ORIGINS }));
app.use(express.json({ limit: '2mb' }));

// ── 路由 ──────────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({ ok: true, model: CONFIG.model }));

app.post('/api/ai', async (req, res) => {
  if (!CONFIG.apiKey) {
    return res.status(500).json({
      error: 'No API key — check ACTIVE_KEY + AI_API_KEY_1/2 in backend/.env'
    });
  }

  const {
    messages,
    system     = SYSTEM_PROMPT,
    max_tokens = 1024,
    stream     = false,
  } = req.body;

  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  // OpenAI格式 — system作为第一条messages
  const fullMessages = [
    { role: 'system', content: system },
    ...messages,
  ];

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 60_000);

  try {
    const upstream = await fetch(CONFIG.apiUrl, {
      method: 'POST',
      signal: abort.signal,
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${CONFIG.apiKey}`,
      },
      body: JSON.stringify({
        model:      CONFIG.model,
        messages:   fullMessages,
        max_tokens,
        stream,
      }),
    });
    clearTimeout(timer);

    if (!upstream.ok) {
      const err = await upstream.json().catch(() => ({}));
      return res.status(upstream.status).json({
        error: err.error?.message ?? JSON.stringify(err)
      });
    }

    // ── Streaming ─────────────────────────────────────────────
    if (stream) {
      res.setHeader('Content-Type',      'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control',     'no-cache');
      res.setHeader('Connection',        'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      for await (const chunk of upstream.body) res.write(chunk);
      return res.end();
    }

    // ── Non-streaming — OpenAI格式解析 ────────────────────────
    const data    = await upstream.json();
    console.log(`[ai] ${upstream.status}`, JSON.stringify(data).slice(0, 200));
    const content = data.choices?.[0]?.message?.content?.trim() ?? '';
    res.json({ content });

  } catch (e) {
    clearTimeout(timer);
    console.error('[ai] fetch error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── 启动 ──────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🐻‍❄️ 小梦 proxy running on http://localhost:${PORT}`);
  if (!CONFIG.apiKey) console.warn('⚠️  No API key found — check backend/.env');
});