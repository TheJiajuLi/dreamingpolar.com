import { createQuickImportBtn } from '../../import/import_data.js';
import { getDataset } from '../../shared/dataset_store.js';
import { createAriaChat } from './aria_chat.js';

// ── Constants ────────────────────────────────────────────────────────────────
const CHART_JS_CDN = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js';

// ── VT button definitions ────────────────────────────────────────────────────
// id must be unique across ALL vt-btn-activated events in the app.
const VT_DEFS = [
  {
    id: 'gen-charts', label: 'Charts',
    icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
  },
  {
    id: 'gen-models', label: 'Models',
    icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`,
  },
];

// ── Chart.js lazy loader ─────────────────────────────────────────────────────
let _chartJsPromise = null;
function _loadChartJs() {
  if (window.Chart) return Promise.resolve();
  if (_chartJsPromise) return _chartJsPromise;
  _chartJsPromise = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src     = CHART_JS_CDN;
    s.onload  = res;
    s.onerror = () => rej(new Error('Failed to load Chart.js'));
    document.head.appendChild(s);
  });
  return _chartJsPromise;
}

// ── Chart data from dataset_store (pure JS, no Python) ──────────────────────
function _getChartData() {
  const ds = getDataset();
  if (!ds || !ds.rows?.length) return null;

  const { columns, dtypes, rows } = ds;
  const numCols = columns.filter(c => dtypes[c] === 'float64' || dtypes[c] === 'int64');
  const catCols = columns.filter(c => dtypes[c] === 'object');

  if (!numCols.length) return null;

  const numCol = numCols[0];

  if (catCols.length) {
    // Group by first categorical, sum first numeric — top 10
    const catCol = catCols[0];
    const grouped = {};
    for (const row of rows) {
      const key = String(row[catCol] ?? '(blank)');
      const val = parseFloat(row[numCol]);
      if (!isNaN(val)) grouped[key] = (grouped[key] ?? 0) + val;
    }
    const sorted = Object.entries(grouped)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    return {
      col:     numCol,
      groupBy: catCol,
      labels:  sorted.map(([k]) => k),
      values:  sorted.map(([, v]) => Math.round(v * 100) / 100),
    };
  }

  // Numeric only — first 15 rows
  const slice = rows.slice(0, 15);
  return {
    col:     numCol,
    groupBy: null,
    labels:  slice.map((_, i) => String(i)),
    values:  slice.map(r => { const v = parseFloat(r[numCol]); return isNaN(v) ? 0 : Math.round(v * 100) / 100; }),
  };
}

// ── Import view ──────────────────────────────────────────────────────────────
function _buildImportView() {
  const div = document.createElement('div');
  div.className    = 'gen-view gen-import-view';
  div.dataset.view = 'gen-import';

  const inner = document.createElement('div');
  inner.className = 'gen-import-inner';

  const title = document.createElement('h2');
  title.className   = 'gen-import-title';
  title.textContent = 'Import Dataset';

  const sub = document.createElement('p');
  sub.className   = 'gen-import-sub';
  sub.textContent = 'Load a CSV or Excel file into the Python kernel as df.';

  const btnWrap = document.createElement('div');
  btnWrap.className = 'gen-import-btn-wrap';
  btnWrap.appendChild(createLoadDataBtn({ varName: 'df' }));

  const hint = document.createElement('p');
  hint.className   = 'gen-import-hint';
  hint.innerHTML   = 'After loading, run <code>df.head()</code> in the terminal or switch to Charts.';

  inner.append(title, sub, btnWrap, hint);
  div.appendChild(inner);
  return div;
}

// ── Charts view ──────────────────────────────────────────────────────────────
function _buildChartsView() {
  const div = document.createElement('div');
  div.className    = 'gen-view gen-charts-view';
  div.dataset.view = 'gen-charts';

  const toolbar = document.createElement('div');
  toolbar.className = 'gen-charts-toolbar';

  const titleEl = document.createElement('span');
  titleEl.className   = 'gen-charts-title';
  titleEl.textContent = 'Bar Chart';

  const refreshBtn = document.createElement('button');
  refreshBtn.className   = 'sc-btn gen-charts-refresh';
  refreshBtn.title       = 'Refresh chart';
  refreshBtn.textContent = '↻ Refresh';

  toolbar.append(titleEl, refreshBtn);

  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'gen-charts-canvas-wrap';

  const canvas = document.createElement('canvas');
  canvas.id = 'gen-bar-chart';
  canvasWrap.appendChild(canvas);

  const emptyMsg = document.createElement('div');
  emptyMsg.className = 'gen-charts-empty';
  emptyMsg.innerHTML =
    `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>` +
    `<p>Import a CSV or Excel file — chart renders automatically, no Python needed.</p>`;

  div.append(toolbar, canvasWrap, emptyMsg);

  let _chartInst = null;

  async function renderChart() {
    refreshBtn.disabled    = true;
    refreshBtn.textContent = '↻ Loading…';
    emptyMsg.style.display = 'none';

    try {
      await _loadChartJs();
      const data = _getChartData();   // ← pure JS, reads from dataset_store

      if (!data || !data.values?.length) {
        canvasWrap.style.display = 'none';
        emptyMsg.style.display   = '';
        return;
      }

      canvasWrap.style.display = '';
      titleEl.textContent = data.groupBy
        ? `${data.col} by ${data.groupBy}`
        : `${data.col} (first ${data.values.length} rows)`;

      if (_chartInst) { _chartInst.destroy(); _chartInst = null; }

      _chartInst = new window.Chart(canvas, {
        type: 'bar',
        data: {
          labels:   data.labels,
          datasets: [{
            label:           data.col,
            data:            data.values,
            backgroundColor: 'rgba(99,102,241,0.72)',
            borderColor:     'rgba(99,102,241,1)',
            borderWidth:     1,
            borderRadius:    4,
          }],
        },
        options: {
          responsive:          true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { maxRotation: 40, minRotation: 0 } },
          },
        },
      });
    } catch (e) {
      emptyMsg.querySelector('p').textContent = `Error: ${e.message}`;
      canvasWrap.style.display = 'none';
      emptyMsg.style.display   = '';
    } finally {
      refreshBtn.disabled    = false;
      refreshBtn.textContent = '↻ Refresh';
    }
  }

  refreshBtn.addEventListener('click', renderChart);

  // Auto-render when the view becomes visible for the first time
  div._autoRender = renderChart;
  // Allow external code to force a refresh
  div._markStale  = () => { div._autoRender = renderChart; };
  canvasWrap.style.display = 'none';

  // Auto-render when new data is imported (no Python involved)
  document.addEventListener('dataset-updated', () => {
    if (div.classList.contains('gen-view--active')) {
      renderChart();
    } else {
      div._markStale();   // render when view is next activated
      div._autoRender = renderChart;
    }
  });

  return div;
}

// ── Models view ──────────────────────────────────────────────────────────────
function _buildModelsView() {
  const div = document.createElement('div');
  div.className    = 'gen-view gen-models-view';
  div.dataset.view = 'gen-models';

  div.innerHTML = `
    <div class="gen-models-empty">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="12 2 2 7 12 12 22 7 12 2"/>
        <polyline points="2 17 12 22 22 17"/>
        <polyline points="2 12 12 17 22 12"/>
      </svg>
      <h3>No saved models yet</h3>
      <p>Train a model in the Terminal, then save it here.</p>
    </div>
  `;
  return div;
}

// ── Add VT navigation buttons ─────────────────────────────────────────────────
function _addVtButtons(switchView, getActiveView, isScreenOpen) {
  const vtTop = document.querySelector('#vertical-toolbar .vt-top');
  if (!vtTop) return;

  const btns = {};

  VT_DEFS.forEach(({ id, label, icon }) => {
    const btn = document.createElement('button');
    btn.className       = 'vt-btn gen-vt-btn';
    btn.title           = label;
    btn.dataset.genView = id;
    btn.innerHTML       = icon;

    btn.addEventListener('click', () => {
      const currentlyOpen   = isScreenOpen();
      const currentView     = getActiveView();
      const alreadyThisView = currentView === id;

      if (currentlyOpen && alreadyThisView) {
        // Toggle off: close the generative screen
        window.screenController?.close('terminal');
        Object.values(btns).forEach(b => b.classList.remove('active'));
      } else {
        // Switch to this view (opens screen if closed)
        switchView(id);
        window.screenController?.open('terminal');
        Object.values(btns).forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.dispatchEvent(new CustomEvent('vt-btn-activated', { detail: { id } }));
      }
    });

    // Deactivate when another VT button wins
    document.addEventListener('vt-btn-activated', ({ detail: { id: activatedId } }) => {
      if (activatedId !== id) btn.classList.remove('active');
    });

    // Deactivate when screen is closed by something else
    document.addEventListener('screen-closed', ({ detail }) => {
      if (detail.id === 'terminal') btn.classList.remove('active');
    });

    vtTop.appendChild(btn);
    btns[id] = btn;
  });

  return btns;
}

// ════════════════════════════════════════════════════════════════════════════════
// Main setup — Quick Analysis screen
// ════════════════════════════════════════════════════════════════════════════════
function setupGenerativeScreen() {
  const screen = document.getElementById('generative-screen');
  if (!screen) return;

  // ── 1. Terminal view — ARIA chat (new design, no terminal.js) ─────────────
  const terminalView = document.createElement('div');
  terminalView.className    = 'gen-view gen-terminal-view gen-view--active';
  terminalView.dataset.view = 'gen-terminal';

  const toolbar = document.createElement('div');
  toolbar.className = 'gen-toolbar';

  const modeLabel = document.createElement('span');
  modeLabel.className   = 'gen-mode-label';
  modeLabel.textContent = 'Quick Analysis';
  toolbar.appendChild(modeLabel);

  // Import Dataset button — Quick Analysis lightweight path (no Python)
  const importBtn = createQuickImportBtn();
  importBtn.title = 'Import CSV / Excel — instant, no Python needed';
  toolbar.appendChild(importBtn);

  const jumpBtn = document.createElement('button');
  jumpBtn.className   = 'gen-jump-btn';
  jumpBtn.textContent = 'Notebook ↗';
  jumpBtn.title       = 'Open in Advanced Notebook (same kernel — data stays)';
  jumpBtn.addEventListener('click', () => window.screenController?.open('coding'));
  toolbar.appendChild(jumpBtn);

  const ariaChat = createAriaChat();
  terminalView.append(toolbar, ariaChat);

  // ── 2-4. Other views ─────────────────────────────────────────────────────
  const chartsView = _buildChartsView();
  const modelsView = _buildModelsView();

  // ── View container ────────────────────────────────────────────────────────
  const viewContainer = document.createElement('div');
  viewContainer.className = 'gen-view-container';
  viewContainer.append(terminalView, chartsView, modelsView);
  screen.appendChild(viewContainer);

  // ── Active view state ─────────────────────────────────────────────────────
  let _activeView     = 'gen-terminal';
  let _chartsRendered = false;
  let _vtBtns         = {};

  function switchView(id) {
    _activeView = id;
    viewContainer.querySelectorAll('.gen-view').forEach(v => {
      v.classList.toggle('gen-view--active', v.dataset.view === id);
    });
    Object.values(_vtBtns).forEach(b => b.classList.remove('active'));
    if (_vtBtns[id]) _vtBtns[id].classList.add('active');
    if (id === 'gen-charts' && !_chartsRendered && chartsView._autoRender) {
      _chartsRendered = true;
      chartsView._autoRender();
    }
  }

  const isScreenOpen = () => {
    const s = window.screenController?.getState('terminal');
    return s === 'normal' || s === 'maximized';
  };

  // ── VT buttons ────────────────────────────────────────────────────────────
  const vtBtns = _addVtButtons(switchView, () => _activeView, isScreenOpen);
  _vtBtns = vtBtns ?? {};

  // ── Register with screen controller ──────────────────────────────────────
  requestAnimationFrame(() => {
    window.screenController?.register('terminal', screen, {
      label: 'Terminal', persisted: true, defaultOpen: true, noChip: true, group: 'hero',
    });
  });

  // Reset to chat view whenever the generative screen is re-opened
  document.addEventListener('screen-opened', ({ detail }) => {
    if (detail?.id === 'terminal') switchView('gen-terminal');
  });

  // ── Auto-refresh charts only when new data is injected ─────────────────
  document.addEventListener('kernel-mutation', ({ detail: { source } }) => {
    if (source !== 'inject') return;
    if (_activeView === 'gen-charts') {
      chartsView._autoRender?.();
    } else {
      _chartsRendered = false;
      chartsView._markStale?.();
    }
  });

  // ── Bug fix: only jump to terminal view & notify chat when
  //    generative_screen is actually the active hero screen.
  //    If the user is in Power Notebook, don't redirect them.
  document.addEventListener('kernel-mutation', ({ detail: { varName, source } }) => {
    if (source !== 'inject') return;
    const state = window.screenController?.getState('terminal');
    if (state !== 'normal' && state !== 'maximized') return;

    // Switch to terminal (chat) view and notify ARIA chat
    switchView('gen-terminal');
    ariaChat._onDataLoaded?.(varName ?? 'df');
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupGenerativeScreen);
} else {
  setupGenerativeScreen();
}
