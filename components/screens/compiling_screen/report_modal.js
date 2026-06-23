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

// ── PDF 导出（html2canvas + jsPDF → 自动下载，与 CSV/XML 导出行为一致）────────
const _H2C_CDN  = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
const _JSPDF_CDN = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
let _pdfLibsP = null;

function _loadPdfLibs() {
  if (window.html2canvas && window.jspdf) return Promise.resolve();
  if (_pdfLibsP) return _pdfLibsP;
  const load = src => new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res;
    s.onerror = () => rej(new Error(`加载失败: ${src}`));
    document.head.appendChild(s);
  });
  _pdfLibsP = load(_H2C_CDN).then(() => load(_JSPDF_CDN));
  return _pdfLibsP;
}

async function _exportPDF(varName, contentEl, pdfBtn) {
  const orig = pdfBtn.innerHTML;
  pdfBtn.disabled = true;
  pdfBtn.innerHTML = '<i class="ti ti-loader-2 report-spin"></i> 生成中…';

  try {
    await _loadPdfLibs();
    const { jsPDF } = window.jspdf;

    // ── Capture the already-rendered report-body (fonts are loaded + correct) ──
    // Off-screen clones fail CJK font loading; the live DOM has it right.
    const reportBody = contentEl.closest('.report-modal')?.querySelector('.report-body')
                    ?? contentEl.parentElement;

    // Temporarily expand scroll area so html2canvas sees the full content
    const saved = { overflow: reportBody.style.overflow, maxHeight: reportBody.style.maxHeight,
                    height: reportBody.style.height };
    reportBody.style.overflow  = 'visible';
    reportBody.style.maxHeight = 'none';
    reportBody.style.height    = 'auto';

    // Hide interactive areas that shouldn't appear in PDF
    const followup = reportBody.querySelector('.report-followup');
    if (followup) followup.style.visibility = 'hidden';
    const loading  = reportBody.querySelector('.report-loading');
    if (loading)  loading.style.display = 'none';

    const canvas = await window.html2canvas(reportBody, {
      scale: 1.5,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
      scrollX: 0,
      scrollY: -window.scrollY,
    });

    // Restore
    reportBody.style.overflow  = saved.overflow;
    reportBody.style.maxHeight = saved.maxHeight;
    reportBody.style.height    = saved.height;
    if (followup) followup.style.visibility = '';
    if (loading)  loading.style.display = '';

    // ── Tile canvas onto A4 pages ─────────────────────────────────────────────
    const a4W_px   = canvas.width;                         // at scale 1.5
    const a4H_px   = Math.round(a4W_px * 297 / 210);      // A4 aspect ratio

    const pdf        = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const totalPages = Math.ceil(canvas.height / a4H_px);

    for (let p = 0; p < totalPages; p++) {
      if (p > 0) pdf.addPage();
      const srcY  = p * a4H_px;
      const cropH = Math.min(a4H_px, canvas.height - srcY);

      const pageCanvas     = document.createElement('canvas');
      pageCanvas.width     = a4W_px;
      pageCanvas.height    = a4H_px;
      const ctx = pageCanvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, a4W_px, a4H_px);
      ctx.drawImage(canvas, 0, srcY, a4W_px, cropH, 0, 0, a4W_px, cropH);

      pdf.addImage(pageCanvas.toDataURL('image/jpeg', 0.88), 'JPEG', 0, 0, 210, 297, '', 'FAST');
    }

    pdf.save(`${varName}_智能报告.pdf`);
    pdfBtn.innerHTML = '<i class="ti ti-check"></i> 已下载';
    setTimeout(() => { pdfBtn.innerHTML = orig; pdfBtn.disabled = false; }, 2500);

  } catch (err) {
    console.error('[PDF]', err);
    pdfBtn.innerHTML = '<i class="ti ti-alert-circle"></i> 生成失败';
    setTimeout(() => { pdfBtn.innerHTML = orig; pdfBtn.disabled = false; }, 2500);
  }
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
  pdfBtn.addEventListener('click', () => _exportPDF(varName, contentEl, pdfBtn));

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

  // ── Followup conversation area (hidden until report done) ───────────────────
  const followupEl = document.createElement('div');
  followupEl.className = 'report-followup';
  followupEl.hidden    = true;
  body.appendChild(followupEl);

  const fuInner = document.createElement('div');
  fuInner.className = 'ai-dialog-main';

  const fuInputWrap = document.createElement('div');
  fuInputWrap.className = 'ai-input-wrap';

  const fuSpark = document.createElement('i');
  fuSpark.className = 'ti ti-sparkles';
  fuSpark.style.cssText = 'color:var(--accent,#6366f1);font-size:13px;flex-shrink:0';

  const fuInput = document.createElement('input');
  fuInput.className    = 'ai-header-input';
  fuInput.type         = 'text';
  fuInput.placeholder  = '您还想了解什么？';
  fuInput.autocomplete = 'off';
  fuInput.spellcheck   = false;

  const fuSendBtn = document.createElement('button');
  fuSendBtn.className = 'ai-header-submit';
  fuSendBtn.title     = '发送 (Enter)';
  fuSendBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;

  fuInputWrap.append(fuSpark, fuInput);
  fuInner.append(fuInputWrap, fuSendBtn);
  followupEl.appendChild(fuInner);

  // ── Conversation history for multi-turn ──────────────────────────────────
  let _dataPrompt = '';
  let _reportText = '';
  let _convHistory = [];  // [{role,content}, ...]

  let _fuBusy = false;

  async function _sendFollowup() {
    const question = fuInput.value.trim();
    if (!question || _fuBusy) return;
    _fuBusy = true;
    fuInput.value    = '';
    fuInput.disabled = true;
    fuSendBtn.disabled = true;

    // ── User bubble ─────────────────────────────────────────────────────────
    const bubble = document.createElement('div');
    bubble.className   = 'report-followup-bubble';
    bubble.textContent = question;
    contentEl.appendChild(bubble);
    body.scrollTop = body.scrollHeight;

    // ── AI response container ────────────────────────────────────────────────
    const responseDiv = document.createElement('div');
    responseDiv.className = 'report-followup-response';
    contentEl.appendChild(responseDiv);
    body.scrollTop = body.scrollHeight;

    // Build messages: data context + report + history + new question
    const messages = [
      { role: 'user',      content: _dataPrompt  },
      { role: 'assistant', content: _reportText   },
      ..._convHistory,
      { role: 'user',      content: question      },
    ];

    let fuAccum = '';
    try {
      for await (const chunk of streamChat(messages, _REPORT_SYSTEM, 1000)) {
        fuAccum += chunk;
        _renderChunk(fuAccum, responseDiv);
        body.scrollTop = body.scrollHeight;
      }
    } catch (err) {
      responseDiv.innerHTML =
        `<p class="report-error"><i class="ti ti-alert-circle"></i> ${err.message}</p>`;
    }

    // Accumulate for next turn
    _convHistory.push({ role: 'user',      content: question });
    _convHistory.push({ role: 'assistant', content: fuAccum  });

    _fuBusy = false;
    fuInput.disabled = false;
    fuSendBtn.disabled = false;
    fuInput.focus();
    body.scrollTop = body.scrollHeight;
  }

  fuInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _sendFollowup(); }
  });
  fuSendBtn.addEventListener('click', _sendFollowup);

  // ── Generate report ───────────────────────────────────────────────────────
  let rawAccum  = '';

  try {
    _dataPrompt = await _buildReportPrompt(varName);

    loadingEl.hidden  = false;
    contentEl.hidden  = true;

    _abortCtrl = new AbortController();

    let started = false;
    for await (const chunk of streamChat(
      [{ role: 'user', content: _dataPrompt }],
      _REPORT_SYSTEM,
      2000,
    )) {
      if (_abortCtrl.signal.aborted) break;

      rawAccum += chunk;
      _reportText = rawAccum;   // keep in sync for followup context

      if (!started) {
        started = true;
        loadingEl.hidden  = true;
        contentEl.hidden  = false;
      }

      _renderChunk(rawAccum, contentEl);
      body.scrollTop = body.scrollHeight;
    }

    // Done — unlock action buttons; cache schema; show followup
    try { _cachedSchema = await getDataFrameSchema(varName); } catch {}
    chartBtn.disabled = false;
    chartBtn.title    = '基于数据自动生成图表';
    pdfBtn.disabled   = false;
    followupEl.hidden = false;
    fuInput.focus();

  } catch (err) {
    loadingEl.hidden  = true;
    contentEl.hidden  = false;
    contentEl.innerHTML =
      `<p class="report-error"><i class="ti ti-alert-circle"></i> 生成失败：${err.message}</p>`;
  }
}
