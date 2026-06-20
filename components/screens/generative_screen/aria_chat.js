import { getDataset, getAllDatasets, setActiveDataset } from '../../shared/dataset_store.js';

// ── Chart.js lazy loader ──────────────────────────────────────────────────────
const _CHART_JS_CDN = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js';
let _chartJsPromise = null;
function _loadChartJs() {
  if (window.Chart) return Promise.resolve();
  if (_chartJsPromise) return _chartJsPromise;
  _chartJsPromise = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = _CHART_JS_CDN; s.onload = res;
    s.onerror = () => rej(new Error('Chart.js load failed'));
    document.head.appendChild(s);
  });
  return _chartJsPromise;
}

// ── Build prompt from dataset_store (pure JS, no Python) ──────────────────────
function _buildPrompt(question) {
  const ds = getDataset();
  if (!ds) return question;
  const colLines = ds.columns.map(c => `  ${c}: ${ds.dtypes[c]}`).join('\n');
  const sample   = ds.rows.slice(0, 3);
  return (
    `[当前数据集]\n${ds.name} — ${ds.rows.length.toLocaleString()} 行 × ${ds.columns.length} 列\n` +
    `列名与类型:\n${colLines}\n\n前3行样本:\n${JSON.stringify(sample, null, 2)}\n\n用户问题: ${question}`
  );
}

// ── System prompt ─────────────────────────────────────────────────────────────
const _SYSTEM =
  `你是 ARIA，Dreaming Polar 的数据分析助理。\n` +
  `用清晰、有见地的语言回答关于这份数据的问题。\n\n` +
  `分析原则：\n` +
  `• 始终引用真实的列名和具体数字，不要泛泛而谈\n` +
  `• 发现 customer_id/purchase_date/amount 等字段时建议 RFM 分层\n` +
  `• 发现时间字段时建议趋势分析\n` +
  `• 回答简洁有结构，用列表和粗体突出重点\n` +
  `• 语言跟随用户（中文或英文）\n` +
  `• 没有数据时告知用户先导入文件\n\n` +
  `图表指令（重要）：\n` +
  `• 当建议查看某数值列的分布时，在回答最后一行单独写：CHART: histogram(列名)\n` +
  `• 当建议比较两列关系时，在回答最后一行单独写：CHART: scatter(列名1, 列名2)\n` +
  `• 这一行必须独立，不含其他文字，不加标点\n` +
  `• 只在真正有帮助时才写，不要每次都写`;

// ── Parse CHART marker ────────────────────────────────────────────────────────
function _parseChartMarker(text) {
  const m = text.match(/^CHART:\s*(histogram|scatter)\(([^)]+)\)\s*$/im);
  if (!m) return null;
  return { type: m[1].toLowerCase(), cols: m[2].split(',').map(s => s.trim()) };
}

// ── Histogram config from real data ──────────────────────────────────────────
function _histogramConfig(colName, ds) {
  const values = ds.rows.map(r => parseFloat(r[colName])).filter(v => !isNaN(v));
  if (!values.length) return null;
  const min = Math.min(...values), max = Math.max(...values);
  const binCount = Math.min(20, Math.max(5, Math.ceil(Math.sqrt(values.length))));
  const binSize  = (max - min || 1) / binCount;
  const bins = Array(binCount).fill(0);
  values.forEach(v => { bins[Math.min(binCount-1, Math.floor((v-min)/binSize))]++; });
  return {
    type: 'bar',
    data: {
      labels: bins.map((_, i) => (min + i * binSize).toFixed(2)),
      datasets: [{ label: colName, data: bins,
        backgroundColor: 'rgba(249,115,22,0.65)', borderColor: 'rgba(249,115,22,1)',
        borderWidth: 1, borderRadius: 2 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false },
        title: { display: true, text: `分布：${colName}`, font: { size: 11 } } },
      scales: { x: { ticks: { maxRotation: 35, maxTicksLimit: 10 } } },
    },
  };
}

