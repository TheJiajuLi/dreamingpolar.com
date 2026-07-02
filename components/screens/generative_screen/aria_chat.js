import { getDataset, getAllDatasets, setActiveDataset } from '../../shared/dataset_store.js';
import { getCellDatasetInfo } from '../../customise_code_block/customise_code_block.js';
import { getSettings } from '../../right_bar/settings.js';

// ── Chat history persistence ──────────────────────────────────────────────────
const _ARIA_HISTORY_KEY = 'dp-aria-chat-history';
const _MAX_MSGS_PER_DS  = 40; // cap per dataset to stay within localStorage budget

function _loadAriaHistory() {
  try { return JSON.parse(localStorage.getItem(_ARIA_HISTORY_KEY) ?? '{}'); } catch { return {}; }
}
function _saveAriaHistory(store) {
  if (!getSettings().cacheAriaHistory) return;
  try { localStorage.setItem(_ARIA_HISTORY_KEY, JSON.stringify(store)); } catch {}
}
function _clearAriaHistory() {
  try { localStorage.removeItem(_ARIA_HISTORY_KEY); } catch {}
}

// ── Code templates inserted into the Power Notebook via ai-insert-and-run ────
const _CODE_TEMPLATES = {
  'time-series': v =>
    `import matplotlib.pyplot as plt\n` +
    `_dt_cols = ${v}.select_dtypes(include=["object","datetime"]).columns\n` +
    `_num_cols = ${v}.select_dtypes(include="number")\n` +
    `if len(_dt_cols) == 0 or len(_num_cols.columns) == 0:\n` +
    `    print(f"提示：${v} 缺少日期列或数值列，无法绘制时序图。列：{list(${v}.columns)}")\n` +
    `else:\n` +
    `    _date_col = _dt_cols[0]\n` +
    `    _tmp = ${v}.copy()\n` +
    `    _tmp[_date_col] = pd.to_datetime(_tmp[_date_col])\n` +
    `    _tmp = _tmp.set_index(_date_col)\n` +
    `    print(_tmp.shape)\n` +
    `    _tmp.select_dtypes(include="number").plot(\n` +
    `        figsize=(14, 6), grid=True, linewidth=1.2,\n` +
    `        title="${v} — 时序趋势"\n` +
    `    )\n` +
    `${v}.head()`,

  'overview':
    v =>
    `print(f"Shape: {${v}.shape}")\n` +
    `print(f"Columns: {list(${v}.columns)}")\n` +
    `print(f"Dtypes:\\n{${v}.dtypes}\\n")\n` +
    `print(f"Null counts:\\n{${v}.isnull().sum()}")\n` +
    `${v}.head()`,

  'rolling':
    v =>
    `import matplotlib.pyplot as plt\n` +
    `_num = ${v}.select_dtypes(include="number").iloc[:, :3]\n` +
    `if _num.empty:\n` +
    `    print(f"提示：${v} 没有数值列，无法绘制均线图。列：{list(${v}.columns)}")\n` +
    `else:\n` +
    `    fig, ax = plt.subplots(figsize=(14, 6))\n` +
    `    _num.plot(ax=ax, alpha=0.4, linewidth=0.8, label=[f"{c}" for c in _num.columns])\n` +
    `    _num.rolling(20).mean().plot(\n` +
    `        ax=ax, linewidth=1.8,\n` +
    `        label=[f"{c} MA20" for c in _num.columns]\n` +
    `    )\n` +
    `    ax.set_title("${v} — 20 期移动均线", fontsize=14)\n` +
    `    ax.legend(); ax.grid(True); plt.tight_layout()\n` +
    `${v}.head()`,

  'describe':
    v =>
    `print(${v}.describe().round(2).to_string())\n` +
    `_num = ${v}.select_dtypes(include="number")\n` +
    `if _num.shape[1] > 1:\n` +
    `    print("\\n相关系数矩阵:")\n` +
    `    print(_num.corr().round(3).to_string())\n` +
    `${v}.head()`,
};

