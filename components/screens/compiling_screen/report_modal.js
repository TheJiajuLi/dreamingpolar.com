// ── DataFrame 智能报告 Modal ──────────────────────────────────────────────────
// Phase 1: AI 叙事性数据分析，流式渲染，DeepSeek-R1 think 块过滤
// Phase 2: 智能图表自动生成（时序/分布/相关性/分类）

import { streamChat, ask }                               from '../../ai/ai_client.js';
import { getDataFrameSchema, queryKernelContext, getDataSample } from '../../compiler/compiler.js';

// ── Chart.js 懒加载（复用 ARIA 同一 window.Chart 单例）────────────────────────
const _CHART_CDN = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js';
let _chartJsP = null;
function _loadChartJs() {
  if (window.Chart) return Promise.resolve();
  if (_chartJsP)    return _chartJsP;
  _chartJsP = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src     = _CHART_CDN;
    s.onload  = res;
    s.onerror = () => rej(new Error('Chart.js 加载失败'));
    document.head.appendChild(s);
  });
  return _chartJsP;
}

// ── 皮尔逊相关系数 ─────────────────────────────────────────────────────────────
function _pearson(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  let sumA = 0, sumB = 0, sumAB = 0, sumA2 = 0, sumB2 = 0;
  for (let i = 0; i < n; i++) {
    sumA += a[i]; sumB += b[i]; sumAB += a[i]*b[i];
    sumA2 += a[i]*a[i]; sumB2 += b[i]*b[i];
  }
  const num = n*sumAB - sumA*sumB;
  const den = Math.sqrt((n*sumA2 - sumA**2) * (n*sumB2 - sumB**2));
  return den === 0 ? 0 : +(num/den).toFixed(3);
}

// ── 自动决定生成哪3张图 ────────────────────────────────────────────────────────
function _decideCharts(rows, schema) {
  if (!rows?.length || !schema?.rows?.length) return [];

  const cols     = schema.rows;
  const numCols  = cols.filter(c => /float|int/.test(c.dtype));
  const dateCols = cols.filter(c => /datetime|date|time/i.test(c.dtype) || /date|time|dt|year|month|period/i.test(c.col));
  const catCols  = cols.filter(c => c.dtype === 'object').filter(c => {
    const uniq = new Set(rows.map(r => r[c.col])).size;
    return uniq >= 2 && uniq <= 20;
  });

  const charts = [];

  // 1. 时序折线图（最高优先）
  if (dateCols.length && numCols.length) {
    charts.push({ type: 'line', dateCol: dateCols[0].col, numCols: numCols.map(c => c.col) });
  }

  // 2. 相关性热力图（≥2 数值列，用气泡图模拟）
  if (numCols.length >= 2 && charts.length < 3) {
    charts.push({ type: 'bubble-corr', numCols: numCols.map(c => c.col) });
  }

  // 3. 分布直方图（每个数值列，最多2个）
  for (const nc of numCols.slice(0, 2)) {
    if (charts.length >= 3) break;
    charts.push({ type: 'histogram', col: nc.col });
  }

  // 4. 分类柱状图（无数值列时顶上）
  for (const cc of catCols) {
    if (charts.length >= 3) break;
    if (!charts.some(c => c.type === 'bar' && c.col === cc.col))
      charts.push({ type: 'bar', col: cc.col });
  }

  return charts.slice(0, 3);
}

// ── 单图渲染 ────────────────────────────────────────────────────────────────────
const _ACCENT = '#6366f1';
const _GREEN  = '#16a34a';
const _RED    = '#ef4444';
const _PALETTE = ['#6366f1','#16a34a','#f59e0b','#0ea5e9','#ec4899','#14b8a6'];