// ── Scatter config from real data ─────────────────────────────────────────────
function _scatterConfig(col1, col2, ds) {
  const pts = ds.rows.map(r => ({ x: parseFloat(r[col1]), y: parseFloat(r[col2]) }))
                     .filter(p => !isNaN(p.x) && !isNaN(p.y)).slice(0, 500);
  if (!pts.length) return null;
  return {
    type: 'scatter',
    data: { datasets: [{ label: `${col1} vs ${col2}`, data: pts,
      backgroundColor: 'rgba(249,115,22,0.55)', pointRadius: 3 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { title: { display: true, text: `${col1} × ${col2}`, font: { size: 11 } } },
      scales: {
        x: { title: { display: true, text: col1, font: { size: 10 } } },
        y: { title: { display: true, text: col2, font: { size: 10 } } },
      },
    },
  };
}

// ── Render chart into card ────────────────────────────────────────────────────
async function _renderChart(card, marker) {
  const ds = getDataset();
  if (!ds) return;
  await _loadChartJs();
  let cfg = null;
  if (marker.type === 'histogram' && marker.cols.length >= 1)
    cfg = _histogramConfig(marker.cols[0], ds);
  else if (marker.type === 'scatter' && marker.cols.length >= 2)
    cfg = _scatterConfig(marker.cols[0], marker.cols[1], ds);
  if (!cfg) return;
  const wrap = document.createElement('div');
  wrap.className = 'aria-chat-card-chart';
  const canvas = document.createElement('canvas');
  wrap.appendChild(canvas);
  card.appendChild(wrap);
  new window.Chart(canvas, cfg);
}

// ── Formatter ─────────────────────────────────────────────────────────────────
function _fmt(text) {
  const clean = text.replace(/^CHART:\s*\w+\([^)]*\)\s*$/gim, '').trim();
  return clean
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>')
    .replace(/`([^`\n]+)`/g,'<code>$1</code>')
    .replace(/\n/g,'<br>');
}
function _esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function _time() { return new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}); }

// ── Chat card ─────────────────────────────────────────────────────────────────
function _makeCard(question, messagesEl) {
  const card = document.createElement('div');
  card.className = 'aria-chat-card';
  const hdr = document.createElement('div');
  hdr.className = 'aria-chat-card-hdr';
  hdr.innerHTML =
    `<span class="aria-chat-card-label">ARIA</span>` +
    `<span class="aria-chat-card-q">${_esc(question.length>55?question.slice(0,55)+'…':question)}</span>` +
    `<span class="aria-chat-card-time">${_time()}</span>`;
  const body = document.createElement('div');
  body.className = 'aria-chat-card-body';
  const cursor = document.createElement('span');
  cursor.className = 'aria-chat-card-cursor'; cursor.textContent = '▋';
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

  const header = document.createElement('div');
  header.className = 'aria-chat-header';
  header.innerHTML =
    `<span class="aria-chat-header-label">ARIA</span>` +
    `<span class="aria-chat-header-sub">数据分析助理</span>` +
    `<span class="aria-chat-header-dot" id="aria-chat-dot"></span>`;

  // ── Dataset switcher strip (hidden until ≥1 dataset imported) ─────────────
  const dsTabs = document.createElement('div');
  dsTabs.className   = 'aria-ds-tabs';
  dsTabs.style.display = 'none';   // hidden until first import

  function _rebuildTabs(all, activeIdx) {
    dsTabs.innerHTML = '';
    if (!all.length) { dsTabs.style.display = 'none'; return; }
    dsTabs.style.display = '';
    all.forEach((ds, i) => {
      const tab = document.createElement('button');
      tab.className = 'aria-ds-tab' + (i === activeIdx ? ' aria-ds-tab--active' : '');
      tab.title     = ds.name;
      tab.textContent = ds.name.length > 18 ? ds.name.slice(0, 16) + '…' : ds.name;
      tab.addEventListener('click', () => setActiveDataset(ds.name));
      dsTabs.appendChild(tab);
    });
  }

  // React to dataset changes: always rebuild tabs
  document.addEventListener('dataset-updated', ({ detail }) => {
    if (!detail) return;
    _rebuildTabs(detail.all ?? [], detail.activeIdx ?? 0);
  });

  const messages = document.createElement('div');
  messages.className = 'aria-chat-messages';

  const welcome = document.createElement('div');
  welcome.className = 'aria-chat-welcome';
  welcome.innerHTML =
    `<div class="aria-chat-welcome-title">导入数据后开始对话</div>` +
    `<div class="aria-chat-welcome-hint">上传 CSV / Excel 文件，然后用自然语言提问。ARIA 会引用真实的列名、数字，并在需要时直接生成图表。</div>` +
    `<div class="aria-chat-welcome-chips">` +
    `<span class="aria-chat-chip" data-q="这些数据有什么特点？">这些数据有什么特点？</span>` +
    `<span class="aria-chat-chip" data-q="帮我做客户分层分析">客户分层分析</span>` +
    `<span class="aria-chat-chip" data-q="哪些列有空值？">空值情况</span>` +
    `<span class="aria-chat-chip" data-q="给我看第一个数值列的分布">列分布图</span>` +
    `</div>`;
  messages.appendChild(welcome);

  const inputRow = document.createElement('div');
  inputRow.className = 'aria-chat-input-row';
  const input = document.createElement('input');
  input.className = 'aria-chat-input'; input.type = 'text';
  input.autocomplete = 'off'; input.spellcheck = false;
  input.placeholder = '问一句关于你数据的问题…';
  input.setAttribute('aria-label','提问 ARIA');
  const sendBtn = document.createElement('button');
  sendBtn.className = 'aria-chat-send'; sendBtn.title = '发送 (Enter)';
  sendBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
  inputRow.append(input, sendBtn);
  root.append(header, dsTabs, messages, inputRow);

  let _busy = false;

  async function _submit() {
    const question = input.value.trim();
    if (!question || _busy) return;
    _busy = true; input.value = ''; input.disabled = true; sendBtn.disabled = true;
    welcome.style.display = 'none';
    const dot = root.querySelector('#aria-chat-dot');
    if (dot) dot.classList.add('aria-chat-dot--active');
    const { card, body } = _makeCard(question, messages);
    try {
      const prompt = _buildPrompt(question);
      const { streamChat } = await import('../../ai/ai_client.js');
      let fullReply = '';
      body.innerHTML = '';
      const cur = document.createElement('span');
      cur.className = 'aria-chat-card-cursor'; cur.textContent = '▋';
      body.appendChild(cur);
      for await (const chunk of streamChat([{role:'user',content:prompt}], _SYSTEM, 1200)) {
        fullReply += chunk;
        body.innerHTML = _fmt(fullReply);
        const c2 = document.createElement('span');
        c2.className = 'aria-chat-card-cursor'; c2.textContent = '▋';
        body.appendChild(c2);
        messages.scrollTop = messages.scrollHeight;
      }
      body.innerHTML = _fmt(fullReply);
      // Parse CHART marker — render real chart from actual dataset_store data
      const marker = _parseChartMarker(fullReply);
      if (marker && getDataset()) await _renderChart(card, marker);
      // Dataset badge — shows WHICH dataset this answer is based on
      const ds = getDataset();
      if (ds) {
        const badge = document.createElement('div');
        badge.className = 'aria-chat-card-meta';
        badge.innerHTML = `<span style="opacity:.5">基于</span> <strong>${_esc(ds.name)}</strong> · ${ds.rows.length.toLocaleString()} 行 × ${ds.columns.length} 列`;
        card.appendChild(badge);
      }
    } catch (e) {
      body.innerHTML = `<span class="aria-chat-err">⚠ ${_esc(e.message)}</span>`;
    } finally {
      _busy = false; input.disabled = false; sendBtn.disabled = false;
      input.focus(); if (dot) dot.classList.remove('aria-chat-dot--active');
      messages.scrollTop = messages.scrollHeight;
    }
  }

  input.addEventListener('keydown', e => {
    if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); _submit(); }
  });
  sendBtn.addEventListener('click', _submit);
  messages.addEventListener('click', e => {
    const chip = e.target.closest('.aria-chat-chip');
    if (chip) { input.value = chip.dataset.q; input.focus(); }
  });

  root._onDataLoaded = (name) => {
    welcome.style.display = 'none';
    const ds = getDataset();
    const displayName = name || ds?.name || 'file';
    const divider = document.createElement('div');
    divider.className = 'aria-chat-divider aria-chat-divider--import';
    divider.innerHTML =
      `<span class="aria-chat-divider-label">📥 已加载 <strong>${_esc(displayName)}</strong>` +
      ` &nbsp;<span style="opacity:.55;font-weight:400">${(ds?.rows?.length||0).toLocaleString()} 行 × ${ds?.columns?.length||0} 列</span></span>`;
    messages.appendChild(divider);
    messages.scrollTop = messages.scrollHeight;
    input.focus();
  };

  // When user switches active dataset via the tab strip, insert a divider
  document.addEventListener('dataset-updated', ({ detail }) => {
    if (!detail?.dataset || detail.source !== 'switch') return;
    const ds = detail.dataset;
    const divider = document.createElement('div');
    divider.className = 'aria-chat-divider';
    divider.innerHTML =
      `<span class="aria-chat-divider-label">📂 切換数据集 &rarr; <strong>${_esc(ds.name)}</strong>` +
      ` &nbsp;<span style="opacity:.55;font-weight:400">${ds.rows.length.toLocaleString()} 行 × ${ds.columns.length} 列</span></span>`;
    messages.appendChild(divider);
    messages.scrollTop = messages.scrollHeight;
  });

  return root;
}
