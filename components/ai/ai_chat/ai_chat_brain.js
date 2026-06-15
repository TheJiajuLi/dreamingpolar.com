// ── AI Chat Brain ─────────────────────────────────────────────────────────────
//
//  Calibrates 小梦's response style per message.
//  The style directive is PREPENDED before the personality prompt so the model
//  sees the length constraint first (highest priority).
//
//  Future: addLearnedExamples() accepts crawler-fetched real-chat pairs.

// ── Input weight ──────────────────────────────────────────────────────────────

// Signals that the answer needs substantial depth regardless of message length
const DEPTH_PATTERNS = [
  // Explicit depth requests
  /formal(ly)?|prove|proof|derive|step.by.step|in.detail/i,
  /详细|深入|完整|全面|系统性|一步一步|怎么推导|请解释/,
  // Explanation-type questions
  /explain|elaborate|how does|how do|why does|why do/i,
  /什么是|是什么|为什么|怎么|如何|原理|机制/,
  // Comparison / contrast
  /compare|versus|\bvs\.?\b|contrast|difference between|区别|对比/i,
  // Technical intent
  /implement|algorithm|complexity|example|举例|示例|代码|程序/i,
];

// Technical domain — short questions in these domains still need long answers
const TECHNICAL_PATTERN = /\b(matrix|vector|tensor|gradient|eigen|fourier|laplace|bayesian|neural|regression|recursion|theorem|lemma|integral|derivative|kernel|topology|entropy|convex|markov|stochastic)\b|[∑∫∂∇≈≤≥×±λσμπ]|\$\$?|\bO\([^)]+\)/i;

function measureWeight(text) {
  const t = text.trim();

  if (DEPTH_PATTERNS.some(r => r.test(t))) return 'detailed';
  if (TECHNICAL_PATTERN.test(t))           return 'detailed';

  // Fallback: word count (more meaningful than char count for tone calibration)
  const words = t.split(/[\s　]+/).filter(Boolean).length;
  if (words >= 20) return 'normal';
  if (words >= 5)  return 'brief';
  return 'micro';
}

const MAX_TOKENS = {
  micro:    2000,
  brief:    3500,
  normal:   5000,
  detailed: 8192,
};

// ── Directives ────────────────────────────────────────────────────────────────
// Soft guidance only — persona character takes priority over length.

const LENGTH_DIRECTIVE = {
  micro:
    `【回复风格提示】用户发了简短的消息，用自然对话的语气回应，` +
    `2-4句即可，不需要展开成长篇，但要有温度和个性。`,

  brief:
    `【回复风格提示】用户发了简短的问题或想法，正常对话回应，` +
    `3-5句，可以有自己的看法和补充，不要敷衍。`,

  normal:
    `【回复风格提示】用户发了正常长度的消息，充分回应，` +
    `可以展开思路，保持对话节奏和个人风格。`,

  detailed:
    `【回复风格提示】用户提了较复杂的问题，深入回答，` +
    `分层次说清楚，展示真实的思考过程。`,
};

// ── Examples block builder ────────────────────────────────────────────────────
// examples come from the active persona (see ai_persona_switch.js)

function buildExamplesBlock(weight, examples) {
  const pairs = examples[weight] ?? examples.normal ?? [];
  const lines = pairs.map(({ u, a }) => `用户: ${u}\n小梦: ${a}`).join('\n\n');
  return `[对话示例 — 严格遵守这个长度风格]\n\n${lines}`;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns the style prefix and maxTokens for a given user message.
 * This should be PREPENDED before SYSTEM_DEFAULT so it takes priority.
 *
 * @param {string} userText
 * @returns {{ prefix: string, maxTokens: number }}
 */
export function calibrate(userText, examples) {
  const weight = measureWeight(userText);
  const prefix = `${LENGTH_DIRECTIVE[weight]}\n\n${buildExamplesBlock(weight, examples)}`;
  return { prefix, maxTokens: MAX_TOKENS[weight] };
}
