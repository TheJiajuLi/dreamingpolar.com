import { compile } from '../../compiler/compiler.js';
import { renderBlocks } from '../compiling_screen/compiling_screen_utility.js';
import { createLoadDataBtn } from '../../import/import_data.js';
import { createAriaChat } from './aria_chat.js';

// ── Constants ────────────────────────────────────────────────────────────────
const CHART_JS_CDN = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js';

// ── VT button definitions ────────────────────────────────────────────────────
// id must be unique across ALL vt-btn-activated events in the app.
const VT_DEFS = [
  {
    id: 'gen-import', label: 'Import Data',
    icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
  },
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

// ── Python: extract bar chart data from df ───────────────────────────────────
const CHART_PY = `
import json as _j, pandas as _pd
try:
    _df = _dp_kernel_ns.get('df')
    if isinstance(_df, _pd.DataFrame) and len(_df) > 0:
        _num = _df.select_dtypes(include='number').columns.tolist()
        _cat = _df.select_dtypes(include=['object', 'category']).columns.tolist()
        if _num and _cat:
            _cn, _cc = _num[0], _cat[0]
            _grp = _df.groupby(_cc)[_cn].sum().nlargest(10)
            print(_j.dumps({'col': _cn, 'groupBy': _cc,
                'labels': [str(x) for x in _grp.index],
                'values': [round(float(v), 2) for v in _grp.values]}))
        elif _num:
            _cn = _num[0]
            _s = _df[_cn].dropna().head(15)
            print(_j.dumps({'col': _cn, 'groupBy': None,
                'labels': [str(i) for i in range(len(_s))],
                'values': [round(float(v), 2) for v in _s.tolist()]}))
        else:
            print(_j.dumps({}))
    else:
        print(_j.dumps({}))
except Exception:
    print(_j.dumps({}))
`.trim();

async function _fetchChartData() {
  const outputs = await compile(CHART_PY, 'python');
  const text    = outputs.find(o => o.type === 'text')?.content?.trim() ?? '';
  return text ? JSON.parse(text) : null;
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
  refreshBtn.title       = 'Refresh from kernel';
  refreshBtn.textContent = '↻ Refresh';

  toolbar.append(titleEl, refreshBtn);

  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'gen-charts-canvas-wrap';

  const canvas = document.createElement('canvas');
  canvas.id = 'gen-bar-chart';
  canvasWrap.appendChild(canvas);

  const emptyMsg = document.createElement('div');
  emptyMsg.className   = 'gen-charts-empty';
  emptyMsg.innerHTML   = `
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
    <p>No data loaded yet — import a CSV first, then click Refresh.</p>
  `;

  div.append(toolbar, canvasWrap, emptyMsg);

  let _chartInst = null;

  async function renderChart() {
    refreshBtn.disabled   = true;
    refreshBtn.textContent = '↻ Loading…';
    emptyMsg.style.display = 'none';

    try {
      await _loadChartJs();
      const data = await _fetchChartData();

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
  // Allow external code to force a refresh (e.g. when kernel-mutation fires
  // while this view is inactive — on next activation it will re-render)
  div._markStale  = () => { div._autoRender = renderChart; };
  canvasWrap.style.display = 'none';

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
    document.addEventListener('vt-btn-activated', ({ detail: { activatedId } }) => {
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

  const jumpBtn = document.createElement('button');
  jumpBtn.className   = 'gen-jump-btn';
  jumpBtn.textContent = 'Notebook ↗';
  jumpBtn.title       = 'Open in Advanced Notebook (same kernel — data stays)';
  jumpBtn.addEventListener('click', () => window.screenController?.open('coding'));
  toolbar.appendChild(jumpBtn);

  const ariaChat = createAriaChat();
  terminalView.append(toolbar, ariaChat);

  // ── 2-4. Other views ─────────────────────────────────────────────────────
  const importView = _buildImportView();
  const chartsView = _buildChartsView();
  const modelsView = _buildModelsView();

  // ── View container ────────────────────────────────────────────────────────
  const viewContainer = document.createElement('div');
  viewContainer.className = 'gen-view-container';
  viewContainer.append(terminalView, importView, chartsView, modelsView);
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
    if (isScreenOpen() && vtBtns) {
      vtBtns['gen-import']?.classList.add('active');
    }
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