function _renderChartOnCanvas(canvas, cfg, rows, schema) {
  const C = window.Chart;
  const existing = C.getChart(canvas);
  if (existing) existing.destroy();

  switch (cfg.type) {
    case 'line': {
      const pts = rows.slice(0, 300);
      const labels = pts.map(r => String(r[cfg.dateCol]));
      const datasets = cfg.numCols.slice(0, 4).map((col, i) => ({
        label: col,
        data: pts.map(r => parseFloat(r[col]) || null),
        borderColor: _PALETTE[i % _PALETTE.length],
        backgroundColor: 'transparent',
        borderWidth: 1.5,
        pointRadius: 0,
        tension: 0.3,
      }));
      new C(canvas, { type: 'line', data: { labels, datasets },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } } },
          scales: { x: { ticks: { maxTicksLimit: 6, font: { size: 10 } } }, y: { ticks: { font: { size: 10 } } } } } });
      break;
    }
    case 'histogram': {
      const vals = rows.map(r => parseFloat(r[cfg.col])).filter(v => !isNaN(v));
      if (!vals.length) break;
      const min = Math.min(...vals), max = Math.max(...vals);
      const binCount = Math.min(20, Math.ceil(Math.sqrt(vals.length)));
      const binW = (max - min) / binCount || 1;
      const bins = Array.from({ length: binCount }, (_, i) => ({
        label: (min + i * binW).toFixed(2),
        count: 0,
      }));
      vals.forEach(v => {
        const idx = Math.min(binCount - 1, Math.floor((v - min) / binW));
        bins[idx].count++;
      });
      new C(canvas, { type: 'bar',
        data: { labels: bins.map(b => b.label), datasets: [{ label: cfg.col, data: bins.map(b => b.count), backgroundColor: _ACCENT + 'aa', borderColor: _ACCENT, borderWidth: 1 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
          scales: { x: { ticks: { maxTicksLimit: 8, font: { size: 9 } } }, y: { ticks: { font: { size: 10 } } } } } });
      break;
    }
    case 'bar': {
      const freq = {};
      rows.forEach(r => { const v = String(r[cfg.col] ?? ''); freq[v] = (freq[v] || 0) + 1; });
      const sorted = Object.entries(freq).sort((a,b) => b[1]-a[1]).slice(0, 15);
      new C(canvas, { type: 'bar',
        data: { labels: sorted.map(([k]) => k), datasets: [{ label: cfg.col, data: sorted.map(([,v]) => v), backgroundColor: _GREEN + 'aa', borderColor: _GREEN, borderWidth: 1 }] },
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
          scales: { x: { ticks: { font: { size: 10 } } }, y: { ticks: { font: { size: 9 } } } } } });
      break;
    }
    case 'bubble-corr': {
      // 气泡图模拟相关性矩阵
      const numCols = cfg.numCols.slice(0, 6);
      const data = [];
      numCols.forEach((ca, i) => {
        numCols.forEach((cb, j) => {
          if (i >= j) return;
          const a = rows.map(r => parseFloat(r[ca])).filter(v => !isNaN(v));
          const b = rows.map(r => parseFloat(r[cb])).filter(v => !isNaN(v));
          const r_ = _pearson(a, b);
          data.push({ x: i, y: j, r: Math.abs(r_) * 18 + 3, corr: r_, ca, cb });
        });
      });
      const datasets = [
        { label: '正相关', data: data.filter(d => d.corr >= 0),
          backgroundColor: ctx => `rgba(22,163,74,${0.3 + Math.abs(ctx.raw?.corr||0) * 0.6})` },
        { label: '负相关', data: data.filter(d => d.corr < 0),
          backgroundColor: ctx => `rgba(239,68,68,${0.3 + Math.abs(ctx.raw?.corr||0) * 0.6})` },
      ];
      new C(canvas, { type: 'bubble', data: { datasets },
        options: { responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom', labels: { font: { size: 10 } } },
            tooltip: { callbacks: { label: ctx => `${ctx.raw.ca}↔${ctx.raw.cb}: ${ctx.raw.corr}` } } },
          scales: {
            x: { min: -0.5, max: numCols.length - 0.5, ticks: { callback: v => numCols[v] ?? '', font: { size: 9 }, maxTicksLimit: numCols.length }, grid: { display: false } },
            y: { min: 0.5, max: numCols.length - 0.5, ticks: { callback: v => numCols[v] ?? '', font: { size: 9 }, maxTicksLimit: numCols.length }, grid: { display: false } },
          } } });
      break;
    }
  }
}