// Returns { varName, filename, fileType } for the active dataset.
// varName is the real Python identifier; filename is used to auto-load if needed.
function _resolveActiveContext() {
  // 1. Notebook cells (most authoritative — variable already in kernel)
  const cells = getCellDatasetInfo?.();
  if (cells?.length) {
    const c = cells[0];
    return { varName: c.varName, filename: c.filename, fileType: null, inKernel: true };
  }

  const ds = getDataset();
  if (!ds?.name) return { varName: 'df', filename: null, fileType: null, inKernel: false };

  // 2. Look up inject-store by filename → get the real varName + fileType
  try {
    const store = JSON.parse(localStorage.getItem('dreaming-polar-inject-store') ?? '{}');
    const entry = Object.values(store).find(e => e?.filename === ds.name);
    if (entry?.varName) {
      return {
        varName:  entry.varName,
        filename: entry.filename,
        fileType: entry.fileType ?? 'csv',
        inKernel: false,  // may or may not be loaded — preamble will check
      };
    }
  } catch (_) {}

  // 3. Fallback
  const fallback = ds.name.replace(/\.[^.]+$/, '').replace(/[^a-z0-9_]/gi, '_') || 'df';
  return { varName: fallback, filename: ds.name, fileType: 'csv', inKernel: false };
}

// Backward-compat shim used elsewhere
function _resolveActiveVarName() {
  return _resolveActiveContext().varName;
}

// Build a preamble that loads the file into varName if not already in namespace.
// File is in py.FS at /home/pyodide/<filename> from our pre-write step.
function _buildLoadPreamble(varName, filename, fileType) {
  if (!filename) return '';
  const readers = {
    csv:  `pd.read_csv("${filename}")`,
    json: `pd.read_json("${filename}")`,
    xlsx: `pd.read_excel("${filename}")`,
    xls:  `pd.read_excel("${filename}")`,
    xml:  `pd.read_xml("${filename}")`,
  };
  const reader = readers[fileType ?? 'csv'] ?? `pd.read_csv("${filename}")`;
  // Load from file if not already in globals, then sync to _dp_kernel_ns.
  // Append a special sentinel __dp_viz_hint__ that the RUNNER's viz-candidate
  // loop reads to force a viz-suggestion even when the shape hasn't changed.
  return (
    `import pandas as pd\n` +
    `if '${varName}' not in dir():\n` +
    `    ${varName} = ${reader}\n` +
    `if '_dp_kernel_ns' in dir():\n` +
    `    _dp_kernel_ns['${varName}'] = ${varName}\n` +
    `    _dp_kernel_ns['__dp_viz_hint__'] = '${varName}'\n`
  );
}

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
  `• 图表必须包含清晰的轴标签：title（图表标题）、xAxisLabel（X轴说明）、yAxisLabel（Y轴说明）\n` +
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
      scales: {
        x: { title: { display: true, text: '数值范围', font: { size: 10 } }, ticks: { maxRotation: 35, maxTicksLimit: 10 } },
        y: { title: { display: true, text: '频数', font: { size: 10 } } },
      },
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
// ── Generate equivalent Python code for a CHART marker ───────────────────────
function _chartToPython(marker, varName) {
  if (!marker) return null;
  if (marker.type === 'histogram' && marker.cols.length >= 1) {
    const col = marker.cols[0];
    return (
      `import pandas as pd\n` +
      `import matplotlib.pyplot as plt\n` +
      `if '${varName}' not in dir():\n` +
      `    ${varName} = pd.read_csv("${getDataset()?.name ?? 'data.csv'}")\n` +
      `fig, ax = plt.subplots(figsize=(10, 5))\n` +
      `${varName}["${col}"].dropna().plot.hist(ax=ax, bins=20, color="#f97316", edgecolor="white", alpha=0.85)\n` +
      `ax.set_title("分布：${col}", fontsize=13)\n` +
      `ax.set_xlabel("${col}")\n` +
      `ax.grid(axis='y', alpha=0.4)\n` +
      `plt.tight_layout()`
    );
  }
  if (marker.type === 'scatter' && marker.cols.length >= 2) {
    const [c1, c2] = marker.cols;
    return (
      `import pandas as pd\n` +
      `import matplotlib.pyplot as plt\n` +
      `if '${varName}' not in dir():\n` +
      `    ${varName} = pd.read_csv("${getDataset()?.name ?? 'data.csv'}")\n` +
      `fig, ax = plt.subplots(figsize=(8, 6))\n` +
      `ax.scatter(${varName}["${c1}"], ${varName}["${c2}"], alpha=0.55, s=18, color="#f97316")\n` +
      `ax.set_xlabel("${c1}"); ax.set_ylabel("${c2}")\n` +
      `ax.set_title("${c1} × ${c2}", fontsize=13)\n` +
      `ax.grid(alpha=0.3)\n` +
      `plt.tight_layout()`
    );
  }
  return null;
}

