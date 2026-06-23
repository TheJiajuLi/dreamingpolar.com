// ── DataFrame 智能报告 Modal ──────────────────────────────────────────────────
// Phase 1: AI 叙事性数据分析，流式渲染，DeepSeek-R1 think 块过滤

import { streamChat }                        from '../../ai/ai_client.js';
import { getDataFrameSchema, queryKernelContext } from '../../compiler/compiler.js';

const _REPORT_SYSTEM =
  '直接输出报告正文，不要输出推理过程。\n' +   // DeepSeek-R1 guard
  '你是一位专业的数据分析师。用户将提供一份数据集的元信息，' +
  '请用自然语言撰写一份结构化的叙事性分析报告。\n' +
  '要求：\n' +
  '- 使用 ## 标题分隔各章节\n' +
  '- 每章节用流畅的中文段落叙述（若数据列名为英文可中英混用）\n' +
  '- 用 **粗体** 标注关键数字或结论\n' +
  '- 绝对不要输出代码块\n' +
  '- 章节顺序：## 数据概览 → ## 关键发现 → （有时序列时）## 趋势分析 → ## 异常与注意 → ## 建议下一步\n' +
  '- 最后一行固定输出："您还想了解什么？"';

// ── JS-side basic stats for numeric columns ──────────────────────────────────
function _numStats(rows, col) {
  const vals = rows.map(r => parseFloat(r[col])).filter(v => !isNaN(v));
  if (!vals.length) return null;
  const sorted = [...vals].sort((a, b) => a - b);
  const sum    = vals.reduce((s, v) => s + v, 0);
  return {
    min:    sorted[0],
    max:    sorted[sorted.length - 1],
    mean:   +(sum / vals.length).toFixed(3),
    median: sorted[Math.floor(sorted.length / 2)],
    count:  vals.length,
  };
}

async function _buildReportPrompt(varName) {
  let schemaRows = null;
  let ctxCols    = null;
  let shape      = null;

  // Try accurate schema from kernel first
  try {
    const schema = await getDataFrameSchema(varName);
    schemaRows = schema.rows;   // [{col, dtype, nullPct, sample}]
    shape      = schema.shape;
  } catch {}

  // Fallback to kernel context
  if (!schemaRows) {
    try {
      const ctx = await queryKernelContext();
      const entry = ctx.find(d => d.varName === varName);
      if (entry) {
        ctxCols = entry.columns.map((c, i) => ({ col: c, dtype: Object.values(entry.dtypes ?? {})[i] ?? 'unknown' }));
        shape   = entry.shape;
      }
    } catch {}
  }

  const nRows = shape?.[0] ?? '?';
  const nCols = shape?.[1] ?? '?';
  const hasDate = (schemaRows ?? ctxCols ?? []).some(r =>
    /date|time|dt|year|month|period/i.test(r.col) ||
    /datetime|timestamp/i.test(r.dtype ?? '')
  );

  let prompt =
    `数据集名称：${varName}\n` +
    `规模：${nRows} 行 × ${nCols} 列\n\n`;

  if (schemaRows?.length) {
    prompt += '各列信息（列名 / 类型 / 缺失率 / 样本值）：\n';
    schemaRows.forEach(r =>
      prompt += `  - ${r.col}（${r.dtype}）：缺失 ${r.nullPct}%，样本="${r.sample}"\n`
    );
  } else if (ctxCols?.length) {
    prompt += '各列信息（列名 / 类型）：\n';
    ctxCols.forEach(r => prompt += `  - ${r.col}（${r.dtype}）\n`);
  }

  if (hasDate) prompt += '\n⚠️ 数据集中存在时序列，请在报告中分析趋势。\n';

  prompt += `\n请根据以上信息撰写结构化分析报告。`;
  return prompt;
}

