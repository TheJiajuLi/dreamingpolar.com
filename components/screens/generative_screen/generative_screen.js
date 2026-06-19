import { compile } from '../../compiler/compiler.js';
import { renderBlocks, parseAIResponse } from '../compiling_screen/compiling_screen_utility.js';
import { ask, systemExplainForLang } from '../../ai/ai_client.js';
import { createRefactorBtn } from '../compiling_screen/refactorization_button/refactorization_button.js';
import { setCodeBlockRendererFn } from '../../terminal/terminal_ai.js';
import { createAiCodeBlock } from '../../terminal/terminal_ai_code_block.js';
import { createLoadDataBtn } from '../../import/import_data.js';

// ── Constants ────────────────────────────────────────────────────────────────
const CODE_KEY      = 'dp-gen-code';
const CHART_JS_CDN  = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js';

const PLACEHOLDER = `# Example — try running this:
from sympy import symbols, expand, latex
x = symbols('x')
expand((x + 1)**4)

# SymPy, matplotlib, pandas & numpy are preloaded.
# Ctrl/Cmd+Enter to run.`;

const COPY_ICON  = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
const CLEAR_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4h8v2"/></svg>`;

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
// Main setup
// ════════════════════════════════════════════════════════════════════════════════
function setupGenerativeScreen() {
  const screen = document.getElementById('generative-screen');
  if (!screen) return;

  // ── One-time migration: clear old matplotlib demo code from editor localStorage ─
  // If the saved editor content is the circle-drawing demo from a past session,
  // clear it so the editor starts blank for the current user.
  (() => {
    const saved = localStorage.getItem(CODE_KEY);
    if (saved?.includes('plt.Circle')) localStorage.removeItem(CODE_KEY);
  })();

  // ── Build the four views ──────────────────────────────────────────────────
  // ── 1. Terminal view ─────────────────────────────────────────────────────
  const terminalView = document.createElement('div');
  terminalView.className    = 'gen-view gen-terminal-view gen-view--active';
  terminalView.dataset.view = 'gen-terminal';

  // Terminal panel (terminal.js looks for id="terminal-panel")
  const terminalPanel = document.createElement('section');
  terminalPanel.id        = 'terminal-panel';
  terminalPanel.className = 'gen-terminal-strip';

  // ── Toolbar (run / copy / clear + mode label + Notebook jump) ─────────────
  const toolbar = document.createElement('div');
  toolbar.className = 'gen-toolbar';

  const modeLabel = document.createElement('span');
  modeLabel.className   = 'gen-mode-label';
  modeLabel.textContent = 'Quick Analysis';
  toolbar.appendChild(modeLabel);

  const jumpToNotebook = document.createElement('button');
  jumpToNotebook.className   = 'gen-jump-btn';
  jumpToNotebook.textContent = 'Notebook ↗';
  jumpToNotebook.title       = 'Open in Advanced Notebook (same kernel — data stays)';
  jumpToNotebook.addEventListener('click', () => {
    window.screenController?.open('coding');
  });
  toolbar.appendChild(jumpToNotebook);

  const copyBtn = document.createElement('button');
  copyBtn.className = 'lus-copy-btn gen-toolbar-btn';
  copyBtn.title     = 'Copy source';
  copyBtn.innerHTML = COPY_ICON;

  const clearEditorBtn = document.createElement('button');
  clearEditorBtn.className = 'sc-btn gen-toolbar-btn';
  clearEditorBtn.title     = 'Clear editor';
  clearEditorBtn.innerHTML = CLEAR_ICON;

  const runBtn = document.createElement('button');
  runBtn.className = 'nb-btn nb-run gen-run-btn';
  runBtn.innerHTML = '&#9654;';
  runBtn.title     = 'Run (Ctrl+Enter)';

  const toolbarRight = document.createElement('div');
  toolbarRight.className = 'gen-toolbar-right';
  toolbarRight.append(copyBtn, clearEditorBtn, runBtn);
  toolbar.append(toolbarRight);

  // Code panel (editor + resize handle + output + terminal-output)
  const codePanel = document.createElement('div');
  codePanel.className = 'gen-code-panel';

  // Editor element kept in memory for onInsert / keyboard shortcuts,
  // but NOT added to the DOM — the terminal output fills the panel instead.
  const editorWrap = document.createElement('div');
  editorWrap.className = 'code-editor-area gen-editor-wrap';

  const editor = document.createElement('textarea');
  editor.className    = 'code-editor';
  editor.spellcheck   = false;
  editor.autocorrect  = 'off';
  editor.autocomplete = 'off';
  editor.setAttribute('autocapitalize', 'none');
  editor.setAttribute('inputmode', 'text');
  editor.placeholder  = PLACEHOLDER;
  editor.value        = localStorage.getItem(CODE_KEY) ?? '';
  editorWrap.appendChild(editor);
  // editorWrap is intentionally NOT added to codePanel
  // — the terminal output fills the full panel.

  const outputPanel = document.createElement('div');
  outputPanel.className     = 'gen-output-panel';
  outputPanel.style.display = 'none';

  const outputHdr = document.createElement('div');
  outputHdr.className = 'gen-output-panel-hdr';

  const outputLabel = document.createElement('span');
  outputLabel.className   = 'gen-output-panel-label';
  outputLabel.textContent = 'OUTPUT';

  const outClearBtn = document.createElement('button');
  outClearBtn.className   = 'sc-btn';
  outClearBtn.title       = 'Clear output';
  outClearBtn.textContent = '⊘';

  const outMinBtn = document.createElement('button');
  outMinBtn.className   = 'sc-btn';
  outMinBtn.title       = 'Hide';
  outMinBtn.textContent = '−';

  const outToolbarEl = document.createElement('div');
  outToolbarEl.className = 'sc-toolbar';
  outToolbarEl.append(outClearBtn, outMinBtn);
  outputHdr.append(outputLabel, outToolbarEl);

  const outputBody = document.createElement('div');
  outputBody.className = 'gen-output-body';
  outputPanel.append(outputHdr, outputBody);

  // Assemble terminal view
  terminalView.append(toolbar, terminalPanel);

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
  let _activeView  = 'gen-terminal';
  let _chartsRendered = false;
  let _vtBtns = {};   // populated after _addVtButtons; switchView reads it

  function switchView(id) {
    _activeView = id;
    viewContainer.querySelectorAll('.gen-view').forEach(v => {
      v.classList.toggle('gen-view--active', v.dataset.view === id);
    });
    // Keep VT buttons in sync when switchView is called programmatically
    Object.values(_vtBtns).forEach(b => b.classList.remove('active'));
    if (_vtBtns[id]) _vtBtns[id].classList.add('active');
    // Auto-render chart on first open
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
    // Keep first VT button in sync with initial screen state
    if (isScreenOpen() && vtBtns) {
      vtBtns['gen-terminal']?.classList.add('active');
    }
  });

  // ── Inject after terminal.js initialises ─────────────────────────────────
  function _tryInject() {
    const termOutput   = document.getElementById('terminal-output');
    const termBody     = terminalPanel.querySelector('.terminal-body');
    const termInputRow = termBody?.querySelector('.terminal-input-row');
    if (!termBody || !termInputRow || !termOutput) { requestAnimationFrame(_tryInject); return; }
    _doInject(termOutput, termBody, termInputRow);
  }

  function _doInject(termOutput, termBody, termInputRow) {
    // outputPanel and termOutput fill the code panel — no editor/resize handle
    codePanel.append(outputPanel, termOutput);

    termBody.insertBefore(codePanel, termInputRow);

    new MutationObserver(() => {
      window.MathJax?.typesetPromise?.([termOutput]).catch(() => {});
    }).observe(termOutput, { childList: true, subtree: true });

    setCodeBlockRendererFn((lang, code) => {
      const card = createAiCodeBlock(lang, code, {
        onInsert: (src) => {
          editor.value = src;
          editor.dispatchEvent(new Event('input'));
          editor.classList.add('aria-inserted');
          setTimeout(() => editor.classList.remove('aria-inserted'), 600);
        },
      });
      termOutput.appendChild(card);
      termOutput.scrollTop = termOutput.scrollHeight;
    });
  }
  requestAnimationFrame(_tryInject);

  // ── Events ────────────────────────────────────────────────────────────────
  document.addEventListener('aria-run-editor-code', async ({ detail: { code } }) => {
    const st = window.screenController?.getState('terminal');
    if (st !== 'normal' && st !== 'maximized') return;
    outputPanel.style.display = '';
    outputBody.innerHTML = '';
    try {
      const outputs = await compile(code, 'python');
      renderBlocks(outputs, outputBody);
    } catch (e) {
      const d = document.createElement('div');
      d.className = 'output-block output-error';
      d.innerHTML = `<div class="output-text">${String(e)}</div>`;
      outputBody.appendChild(d);
    }
  });

  // ── Auto-refresh charts only when new data is injected ─────────────────
  // (kernel-mutation now only fires from injectDataFrame, not every code run)
  document.addEventListener('kernel-mutation', ({ detail: { source } }) => {
    if (source !== 'inject') return;
    if (_activeView === 'gen-charts') {
      chartsView._autoRender?.();
    } else {
      _chartsRendered = false;
      chartsView._markStale?.();
    }
  });

  // ── Auto-preview: when a DataFrame is injected, run df.head() immediately ──
  // Switches to the Terminal view and renders the preview in the output panel
  // so the user sees their data without having to type anything manually.
  document.addEventListener('kernel-mutation', async ({ detail: { varName, source } }) => {
    if (source !== 'inject') return;
    // Make sure the generative screen is open
    window.screenController?.open('terminal');
    // Switch to Terminal view so output is visible
    switchView('gen-terminal');
    outputPanel.style.display = '';
    outputBody.innerHTML      = '';
    try {
      const outputs = await compile(`${varName}.head()`, 'python');
      renderBlocks(outputs, outputBody);
    } catch (e) {
      const d = document.createElement('div');
      d.className = 'output-block output-error';
      d.innerHTML = `<div class="output-text">${String(e)}</div>`;
      outputBody.appendChild(d);
    }
  });

  editor.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'a') {
      e.preventDefault();
      const ti = document.getElementById('terminal-input');
      if (!ti) return;
      const code = editor.value.trim();
      ti.value = code
        ? `ai Explain or improve this code: \`\`\`python\n${code.slice(0, 400)}\n\`\`\``
        : 'ai ';
      ti.focus();
      ti.setSelectionRange(ti.value.length, ti.value.length);
    }
  });

  copyBtn.addEventListener('click', async () => {
    const code = editor.value;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      copyBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
      copyBtn.classList.add('lus-copy-btn--done');
      setTimeout(() => { copyBtn.innerHTML = COPY_ICON; copyBtn.classList.remove('lus-copy-btn--done'); }, 1600);
    } catch (_) {}
  });

  clearEditorBtn.addEventListener('click', () => {
    editor.value = '';
    localStorage.removeItem(CODE_KEY);
    editor.focus();
  });

  outClearBtn.addEventListener('click', () => { outputBody.innerHTML = ''; });
  outMinBtn.addEventListener('click',   () => { outputPanel.style.display = 'none'; });
  document.addEventListener('compile-result', () => { outputPanel.style.display = ''; });

  async function run() {
    const code = editor.value.trim();
    if (!code) return;
    localStorage.setItem(CODE_KEY, editor.value);
    runBtn.disabled           = true;
    outputPanel.style.display = '';
    outputBody.innerHTML      = '';

    try {
      const outputs = await compile(code, 'python');
      renderBlocks(outputs, outputBody, {
        onAskAI: async (errorText, block, btn) => {
          btn.disabled = true; btn.textContent = 'Thinking…';
          try {
            const ctx = `Code (python):\n${code}\n\nError:\n${errorText}`;
            const explanation = await ask(ctx, systemExplainForLang('python'), 512);
            const explDiv = document.createElement('div');
            explDiv.className = 'output-ai-explanation';
            const lbl  = document.createElement('div');
            lbl.className = 'ai-explanation-label'; lbl.textContent = '小梦 suggests:';
            const body = document.createElement('div');
            body.className = 'ai-explanation-body';
            explDiv.append(lbl, body);
            block.after(explDiv);
            lbl.appendChild(createRefactorBtn({ sourceCode: code, sourceLang: 'python', explanation }));
            renderBlocks(parseAIResponse(explanation), body);
          } catch { /* ignore */ }
          finally { btn.disabled = false; btn.textContent = 'Ask AI'; }
        },
      });
    } catch (e) {
      const d = document.createElement('div');
      d.className = 'output-block output-error';
      d.innerHTML = `<div class="output-text">${String(e)}</div>`;
      outputBody.appendChild(d);
    }
    runBtn.disabled = false;
  }

  runBtn.addEventListener('click', run);
  editor.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); }
  });
  editor.addEventListener('input', () => localStorage.setItem(CODE_KEY, editor.value));

  document.addEventListener('ai-insert-and-run', ({ detail: { code, lang } }) => {
    const st = window.screenController?.getState('terminal');
    if (st !== 'normal' && st !== 'maximized') return;
    outputPanel.style.display = '';
    if (lang === 'python') {
      editor.value = code;
      localStorage.setItem(CODE_KEY, code);
      run();
      return;
    }
    outputBody.innerHTML = '';
    const type = (lang === 'mathjax' || lang === 'latex') ? 'latex' : lang === 'html' ? 'html' : 'text';
    renderBlocks([{ type, content: code }], outputBody);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupGenerativeScreen);
} else {
  setupGenerativeScreen();
}