// ── 单图 AI 解读（一句话）─────────────────────────────────────────────────────
async function _chartInsight(cfg, rows, schema) {
  const colMeta = (col) => {
    const s = schema.rows.find(r => r.col === col);
    const vals = rows.map(r => parseFloat(r[col])).filter(v => !isNaN(v));
    if (!vals.length) return `${col}`;
    const min = Math.min(...vals).toFixed(2);
    const max = Math.max(...vals).toFixed(2);
    const mean = (vals.reduce((s,v) => s+v, 0) / vals.length).toFixed(2);
    return `${col}(min=${min},max=${max},mean=${mean})`;
  };

  let desc = '';
  if (cfg.type === 'line') {
    desc = `时序折线图，X轴=${cfg.dateCol}，Y轴数值列：${cfg.numCols.map(colMeta).join('；')}`;
  } else if (cfg.type === 'histogram') {
    desc = `${cfg.col} 列的分布直方图，${colMeta(cfg.col)}`;
  } else if (cfg.type === 'bar') {
    const freq = {};
    rows.forEach(r => { const v = String(r[cfg.col] ?? ''); freq[v] = (freq[v] || 0) + 1; });
    const top3 = Object.entries(freq).sort((a,b) => b[1]-a[1]).slice(0,3).map(([k,v]) => `${k}(${v}次)`).join('、');
    desc = `${cfg.col} 列的频次柱状图，前3位：${top3}`;
  } else if (cfg.type === 'bubble-corr') {
    desc = `${cfg.numCols.join('、')} 之间的相关性气泡图`;
  }

  try {
    const reply = await ask(
      `数据图表描述：${desc}\n请用一句话（不超过40字）说出最重要的发现，直接陈述结论，不要以"这是"或"该图"开头。`,
      '你是数据分析师，用简洁中文一句话描述图表的核心发现。不超过40字，直接给结论。',
      80
    );
    return reply.trim();
  } catch {
    return desc;
  }
}

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