// ── Markdown-lite renderer (## h3, **bold**, think filter) ───────────────────
function _renderChunk(rawAccum, container) {
  // Filter <think>...</think> blocks (state handled by caller)
  const clean = rawAccum
    .replace(/<think>[\s\S]*?<\/think>/g, '')   // complete blocks
    .replace(/<think>[\s\S]*/g, '');             // unclosed block (still streaming)

  container.innerHTML = '';
  const lines = clean.split('\n');
  let   pBuf  = [];

  function _flushP() {
    if (!pBuf.length) return;
    const p = document.createElement('p');
    p.className = 'report-p';
    p.innerHTML = pBuf.join('<br>').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    container.appendChild(p);
    pBuf = [];
  }

  lines.forEach(line => {
    if (line.startsWith('## ')) {
      _flushP();
      const h = document.createElement('h3');
      h.className   = 'report-h3';
      h.textContent = line.slice(3).trim();
      container.appendChild(h);
    } else if (line.trim() === '') {
      _flushP();
    } else {
      pBuf.push(line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>'));
    }
  });
  _flushP();
}

// ── Modal ────────────────────────────────────────────────────────────────────
export async function openReportModal(varName) {
  // ── Overlay ─────────────────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.className = 'report-overlay';

  const modal = document.createElement('div');
  modal.className  = 'report-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');

  // ── Header ───────────────────────────────────────────────────────────────
  const hdr = document.createElement('div');
  hdr.className = 'report-hdr';

  const titles = document.createElement('div');
  const titleEl = document.createElement('div');
  titleEl.className   = 'report-title';
  titleEl.textContent = `${varName} 的智能报告`;
  const subEl = document.createElement('div');
  subEl.className   = 'report-sub';
  subEl.textContent = `生成时间：${new Date().toLocaleTimeString('zh-CN')}`;
  titles.append(titleEl, subEl);

  const closeHdrBtn = document.createElement('button');
  closeHdrBtn.className = 'report-close-btn';
  closeHdrBtn.innerHTML = '<i class="ti ti-x"></i>';
  closeHdrBtn.title     = '关闭';

  hdr.append(titles, closeHdrBtn);

  // ── Body ──────────────────────────────────────────────────────────────────
  const body = document.createElement('div');
  body.className = 'report-body';

  const loadingEl = document.createElement('div');
  loadingEl.className = 'report-loading';
  loadingEl.innerHTML = '<i class="ti ti-loader-2 report-spin"></i> 正在分析数据，请稍候…';
  body.appendChild(loadingEl);

  const contentEl = document.createElement('div');
  contentEl.className = 'report-content';
  contentEl.hidden    = true;
  body.appendChild(contentEl);

  // ── Footer ────────────────────────────────────────────────────────────────
  const footer = document.createElement('div');
  footer.className = 'report-footer';

  const chartBtn = document.createElement('button');
  chartBtn.className = 'report-footer-btn report-footer-btn--secondary';
  chartBtn.innerHTML = '<i class="ti ti-chart-bar"></i> 生成图表';
  chartBtn.disabled  = true;
  chartBtn.title     = '即将推出';

  const pdfBtn = document.createElement('button');
  pdfBtn.className = 'report-footer-btn report-footer-btn--secondary';
  pdfBtn.innerHTML = '<i class="ti ti-file-type-pdf"></i> 导出 PDF';
  pdfBtn.disabled  = true;
  pdfBtn.title     = '即将推出';

  const closeFooterBtn = document.createElement('button');
  closeFooterBtn.className = 'report-footer-btn';
  closeFooterBtn.textContent = '关闭';

  footer.append(chartBtn, pdfBtn, closeFooterBtn);

  modal.append(hdr, body, footer);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // ── Close logic ──────────────────────────────────────────────────────────
  let _abortCtrl = null;
  function _close() {
    _abortCtrl?.abort();
    overlay.remove();
  }
  closeHdrBtn.addEventListener('click', _close);
  closeFooterBtn.addEventListener('click', _close);
  overlay.addEventListener('click', e => { if (e.target === overlay) _close(); });
  document.addEventListener('keydown', function _esc(e) {
    if (e.key === 'Escape') { _close(); document.removeEventListener('keydown', _esc); }
  });

  // ── Generate report ───────────────────────────────────────────────────────
  let rawAccum  = '';
  let inThink   = false;

  try {
    const prompt = await _buildReportPrompt(varName);

    loadingEl.hidden  = false;
    contentEl.hidden  = true;

    _abortCtrl = new AbortController();

    let started = false;
    for await (const chunk of streamChat(
      [{ role: 'user', content: prompt }],
      _REPORT_SYSTEM,
      2000,
    )) {
      if (_abortCtrl.signal.aborted) break;

      // DeepSeek-R1 think-block state machine
      rawAccum += chunk;

      if (!started) {
        started = true;
        loadingEl.hidden  = true;
        contentEl.hidden  = false;
      }

      _renderChunk(rawAccum, contentEl);
      body.scrollTop = body.scrollHeight;
    }

    // Done — unlock action buttons
    chartBtn.disabled = false;
    pdfBtn.disabled   = false;

  } catch (err) {
    loadingEl.hidden  = true;
    contentEl.hidden  = false;
    contentEl.innerHTML =
      `<p class="report-error"><i class="ti ti-alert-circle"></i> 生成失败：${err.message}</p>`;
  }
}