// ── Append "查看代码" inline expand button to a card ─────────────────────────
function _appendViewCodeBtn(card, pyCode) {
  const footer = document.createElement('div');
  footer.className = 'aria-card-code-footer';

  const viewBtn = document.createElement('button');
  viewBtn.className = 'aria-card-view-code-btn';
  viewBtn.innerHTML = `<i class="ti ti-code"></i> 查看代码`;

  const codeBlock = document.createElement('div');
  codeBlock.className = 'aria-card-code-block';
  codeBlock.hidden = true;

  const pre = document.createElement('pre');
  pre.className = 'aria-card-code-pre';
  pre.textContent = pyCode;

  const sendBtn = document.createElement('button');
  sendBtn.className = 'aria-card-send-to-nb-btn';
  sendBtn.innerHTML = `<i class="ti ti-corner-down-left"></i> 发送到 Notebook`;
  sendBtn.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('rb-insert-file', {
      detail: { code: pyCode, entry: {} },
    }));
    sendBtn.textContent = '✓ 已插入';
    sendBtn.disabled = true;
    setTimeout(() => {
      sendBtn.innerHTML = `<i class="ti ti-corner-down-left"></i> 发送到 Notebook`;
      sendBtn.disabled = false;
    }, 2000);
  });

  codeBlock.append(pre, sendBtn);

  let _open = false;
  viewBtn.addEventListener('click', () => {
    _open = !_open;
    codeBlock.hidden = !_open;
    viewBtn.innerHTML = _open
      ? `<i class="ti ti-code-off"></i> 收起代码`
      : `<i class="ti ti-code"></i> 查看代码`;
  });

  footer.append(viewBtn, codeBlock);
  card.appendChild(footer);
}

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

  // React to dataset changes: rebuild tabs, data card, and suggestion chips
  document.addEventListener('dataset-updated', ({ detail }) => {
    if (!detail) return;
    _rebuildTabs(detail.all ?? [], detail.activeIdx ?? 0);
    const active = (detail.all ?? [])[detail.activeIdx ?? 0] ?? null;
    _rebuildDataCard(active);
    _rebuildChips(active);
  });

  // ── Handle dataset selection from cloud files ────────────────────────────
  document.addEventListener('aria-select-dataset', ({ detail }) => {
    const { varName, filename } = detail;
    if (!varName) return;
    // setActiveDataset expects the dataset name, which is the filename
    setActiveDataset(filename || varName);
  });

  // ── Data asset card (between dsTabs and welcomeHeader) ───────────────────────
  const dataCard = document.createElement('div');
  dataCard.className = 'aria-data-card';
  dataCard.style.display = 'none';   // hidden until first dataset

  // Collapse state
  let _cardOpen = true;

  const cardHdr = document.createElement('div');
  cardHdr.className = 'aria-data-card-hdr';

  const cardSummary = document.createElement('span');
  cardSummary.className = 'aria-data-card-summary';

  const cardChevron = document.createElement('i');
  cardChevron.className = 'ti ti-chevron-down aria-data-card-chevron';

  cardHdr.append(cardSummary, cardChevron);
  cardHdr.addEventListener('click', () => {
    _cardOpen = !_cardOpen;
    cardBody.style.display = _cardOpen ? '' : 'none';
    cardChevron.style.transform = _cardOpen ? 'rotate(180deg)' : 'rotate(0deg)';
  });

  const cardBody = document.createElement('div');
  cardBody.className = 'aria-data-card-body';

  dataCard.append(cardHdr, cardBody);

  // Helper: dtype → Tabler icon class (reuse same rules as _inferChips)
  function _dtypeIcon(dtype) {
    if (!dtype) return 'ti-letter-case';
    if (/datetime/i.test(dtype)) return 'ti-calendar';
    if (/float|int/i.test(dtype)) return 'ti-number';
    return 'ti-letter-case';
  }

  function _rebuildDataCard(dataset) {
    if (!dataset) {
      dataCard.style.display = 'none';
      return;
    }
    dataCard.style.display = '';

    const cols   = dataset.columns ?? [];
    const dtypes = dataset.dtypes  ?? {};
    const rows   = Array.isArray(dataset.rows) ? dataset.rows.length : 0;

    cardSummary.textContent =
      `${dataset.name}  ·  ${rows.toLocaleString()} 行 × ${cols.length} 列`;

    cardBody.innerHTML = '';
    const chipRow = document.createElement('div');
    chipRow.className = 'aria-data-card-cols';

    cols.forEach(col => {
      const chip = document.createElement('span');
      chip.className = 'aria-data-card-col-chip';
      chip.innerHTML =
        `<i class="ti ${_dtypeIcon(dtypes[col])} aria-data-card-col-icon"></i>` +
        `<span class="aria-data-card-col-name">${col}</span>`;
      chipRow.appendChild(chip);
    });

    cardBody.appendChild(chipRow);
  }

  // ── Dynamic chip generation based on active dataset dtypes ──────────────────
  const _DEFAULT_CHIPS = [
    { q: '帮我做客户分层分析', label: '客户分层分析' },
    { q: '哪些列有空值？',     label: '空值情况'     },
    { q: '给我看第一个数值列的分布', label: '列分布图' },
  ];

  function _inferChips(dataset) {
    if (!dataset) return _DEFAULT_CHIPS;
    const cols   = dataset.columns ?? [];
    const dtypes = dataset.dtypes  ?? {};

    const hasDt  = cols.some(c => /datetime/i.test(dtypes[c] ?? ''));
    const numCols = cols.filter(c => /float|int/i.test(dtypes[c] ?? ''));
    const hasId  = cols.some(c => /customer.?id|user.?id|client.?id/i.test(c));

    if (hasDt) return [
      { q: '帮我做个时序分析',       label: '时序分析'   },
      { q: '这两列有什么关系',        label: '相关性分析' },
      { q: '哪些列有空值？',          label: '空值情况'   },
    ];
    if (numCols.length >= 2) return [
      { q: `${numCols[0]} 和 ${numCols[1]} 有什么关系`, label: '两列相关性' },
      { q: '给我看数值列的分布',      label: '数值分布'   },
      { q: '哪些列有空值？',          label: '空值情况'   },
    ];
    if (hasId) return [
      { q: '帮我做客户分层分析',      label: '客户分层'   },
      { q: '哪些列有空值？',          label: '空值情况'   },
      { q: '给我看第一个数值列的分布', label: '列分布图'  },
    ];
    return _DEFAULT_CHIPS;
  }

  // ── Persistent welcome header (always visible, survives tab switches) ───────
  const welcomeHeader = document.createElement('div');
  welcomeHeader.className = 'aria-chat-welcome';

  // Build skeleton; chips container is live-updated by _rebuildChips()
  welcomeHeader.innerHTML =
    `<div class="aria-chat-welcome-hdr">` +
    `<span class="aria-chat-welcome-title">选择数据集后开始对话</span>` +
    `<button class="aria-chat-welcome-toggle" title="收起" aria-label="收起提示区">` +
    `<i class="ti ti-chevron-down aria-chat-welcome-chevron"></i></button>` +
    `</div>` +
    `<div class="aria-chat-welcome-body">` +
    `<div class="aria-chat-welcome-hint">在右侧文件面板选择一个数据集，点击「发送到 Quick Analysis」即可开始提问。ARIA 会引用真实的列名和数值，并在需要时直接生成图表。</div>` +
    `<div class="aria-chat-welcome-chips"></div>` +
    `<div class="aria-code-tmpl-label">快速代码 → Notebook</div>` +
    `<div class="aria-code-tmpl-chips">` +
    `<span class="aria-code-chip" data-tmpl="time-series">📊 时序分析</span>` +
    `<span class="aria-code-chip" data-tmpl="overview">📋 数据概览</span>` +
    `<span class="aria-code-chip" data-tmpl="rolling">📈 移动均线</span>` +
    `<span class="aria-code-chip" data-tmpl="describe">🔍 统计摘要</span>` +
    `</div>` +
    `</div>`;

  // ── Collapse / expand logic ───────────────────────────────────────────────
  const _WELCOME_COLLAPSED_KEY = 'dp-aria-welcome-collapsed';
  const _welcomeBody   = welcomeHeader.querySelector('.aria-chat-welcome-body');
  const _toggleBtn     = welcomeHeader.querySelector('.aria-chat-welcome-toggle');

  function _setWelcomeCollapsed(collapsed) {
    welcomeHeader.classList.toggle('aria-chat-welcome--collapsed', collapsed);
    _toggleBtn.title = collapsed ? '展开' : '收起';
    _toggleBtn.setAttribute('aria-label', collapsed ? '展开提示区' : '收起提示区');
    try { localStorage.setItem(_WELCOME_COLLAPSED_KEY, collapsed ? '1' : '0'); } catch {}
  }

  // Entire header row is clickable (like aria-data-card-hdr)
  const _welcomeHdr = welcomeHeader.querySelector('.aria-chat-welcome-hdr');
  _welcomeHdr.addEventListener('click', () => {
    _setWelcomeCollapsed(!welcomeHeader.classList.contains('aria-chat-welcome--collapsed'));
  });
  _toggleBtn.addEventListener('click', e => e.stopPropagation()); // prevent double-fire

  // Restore persisted state
  try {
    if (localStorage.getItem(_WELCOME_COLLAPSED_KEY) === '1') _setWelcomeCollapsed(true);
  } catch {}

  const _chipsEl = welcomeHeader.querySelector('.aria-chat-welcome-chips');

  function _rebuildChips(dataset) {
    const dynamic = _inferChips(dataset);
    _chipsEl.innerHTML =
      // Fixed first chip
      `<span class="aria-chat-chip" data-q="这些数据有什么特点？">这些数据有什么特点？</span>` +
      dynamic.map(c =>
        `<span class="aria-chat-chip" data-q="${c.q}">${c.label}</span>`
      ).join('');
  }

  // Render defaults immediately (no dataset yet)
  _rebuildChips(null);

  // ── Conversation area — one messages div per dataset ──────────────────────
  // Each dataset tab gets its own isolated scroll history. Only one div
  // is visible at a time (.aria-chat-messages--active). The welcome div
  // is an empty placeholder shown before any messages exist for a dataset.
  const convArea = document.createElement('div');
  convArea.className = 'aria-chat-conv-area';

  const welcome = document.createElement('div');
  welcome.className = 'aria-chat-messages aria-chat-messages--active';

  const scrollToBottomBtn = document.createElement('button');
  scrollToBottomBtn.className = 'aria-chat-scroll-btn';
  scrollToBottomBtn.title = '回到最新';
  scrollToBottomBtn.innerHTML = '↓ 最新';
  scrollToBottomBtn.style.display = 'none';

  convArea.append(welcome, scrollToBottomBtn);

  // ── Per-dataset conversation management ───────────────────────────────────
  const _convMap  = new Map(); // dsName → HTMLElement (messages div)
  const _rawStore = {};        // dsName → [{question,answer,time,meta}]  (in-memory raw data)
  let _activeConvName = null;
  let _activeMessages = welcome;

  function _restoreConvFromHistory(el, dsName) {
    const saved = _loadAriaHistory()[dsName];
    if (!Array.isArray(saved) || !saved.length) return;
    saved.forEach(entry => {
      const { card, body } = _makeCard(entry.question, el);
      body.innerHTML = _fmt(entry.answer);
      if (entry.meta) {
        const badge = document.createElement('div');
        badge.className = 'aria-chat-card-meta aria-chat-card-meta--restored';
        badge.innerHTML = entry.meta;
        card.appendChild(badge);
      }
    });
    _rawStore[dsName] = [...saved]; // sync raw store
  }

  function _getOrCreateConv(dsName) {
    if (_convMap.has(dsName)) return _convMap.get(dsName);
    const el = document.createElement('div');
    el.className = 'aria-chat-messages';
    convArea.insertBefore(el, scrollToBottomBtn);
    _convMap.set(dsName, el);
    if (getSettings().cacheAriaHistory) _restoreConvFromHistory(el, dsName);
    return el;
  }

  function _updateScrollBtn() {
    const el = _activeMessages;
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    scrollToBottomBtn.style.display = fromBottom > 180 ? '' : 'none';
  }

  function _switchToConv(dsName) {
    if (_activeConvName === dsName) return;
    _activeMessages.classList.remove('aria-chat-messages--active');
    _activeConvName = dsName;
    _activeMessages = dsName ? _getOrCreateConv(dsName) : welcome;
    _activeMessages.classList.add('aria-chat-messages--active');
    requestAnimationFrame(() => {
      _activeMessages.scrollTop = _activeMessages.scrollHeight;
      _updateScrollBtn();
    });
  }

  // Detect scroll on any messages div via capture (event delegation)
  convArea.addEventListener('scroll', _updateScrollBtn, true);

  scrollToBottomBtn.addEventListener('click', () => {
    _activeMessages.scrollTo({ top: _activeMessages.scrollHeight, behavior: 'smooth' });
  });

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
  root.append(header, dsTabs, dataCard, welcomeHeader, convArea, inputRow);

  let _busy = false;

  // ── Per-dataset input history (↑/↓ navigation) ──────────────────────────
  const _histMap = {}; // { datasetKey: string[] }
  let _histIdx   = -1; // -1 = editing fresh input
  const _histKey = () => getDataset()?.name ?? '__no_dataset__';
  const _histPush = q => {
    const key = _histKey();
    if (!_histMap[key]) _histMap[key] = [];
    const arr = _histMap[key];
    // Avoid consecutive duplicates
    if (arr[arr.length - 1] !== q) arr.push(q);
    _histIdx = -1;
  };
  const _histNav = dir => {
    const arr = _histMap[_histKey()];
    if (!arr?.length) return;
    if (dir < 0) { // ArrowUp → older
      if (_histIdx === -1) _histIdx = arr.length - 1;
      else if (_histIdx > 0) _histIdx--;
    } else {        // ArrowDown → newer
      if (_histIdx === -1) return;
      if (_histIdx < arr.length - 1) { _histIdx++; }
      else { _histIdx = -1; input.value = ''; return; }
    }
    input.value = arr[_histIdx];
    requestAnimationFrame(() => { input.selectionStart = input.selectionEnd = input.value.length; });
  };

  async function _submit() {
    const question = input.value.trim();
    if (!question || _busy) return;
    _histPush(question);

    // Ensure we have an active conversation (e.g. after refresh or first chip click)
    if (!_activeConvName) {
      const ds = getDataset();
      if (ds?.name) _switchToConv(ds.name); // also triggers history restore
    }

    _busy = true; input.value = ''; input.disabled = true; sendBtn.disabled = true;
    const dot = root.querySelector('#aria-chat-dot');
    if (dot) dot.classList.add('aria-chat-dot--active');
    const msgs = _activeMessages;
    const { card, body } = _makeCard(question, msgs);
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
        msgs.scrollTop = msgs.scrollHeight;
      }
      body.innerHTML = _fmt(fullReply);
      const marker = _parseChartMarker(fullReply);
      if (marker && getDataset()) await _renderChart(card, marker);
      const ds = getDataset();
      let metaHTML = '';
      if (ds) {
        metaHTML = `<span style="opacity:.5">基于</span> <strong>${_esc(ds.name)}</strong> · ${ds.rows.length.toLocaleString()} 行 × ${ds.columns.length} 列`;
        const badge = document.createElement('div');
        badge.className = 'aria-chat-card-meta';
        badge.innerHTML = metaHTML;
        card.appendChild(badge);
      }

      // Persist to history
      if (getSettings().cacheAriaHistory && _activeConvName) {
        if (!_rawStore[_activeConvName]) _rawStore[_activeConvName] = [];
        _rawStore[_activeConvName].push({ question, answer: fullReply, time: _time(), meta: metaHTML });
        // Cap per-dataset message count
        if (_rawStore[_activeConvName].length > _MAX_MSGS_PER_DS) {
          _rawStore[_activeConvName] = _rawStore[_activeConvName].slice(-_MAX_MSGS_PER_DS);
        }
        const allHistory = _loadAriaHistory();
        allHistory[_activeConvName] = _rawStore[_activeConvName];
        _saveAriaHistory(allHistory);
      }
      // "查看代码"按钮 — only for replies that contain a CHART: marker
      if (marker) {
        const varName = _resolveActiveVarName();
        const pyCode  = _chartToPython(marker, varName);
        if (pyCode) _appendViewCodeBtn(card, pyCode);
      }
    } catch (e) {
      body.innerHTML = `<span class="aria-chat-err">⚠ ${_esc(e.message)}</span>`;
    } finally {
      _busy = false; input.disabled = false; sendBtn.disabled = false;
      input.focus(); if (dot) dot.classList.remove('aria-chat-dot--active');
      msgs.scrollTop = msgs.scrollHeight;
      _updateScrollBtn();
    }
  }

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _submit(); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); _histNav(-1); }
    if (e.key === 'ArrowDown') { e.preventDefault(); _histNav(1); }
  });
  // Typing breaks out of history navigation
  input.addEventListener('input', () => { _histIdx = -1; });
  sendBtn.addEventListener('click', _submit);
  function _handleChipClick(e) {
    // Question chip → fill input
    const qChip = e.target.closest('.aria-chat-chip');
    if (qChip) { input.value = qChip.dataset.q; input.focus(); return; }

    // Code template chip → insert into Power Notebook and open it
    const codeChip = e.target.closest('.aria-code-chip');
    if (codeChip) {
      const tmplId  = codeChip.dataset.tmpl;
      const builder = _CODE_TEMPLATES[tmplId];
      if (!builder) return;
      const { varName, filename, fileType } = _resolveActiveContext();
      const preamble = _buildLoadPreamble(varName, filename, fileType);
      const code     = preamble + builder(varName);
      // Open the coding screen and insert+run the code
      window.screenController?.open('coding');
      setTimeout(() => {
        document.dispatchEvent(new CustomEvent('ai-insert-and-run', {
          detail: { code, lang: 'python' },
        }));
      }, 150);
    }
  }

  // Chips live in both convArea and welcomeHeader (which is outside convArea)
  convArea.addEventListener('click', _handleChipClick);
  welcomeHeader.addEventListener('click', _handleChipClick);

  root._onDataLoaded = (name) => {
    const ds = getDataset();
    const displayName = name || ds?.name || 'file';
    // Switch to (or create) this dataset's conversation
    _switchToConv(displayName);
    const msgs = _activeMessages;
    const divider = document.createElement('div');
    divider.className = 'aria-chat-divider aria-chat-divider--import';
    divider.innerHTML =
      `<span class="aria-chat-divider-label">📥 已加载 <strong>${_esc(displayName)}</strong>` +
      ` &nbsp;<span style="opacity:.55;font-weight:400">${(ds?.rows?.length||0).toLocaleString()} 行 × ${ds?.columns?.length||0} 列</span></span>`;
    msgs.appendChild(divider);
    msgs.scrollTop = msgs.scrollHeight;
    input.focus();
  };

  // When user clicks a dataset tab: switch to that dataset's isolated conversation.
  document.addEventListener('dataset-updated', ({ detail }) => {
    if (!detail?.dataset) return;
    if (detail.source === 'switch') {
      _switchToConv(detail.dataset.name);
    } else if (!_activeConvName) {
      // Page load / restore — auto-switch so history can be loaded
      _switchToConv(detail.dataset.name);
    }
  });

  return root;
}