// ── PDF 导出（浏览器 print → Save as PDF）────────────────────────────────────
function _exportPDF(varName, contentEl) {
  // Convert all canvas elements to static <img> so they print correctly
  const clone = contentEl.cloneNode(true);
  const origCanvases = contentEl.querySelectorAll('canvas');
  const cloneCanvases = clone.querySelectorAll('canvas');
  origCanvases.forEach((c, i) => {
    const img = document.createElement('img');
    img.src   = c.toDataURL('image/png');
    img.style.cssText = 'width:100%;display:block;border-radius:6px';
    cloneCanvases[i]?.replaceWith(img);
  });

  const now  = new Date().toLocaleString('zh-CN');
  const html = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<title>${varName} 智能报告</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", sans-serif;
         color: #0f172a; background: #fff; padding: 32px 40px; }
  h1   { font-size: 1.4rem; font-weight: 700; margin-bottom: 4px; }
  .sub { font-size: 0.75rem; color: #94a3b8; margin-bottom: 28px; }
  h3.rh { font-size: 0.78rem; font-weight: 700; color: #6366f1;
           text-transform: uppercase; letter-spacing: 0.06em;
           border-bottom: 1px solid #e0e3ff; padding-bottom: 4px;
           margin: 22px 0 10px; }
  p  { font-size: 0.86rem; line-height: 1.8; margin-bottom: 10px; }
  strong { font-weight: 700; }
  .charts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-top: 16px; }
  .chart-card { border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
  .chart-card img { width: 100%; display: block; }
  .insight { font-size: 0.72rem; color: #64748b; font-style: italic;
             padding: 6px 10px 8px; border-top: 1px solid #f1f5f9; }
  @media print {
    body { padding: 20px 28px; }
    .charts { grid-template-columns: repeat(2, 1fr); }
    @page { margin: 1.5cm; size: A4; }
  }
</style>
</head>
<body>
<h1>${varName} 的智能报告</h1>
<div class="sub">生成时间：${now} · Dreaming Polar</div>
${_cloneToHtml(clone)}
</body>
</html>`;

  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) { alert('请允许弹出窗口后重试'); return; }
  win.document.write(html);
  win.document.close();
  // Auto-trigger print after images load
  win.addEventListener('load', () => {
    setTimeout(() => { win.focus(); win.print(); }, 300);
  });
}

function _cloneToHtml(el) {
  // Convert the cloned DOM to a print-friendly HTML string
  const tmp = document.createElement('div');
  // Remap classes to inline-friendly equivalents
  el.querySelectorAll('.report-h3').forEach(h => h.setAttribute('class', 'rh'));
  el.querySelectorAll('.report-charts-grid').forEach(g => g.setAttribute('class', 'charts'));
  el.querySelectorAll('.report-chart-card').forEach(c => c.setAttribute('class', 'chart-card'));
  el.querySelectorAll('.report-chart-canvas-wrap').forEach(w => {
    // wrap already has <img> from canvas replacement, remove the div wrapper
    w.replaceWith(...w.childNodes);
  });
  el.querySelectorAll('.report-chart-insight').forEach(i => i.setAttribute('class', 'insight'));
  el.querySelectorAll('.report-charts-section > h3').forEach(h => h.setAttribute('class', 'rh'));
  tmp.appendChild(el);
  return tmp.innerHTML;
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

  // Keep a ref to schema for chart generation after report finishes
  let _cachedSchema = null;

  const chartBtn = document.createElement('button');
  chartBtn.className = 'report-footer-btn report-footer-btn--secondary';
  chartBtn.innerHTML = '<i class="ti ti-chart-bar"></i> 生成图表';
  chartBtn.disabled  = true;
  chartBtn.title     = '报告生成完成后解锁';

  const pdfBtn = document.createElement('button');
  pdfBtn.className = 'report-footer-btn report-footer-btn--secondary';
  pdfBtn.innerHTML = '<i class="ti ti-file-type-pdf"></i> 导出 PDF';
  pdfBtn.disabled  = true;
  pdfBtn.title     = '报告生成完成后解锁';
  pdfBtn.addEventListener('click', () => _exportPDF(varName, contentEl));

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

  // ── Generate charts ────────────────────────────────────────────────────────
  chartBtn.addEventListener('click', async () => {
    chartBtn.disabled = true;
    chartBtn.innerHTML = '<i class="ti ti-loader-2 report-spin"></i> 生成中…';

    let rows = null;
    try { rows = await getDataSample(varName, 300); } catch {}

    const schema = _cachedSchema;
    if (!rows?.length || !schema) {
      chartBtn.innerHTML = '<i class="ti ti-chart-bar"></i> 暂无数据';
      return;
    }

    await _loadChartJs();

    const chartsConfig = _decideCharts(rows, schema);
    if (!chartsConfig.length) {
      chartBtn.innerHTML = '<i class="ti ti-chart-bar"></i> 无可用图表';
      return;
    }

    // Charts section header (same h3 style as report)
    const section = document.createElement('div');
    section.className = 'report-charts-section';
    const secHdr = document.createElement('h3');
    secHdr.className   = 'report-h3';
    secHdr.textContent = '数据可视化';
    section.appendChild(secHdr);

    const grid = document.createElement('div');
    grid.className = 'report-charts-grid';
    section.appendChild(grid);

    contentEl.appendChild(section);
    body.scrollTop = body.scrollHeight;

    // Generate charts one by one (逐张显示)
    for (const cfg of chartsConfig) {
      const card = document.createElement('div');
      card.className = 'report-chart-card';

      const canvasWrap = document.createElement('div');
      canvasWrap.className = 'report-chart-canvas-wrap';
      const canvas = document.createElement('canvas');
      canvasWrap.appendChild(canvas);

      const insightEl = document.createElement('div');
      insightEl.className   = 'report-chart-insight';
      insightEl.textContent = '分析中…';

      card.append(canvasWrap, insightEl);
      grid.appendChild(card);
      body.scrollTop = body.scrollHeight;

      // Render chart
      try { _renderChartOnCanvas(canvas, cfg, rows, schema); } catch (e) {
        insightEl.textContent = '图表渲染失败';
        continue;
      }

      // AI one-line insight
      try {
        insightEl.textContent = await _chartInsight(cfg, rows, schema);
      } catch {
        insightEl.textContent = '';
      }
      body.scrollTop = body.scrollHeight;
    }

    chartBtn.innerHTML = '<i class="ti ti-chart-bar"></i> 已生成';
    chartBtn.disabled = false;
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

    // Done — unlock action buttons; cache schema
    try { _cachedSchema = await getDataFrameSchema(varName); } catch {}
    chartBtn.disabled = false;
    chartBtn.title    = '基于数据自动生成图表';
    pdfBtn.disabled   = false;

  } catch (err) {
    loadingEl.hidden  = true;
    contentEl.hidden  = false;
    contentEl.innerHTML =
      `<p class="report-error"><i class="ti ti-alert-circle"></i> 生成失败：${err.message}</p>`;
  }
}
