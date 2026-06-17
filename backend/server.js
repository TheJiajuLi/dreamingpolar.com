import 'dotenv/config';
import express from 'express';
import cors from 'cors';

const app  = express();
const PORT = process.env.PORT ?? 3001;

// ── Profile selection ─────────────────────────────────────────
// Set ACTIVE=1 or ACTIVE=2 in .env to switch providers
const n = process.env.ACTIVE_AI_INDEX || 1;

const CONFIG = {
  format: process.env[`AI_API_FORMAT_${n}`] ?? 'anthropic',
  apiUrl: process.env[`AI_API_URL_${n}`],
  apiKey: process.env[`AI_API_KEY_${n}`],
  model:  process.env[`AI_MODEL_${n}`] ?? 'claude-haiku-4-5',
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
app.get('/health', (_, res) => res.json({
  ok:        true,
  active:    n,
  format:    CONFIG.format,
  model:     CONFIG.model,
  apiUrl:    CONFIG.apiUrl,
  keyLoaded: !!CONFIG.apiKey,
  keyPrefix: CONFIG.apiKey ? CONFIG.apiKey.slice(0, 18) + '…' : 'MISSING',
}));

app.post('/api/ai', async (req, res) => {
  if (!CONFIG.apiKey) {
    return res.status(500).json({
      error: `No API key — set AI_API_KEY_${n} in backend/.env`
    });
  }
  if (!CONFIG.apiUrl) {
    return res.status(500).json({
      error: `No API URL — set AI_API_URL_${n} in backend/.env`
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

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 60_000);

  // ── Build request per format ───────────────────────────────
  const isOpenAI = CONFIG.format === 'openai';

  const reqHeaders = isOpenAI
    ? { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CONFIG.apiKey}` }
    : { 'Content-Type': 'application/json', 'x-api-key': CONFIG.apiKey, 'anthropic-version': '2023-06-01' };

  const reqBody = isOpenAI
    ? { model: CONFIG.model, messages: [{ role: 'system', content: system }, ...messages], max_tokens, stream }
    : { model: CONFIG.model, system, messages, max_tokens, stream };

  try {
    const upstream = await fetch(CONFIG.apiUrl, {
      method:  'POST',
      signal:  abort.signal,
      headers: reqHeaders,
      body:    JSON.stringify(reqBody),
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

    // ── Non-streaming — parse per format ──────────────────────
    const data    = await upstream.json();
    console.log(`[ai] ${upstream.status}`, JSON.stringify(data).slice(0, 200));
    const content = isOpenAI
      ? (data.choices?.[0]?.message?.content?.trim() ?? '')
      : (data.content?.[0]?.text?.trim() ?? '');
    res.json({ content });

  } catch (e) {
    clearTimeout(timer);
    console.error('[ai] fetch error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── 启动 ──────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🐻‍❄️ 小梦 proxy [profile ${n}] running on http://localhost:${PORT} [${CONFIG.format} / ${CONFIG.model}]`);
  if (!CONFIG.apiKey) console.warn(`⚠️  No API key — set AI_API_KEY_${n} in backend/.env`);
});
