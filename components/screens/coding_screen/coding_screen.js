import { getCurrentMode } from '../../compiler/compiler_mode_switcher/compiler_mode_switcher.js';
import { recordRecentItem } from '../../empty_state_dashboard/empty_state_dashboard.js';
import { init as initNotebook, addImportedCell, setVarNameResolver, clearAllDatasetLabels, getPersistedVarNames, getCellOrder, getCellDatasetInfo } from '../../customise_code_block/customise_code_block.js';
import { createClearCellsBtn } from './coding_screen_utility.js';
import { renderBlocks, parseAIResponse } from '../compiling_screen/compiling_screen_utility.js';
import { ask, systemExplainForLang } from '../../ai/ai_client.js';
import { createRefactorBtn } from '../compiling_screen/refactorization_button/refactorization_button.js';
import { createSourceWidget } from '../../look_up_source/look_up_source.js';
import { resetKernel, preloadPython, getDataFrameSchema, queryKernelContext } from '../../compiler/compiler.js';
import { clearDataset, getAllDatasets } from '../../shared/dataset_store.js';
import { getSettings } from '../../right_bar/settings.js';
import { mountNbSearch } from '../../customise_code_block/nb_search.js';

function setupCodingScreen() {
  const screen = document.getElementById('coding-screen');
  if (!screen) return;

  screen.innerHTML = `
    <div class="coding-screen-body" id="coding-screen-body">
      <div id="cds-notebook-view"></div>
    </div>
  `;

  // ── Screen controller ─────────────────────────────────
  requestAnimationFrame(() => {
    window.screenController?.register('coding', screen, { label: 'Code', persisted: true, noChip: true, group: 'hero' });
    preloadPython();

    document.addEventListener('screen-opened', ({ detail }) => {
      if (detail?.id === 'coding') {
        recordRecentItem({ id: 'notebook', name: 'Notebook', type: 'notebook' });
      }
    });

    // Auto-run all cells once kernel finishes booting (setting: autoRunOnLoad)
    if (getSettings().autoRunOnLoad) {
      // 'Notebook Editor' message = first-boot complete (distinct from cell-run 'Done')
      document.addEventListener('compiler-status', function _onBoot({ detail }) {
        if (detail.status === 'ready' && detail.message === 'Notebook Editor') {
          document.removeEventListener('compiler-status', _onBoot);
          // Small delay so cells are fully mounted before running
          setTimeout(() => {
            document.querySelector('.nb-run-all-btn')?.click();
          }, 300);
        }
      });
    }
  });

  const notebookView = document.getElementById('cds-notebook-view');

  // ── Notebook view ─────────────────────────────────────
  const nbLeft = document.createElement('div');
  nbLeft.className = 'cds-notebook-panel';

  const nbToolbar = document.createElement('div');
  nbToolbar.className = 'cds-notebook-toolbar';
  const runAllSlot = document.createElement('div');
  runAllSlot.id = 'cds-runall-slot';
  runAllSlot.className = 'cds-runall-slot';
  const clearCellsBtn = createClearCellsBtn();

  // ── Restart kernel button (two-step confirm) ──────────────
  const _RESTART_SVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>`;
  const restartKernelBtn = document.createElement('button');
  restartKernelBtn.className   = 'sc-btn sc-btn--danger';
  restartKernelBtn.title       = 'Restart kernel — clears all variables (click twice to confirm)';
  restartKernelBtn.innerHTML   = _RESTART_SVG;

  // ── Trim empty cells button ───────────────────────────────
  const trimEmptyBtn = document.createElement('button');
  trimEmptyBtn.className = 'sc-btn';
  trimEmptyBtn.title     = '清理空白 Cell（删除内容为空的 Cell）';
  trimEmptyBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>`;
  trimEmptyBtn.addEventListener('click', () =>
    document.dispatchEvent(new CustomEvent('trim-empty-cells'))
  );

  nbToolbar.append(runAllSlot, clearCellsBtn, trimEmptyBtn, restartKernelBtn);

  // ── Variable name resolver — shared across all cell import buttons ──
  // Seed with persisted varNames so new imports don't collide with restored data.
  const _usedVarNames = getPersistedVarNames();

  function _resolveVarName(filename) {
    if (!_usedVarNames.has('df')) {
      _usedVarNames.add('df');
      return 'df';
    }
    const base = filename
      .replace(/\.[^.]+$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    let name = base ? `df_${base}` : 'df2';
    let i = 2;
    const orig = name;
    while (_usedVarNames.has(name)) name = `${orig}_${i++}`;
    _usedVarNames.add(name);
    return name;
  }

  setVarNameResolver(_resolveVarName);

  // ── Restart: two-step confirm, clears all per-cell import labels ──
  let _restartArmed = false;
  restartKernelBtn.addEventListener('click', async () => {
    if (!_restartArmed) {
      _restartArmed = true;
      restartKernelBtn.innerHTML = `<span class="sc-btn-sure-text">Sure?</span>`;
      restartKernelBtn.classList.add('sc-btn--danger-armed');
      setTimeout(() => {
        if (_restartArmed) {
          _restartArmed = false;
          restartKernelBtn.innerHTML = _RESTART_SVG;
          restartKernelBtn.classList.remove('sc-btn--danger-armed');
        }
      }, 3000);
      return;
    }
    _restartArmed = false;
    restartKernelBtn.classList.remove('sc-btn--danger-armed');
    restartKernelBtn.disabled = true;
    restartKernelBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="sc-btn-spin"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>`;
    await resetKernel();
    _usedVarNames.clear();
    clearAllDatasetLabels();
    clearDataset();
    document.dispatchEvent(new CustomEvent('kernel-restarted'));
    restartKernelBtn.disabled = false;
    restartKernelBtn.innerHTML = _RESTART_SVG;
  });

  // ── Mode label ────────────────────────────────────────
  const cdsModeLabel = document.createElement('span');
  cdsModeLabel.className   = 'cds-mode-label';
  nbToolbar.appendChild(cdsModeLabel);

  // ── Global cell search (centred in toolbar) ───────────
  mountNbSearch(nbToolbar, clearCellsBtn);

  nbLeft.appendChild(nbToolbar);
  notebookView.appendChild(nbLeft);
  initNotebook(nbLeft, runAllSlot);

  // ── Notebook output panel ─────────────────────────────
  const NB_OUT_W_KEY = 'dp-nb-output-w';
  const NB_OUT_MIN_W = 200;
  const savedNbOutW  = parseFloat(localStorage.getItem(NB_OUT_W_KEY)) || 0;

  const nbOutputPanel = document.createElement('div');
  nbOutputPanel.className = 'cds-output-panel';
  // If no saved width, flex:1 so the panel shares space equally with the cells panel.
  if (savedNbOutW) {
    nbOutputPanel.style.width = savedNbOutW + 'px';
    nbOutputPanel.style.flex  = 'none';
  }

  const nbOutputPanelHdr = document.createElement('div');
  nbOutputPanelHdr.className = 'cds-output-panel-hdr';

  const nbOutputHdrLabel = document.createElement('span');
  nbOutputHdrLabel.className = 'cds-output-panel-label';
  nbOutputHdrLabel.textContent = 'Output';

  const nbOutClearBtn = document.createElement('button');
  nbOutClearBtn.className = 'sc-btn';
  nbOutClearBtn.title = 'Clear all output';
  nbOutClearBtn.textContent = '⊘';

  // Scroll to the output section of the currently active/focused cell
  const nbOutScrollActiveBtn = document.createElement('button');
  nbOutScrollActiveBtn.className = 'sc-btn';
  nbOutScrollActiveBtn.title = 'Scroll to active cell';
  nbOutScrollActiveBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>`;
  nbOutScrollActiveBtn.addEventListener('click', () => {
    const activeSec = nbOutputBody.querySelector('.cds-section--active');
    const target = activeSec ?? nbOutputBody.lastElementChild;
    target?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  const nbOutMaxBtn = document.createElement('button');
  nbOutMaxBtn.className = 'sc-btn';
  nbOutMaxBtn.title = 'Maximize';
  nbOutMaxBtn.textContent = '⤢';

  const nbOutMinBtn = document.createElement('button');
  nbOutMinBtn.className = 'sc-btn';
  nbOutMinBtn.title = 'Minimize';
  nbOutMinBtn.textContent = '−';

  const nbOutToolbar = document.createElement('div');
  nbOutToolbar.className = 'sc-toolbar';
  nbOutToolbar.append(nbOutClearBtn, nbOutScrollActiveBtn, nbOutMaxBtn, nbOutMinBtn);

  nbOutputPanelHdr.append(nbOutputHdrLabel, nbOutToolbar);

  const nbOutputPlaceholder = document.createElement('div');
  nbOutputPlaceholder.className = 'cds-output-placeholder';
  nbOutputPlaceholder.textContent = 'Run to see output';

  const nbOutputBody = document.createElement('div');
  nbOutputBody.className = 'cds-output-body';

  nbOutputPanel.append(nbOutputPanelHdr, nbOutputPlaceholder, nbOutputBody);

  const nbResizer = document.createElement('div');
  nbResizer.className = 'cds-resizer';
  nbResizer.title = 'Drag to resize · Double-click to reset';
  nbOutputPanel.appendChild(nbResizer);

  function _startNbResize(startX) {
    document.body.classList.add('cs-resizing');
    function onMove(clientX) {
      const viewRect = notebookView.getBoundingClientRect();
      const maxW = viewRect.width * 0.75;
      const newW = Math.min(maxW, Math.max(NB_OUT_MIN_W, viewRect.right - clientX));
      nbOutputPanel.style.width = newW + 'px';
      nbOutputPanel.style.flex  = 'none';
    }
    function onUp(clientX) {
      document.removeEventListener('mousemove', onNbMouseMove);
      document.removeEventListener('mouseup',   onNbMouseUp);
      document.removeEventListener('touchmove', onNbTouchMove);
      document.removeEventListener('touchend',  onNbTouchEnd);
      document.body.classList.remove('cs-resizing');
      onMove(clientX);
      localStorage.setItem(NB_OUT_W_KEY, parseFloat(nbOutputPanel.style.width));
    }
    const onNbMouseMove = e => onMove(e.clientX);
    const onNbMouseUp   = e => onUp(e.clientX);
    const onNbTouchMove = e => { e.preventDefault(); onMove(e.touches[0].clientX); };
    const onNbTouchEnd  = e => onUp(e.changedTouches[0].clientX);
    document.addEventListener('mousemove', onNbMouseMove);
    document.addEventListener('mouseup',   onNbMouseUp);
    document.addEventListener('touchmove', onNbTouchMove, { passive: false });
    document.addEventListener('touchend',  onNbTouchEnd);
  }

  nbResizer.addEventListener('mousedown',  e => { e.preventDefault(); _startNbResize(e.clientX); });
  nbResizer.addEventListener('touchstart', e => { e.preventDefault(); _startNbResize(e.touches[0].clientX); }, { passive: false });
  nbResizer.addEventListener('dblclick', () => {
    nbOutputPanel.style.width = '';
    nbOutputPanel.style.flex  = '';   // back to flex:1 (CSS default)
    localStorage.removeItem(NB_OUT_W_KEY);
  });

  notebookView.appendChild(nbOutputPanel);
  nbOutputPanel.style.display = 'none'; // Output now lives in each cell's .mirror-out-pane

  // ── Output persistence (survives page refresh) ────────
  const NB_OUTPUTS_KEY = 'dreaming-polar-nb-outputs';

  function _saveOutputs(cellId, label, lang, outputs, sourceCode) {
    if (!getSettings().cacheNotebookOutput) return;  // setting OFF → don't persist
    let stored;
    try { stored = JSON.parse(localStorage.getItem(NB_OUTPUTS_KEY) ?? '{}'); } catch { stored = {}; }
    stored[cellId] = {
      label, lang,
      sourceCode: sourceCode ?? null,
      outputs: (outputs ?? []).map(o => o.type === 'image' ? { type: 'chart-placeholder' } : o),
    };
    try { localStorage.setItem(NB_OUTPUTS_KEY, JSON.stringify(stored)); } catch (_) {}
  }

  function _removeStoredOutput(cellId) {
    let stored;
    try { stored = JSON.parse(localStorage.getItem(NB_OUTPUTS_KEY) ?? '{}'); } catch { stored = {}; }
    delete stored[cellId];
    try { localStorage.setItem(NB_OUTPUTS_KEY, JSON.stringify(stored)); } catch (_) {}
  }

  function _clearAllStoredOutputs() {
    try { localStorage.removeItem(NB_OUTPUTS_KEY); } catch (_) {}
  }

  // ── Per-cell output sections ──────────────────────────
  const nbSections = new Map();

  const ICON_COPY  = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
  const ICON_CHECK = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

  function getOrCreateNbSection(cellId, cellLabel, lang) {
    if (nbSections.has(cellId)) {
      const sec = nbSections.get(cellId);
      const spanEl = sec.labelEl.querySelector('span');
      if (spanEl && cellLabel) spanEl.textContent = cellLabel;
      if (lang) sec.lang = lang;
      // If source view is open (_rawView sibling of textPane), close it first
      // so viz cards are not hidden and textPane is visible for new output.
      const rawView = sec.bodyEl?.querySelector('.lus-raw-view');
      if (rawView) { rawView.remove(); sec.textPane.style.display = ''; }

      // If a viz retry is in progress, preserve chartPane so there's no collapse flicker.
      // The caller sets data-preserve-chart before dispatching run-cell-by-id.
      // Save which viz-suggestion bodies were expanded so we can restore them after re-render
      const _expandedVizVars = new Set();
      sec.textPane.querySelectorAll('.vsug-body:not([hidden])').forEach(body => {
        const name = body.closest('.output-viz-suggestion')?.querySelector('.vsug-name')?.textContent;
        if (name) _expandedVizVars.add(name);
      });
      sec._expandedVizVars = _expandedVizVars;

      if (sec.sectionEl.dataset.preserveChart) {
        delete sec.sectionEl.dataset.preserveChart;
      } else {
        sec.chartPane.innerHTML = '';
        sec.chartPane.classList.remove('has-chart');
      }
      sec.textPane.innerHTML = '';
      return sec;
    }
    nbOutputPlaceholder.style.display = 'none';

    const sectionEl = document.createElement('div');
    sectionEl.className = 'cds-output-section';
    sectionEl.dataset.cellId = cellId;

    // ── Label: cell identifier + action buttons on right ──
    const labelEl = document.createElement('div');
    labelEl.className = 'cds-output-section-label';

    const labelInner = document.createElement('div');
    labelInner.className = 'cds-output-section-label-text';
    const labelSpan = document.createElement('span');
    labelSpan.textContent = cellLabel ?? '';
    labelInner.appendChild(labelSpan);
    labelEl.appendChild(labelInner);

    // Grouped button cluster on the right
    const labelBtns = document.createElement('div');
    labelBtns.className = 'cds-output-label-btns';

    const sourceWidget = createSourceWidget();
    sourceWidget.element.className = 'cds-inner-btn lus-btn';
    labelBtns.appendChild(sourceWidget.element);

    const copySourceBtn = document.createElement('button');
    copySourceBtn.className = 'cds-inner-btn lus-copy-btn';
    copySourceBtn.title = 'Copy output text';
    copySourceBtn.innerHTML = ICON_COPY;
    copySourceBtn.style.display = 'none';
    copySourceBtn.addEventListener('click', () => {
      const text = (sec?.textPane?.innerText ?? '') + (sec?.chartPane?.innerText ?? '');
      if (!text.trim()) return;
      navigator.clipboard?.writeText(text).then(() => {
        copySourceBtn.innerHTML = ICON_CHECK;
        copySourceBtn.classList.add('lus-copy-btn--done');
        setTimeout(() => { copySourceBtn.innerHTML = ICON_COPY; copySourceBtn.classList.remove('lus-copy-btn--done'); }, 1500);
      });
    });
    labelBtns.appendChild(copySourceBtn);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'cds-inner-btn cds-output-section-close';
    closeBtn.title = 'Dismiss';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => {
      sectionEl.remove();
      nbSections.delete(cellId);
      _removeStoredOutput(cellId);
      if (nbSections.size === 0) nbOutputPlaceholder.style.display = '';
    });
    labelBtns.appendChild(closeBtn);
    labelEl.appendChild(labelBtns);

    // ── Body: chartPane → textPane ────────────────────
    const bodyEl = document.createElement('div');
    bodyEl.className = 'cds-output-section-body';

    const chartPane = document.createElement('div');
    chartPane.className = 'cds-output-chart-pane';

    const textPane = document.createElement('div');
    textPane.className = 'cds-output-text-pane';

    bodyEl.append(chartPane, textPane);
    sectionEl.append(labelEl, bodyEl);

    // Mount inside the cell's mirror output pane; fall back to legacy body if not found.
    const mirrorOutPane = document.querySelector(`.nb-cell[data-nb-id="${cellId}"] .mirror-out-pane`);
    if (mirrorOutPane) {
      mirrorOutPane.appendChild(sectionEl);
    } else {
      console.warn('[mirror] No .mirror-out-pane for cell', cellId, '— falling back to output body');
      nbOutputBody.appendChild(sectionEl);
    }

    const sec = { sectionEl, labelEl, bodyEl, textPane, chartPane, lang: lang ?? '', sourceWidget, copySourceBtn, sourceCode: null };
    nbSections.set(cellId, sec);
    return sec;
  }

  function _renderIntoSection(sec, outputs, sourceCode, sourceLang) {
    sec.sourceWidget?.setSource(sourceCode ?? null, sourceLang ?? null);
    sec.sourceCode = sourceCode ?? null;
    if (sec.copySourceBtn) sec.copySourceBtn.style.display = outputs?.length ? '' : 'none';
    renderBlocks(outputs, sec.textPane, {
      chartContainer: sec.chartPane,
      onAskAI: async (errorText, block, btn) => {
        btn.disabled = true;
        btn.textContent = 'Thinking…';
        try {
          // Fetch kernel DataFrame context (columns, dtypes, shape) for richer suggestions
          const dfs = await queryKernelContext().catch(() => []);
          const dfContext = dfs.length
            ? `\n\nAvailable DataFrames in kernel:\n` + dfs.map(d => {
                const cols = d.columns.length
                  ? `columns=[${d.columns.join(', ')}]`
                  : `dtype=${Object.values(d.dtypes)[0] ?? 'unknown'}`;
                return `  ${d.varName} (${d.kind}): shape=${d.shape.join('×')}, ${cols}`;
              }).join('\n')
            : '';

          const context = sourceCode
            ? `Code (${sourceLang ?? 'unknown'}):\n${sourceCode}\n\nError:\n${errorText}${dfContext}`
            : errorText + dfContext;

          const explanation = await ask(context, systemExplainForLang(sourceLang), 512);
          const explDiv = document.createElement('div');
          explDiv.className = 'output-ai-explanation';
          const lbl = document.createElement('div');
          lbl.className = 'ai-explanation-label';
          lbl.textContent = '小梦 suggests:';
          const bodyEl2 = document.createElement('div');
          bodyEl2.className = 'ai-explanation-body';
          explDiv.append(lbl, bodyEl2);
          block.after(explDiv);
          lbl.appendChild(createRefactorBtn({
            sourceCode, sourceLang,
            cellId: sec.sectionEl.dataset.cellId,
            explanation,
            dfContext,   // pass through so Refactor also knows real column names
          }));
          renderBlocks(parseAIResponse(explanation), bodyEl2);
        } catch { /* ignore */ }
        finally { btn.disabled = false; btn.textContent = 'Ask AI'; }
      },
    });

    // Restore viz-suggestion bodies that were expanded before re-render
    if (sec._expandedVizVars?.size) {
      sec.textPane.querySelectorAll('.output-viz-suggestion').forEach(card => {
        const name = card.querySelector('.vsug-name')?.textContent;
        if (name && sec._expandedVizVars.has(name)) {
          const body    = card.querySelector('.vsug-body');
          const chevron = card.querySelector('.vsug-chevron');
          if (body) {
            body.hidden = false;
            chevron?.classList.add('vsug-chevron--open');
          }
        }
      });
      sec._expandedVizVars = null;
    }
  }

  document.addEventListener('notebook-cells-reordered', ({ detail: { order } }) => {
    if (!Array.isArray(order)) return;
    order.forEach((cellId, idx) => {
      const sec = nbSections.get(cellId);
      if (!sec) return;
      // sectionEl lives in .mirror-out-pane inside the cell — cells are reordered, sections follow
      const spanEl = sec.labelEl.querySelector('span');
      if (spanEl && sec.lang) spanEl.textContent = `Cell ${idx + 1} · ${sec.lang}`;
    });
  });

  nbOutClearBtn.addEventListener('click', () => {
    nbSections.forEach(sec => sec.sectionEl.remove());
    nbOutputBody.innerHTML = '';
    nbSections.clear();
    nbOutputPlaceholder.style.display = '';
    _clearAllStoredOutputs();
  });

  // Remove the corresponding output section when a cell is deleted
  document.addEventListener('notebook-cell-deleted', ({ detail: { cellId } }) => {
    const sec = nbSections.get(cellId);
    if (!sec) return;
    sec.sectionEl.remove();
    nbSections.delete(cellId);
    _removeStoredOutput(cellId);
    if (nbSections.size === 0) nbOutputPlaceholder.style.display = '';
  });

  document.addEventListener('notebook-clear-output', () => {
    nbSections.forEach(sec => sec.sectionEl.remove());
    nbOutputBody.innerHTML = '';
    nbSections.clear();
    nbOutputPlaceholder.style.display = '';
    _clearAllStoredOutputs();
  });

  document.addEventListener('kernel-restarted', () => {
    nbSections.forEach(sec => sec.sectionEl.remove());
    nbOutputBody.innerHTML = '';
    nbSections.clear();
    nbOutputPlaceholder.style.display = '';
    _clearAllStoredOutputs();
  });

  nbOutMaxBtn.addEventListener('click', () => {
    const isMax = nbOutputPanel.dataset.expanded === '1';
    if (isMax) {
      nbOutputPanel.style.width = nbOutputPanel.dataset.prevWidth || (savedNbOutW + 'px');
      nbOutputPanel.style.flex  = 'none';
      delete nbOutputPanel.dataset.expanded;
      nbOutMaxBtn.textContent = '⤢';
      nbOutMaxBtn.title = 'Maximize';
    } else {
      nbOutputPanel.dataset.prevWidth = nbOutputPanel.style.width;
      nbOutputPanel.dataset.expanded  = '1';
      const maxW = notebookView.getBoundingClientRect().width * 0.75;
      nbOutputPanel.style.width = Math.round(maxW) + 'px';
      nbOutputPanel.style.flex  = 'none';
      nbOutMaxBtn.textContent = '⤡';
      nbOutMaxBtn.title = 'Restore';
    }
  });

  // ── Restore button — lives in the notebook toolbar (far right), hidden by default ──
  const restoreBtn = document.createElement('button');
  restoreBtn.className = 'sc-btn nb-out-restore-btn';
  restoreBtn.title = 'Restore output panel';
  restoreBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`;
  restoreBtn.hidden = true; // output panel retired — button permanently hidden
  // Mount in the notebook toolbar so it stays in the left panel, never overlaps output header
  nbToolbar.appendChild(restoreBtn);

  function _hidePanel() {
    nbOutputPanel.style.display = 'none';
    restoreBtn.hidden = false;
  }

  nbOutMinBtn.addEventListener('click', _hidePanel);

  document.addEventListener('compile-result', () => {
    restoreBtn.hidden = true;
  });

  document.addEventListener('compile-result', ({ detail }) => {
    if (!detail.cellId) return;
    const runSec = nbSections.get(detail.cellId);
    if (runSec) runSec.sectionEl.dataset.schemaVar = '';
    const { outputs, cellId, cellLabel, sourceCode, sourceLang, ariaSource } = detail;
    // When ARIA-generated, show "ARIA" in place of the lang in the label
    const displayLabel = ariaSource
      ? cellLabel.replace(/·\s*\S+$/, '· ARIA')
      : cellLabel;
    const sec = getOrCreateNbSection(cellId, displayLabel, sourceLang);
    // Mark/unmark output section as ARIA-generated for orange styling
    if (ariaSource) sec.sectionEl.dataset.ariaSource = '1';
    else            delete sec.sectionEl.dataset.ariaSource;
    _renderIntoSection(sec, outputs, sourceCode, sourceLang);
    _saveOutputs(cellId, displayLabel, sourceLang, outputs, sourceCode);
    requestAnimationFrame(() =>
      sec.sectionEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    );
  });

  // dsLabel click → show DataFrame schema in the output section
  // ── Schema rendering helpers ────────────────────────────────────────────────
  function _renderFullSchema(pane, varName, { rows, shape }) {
    pane.innerHTML = '';
    const hdr = document.createElement('div');
    hdr.className = 'cds-schema-hdr';
    hdr.textContent = `${varName}  —  ${shape[0].toLocaleString()} rows × ${shape[1]} cols`;
    pane.appendChild(hdr);

    const table = document.createElement('table');
    table.className = 'cds-schema-table';
    table.innerHTML = `<thead><tr><th>Column</th><th>Type</th><th>Nulls</th><th>Sample</th></tr></thead>`;
    const tbody = document.createElement('tbody');
    rows.forEach(r => {
      const tr = document.createElement('tr');
      const nullClass = r.nullPct > 0 ? (r.nullPct > 20 ? 'cds-schema-null--high' : 'cds-schema-null--low') : '';
      tr.innerHTML = `<td class="cds-schema-col">${r.col}</td>
        <td class="cds-schema-dtype">${r.dtype}</td>
        <td class="cds-schema-null ${nullClass}">${r.nullPct}%</td>
        <td class="cds-schema-sample">${r.sample}</td>`;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    pane.appendChild(table);
  }

  function _renderFallbackSchema(pane, varName, ds) {
    pane.innerHTML = '';
    // Estimate row count from ds.rows (full rows) or columns length
    const rowCount = Array.isArray(ds.rows) ? ds.rows.length : 0;
    const cols = ds.columns ?? [];

    const hdr = document.createElement('div');
    hdr.className = 'cds-schema-hdr';
    hdr.textContent = `${varName}  —  ${rowCount.toLocaleString()} rows × ${cols.length} cols`;
    pane.appendChild(hdr);

    // Fallback notice banner
    const notice = document.createElement('div');
    notice.className = 'cds-schema-fallback-notice';
    notice.textContent = '基于导入预览的估算数据 · 运行该 cell 后可查看精确统计';
    pane.appendChild(notice);

    const table = document.createElement('table');
    table.className = 'cds-schema-table';
    table.innerHTML = `<thead><tr><th>Column</th><th>Type</th><th>Nulls</th><th>Sample</th></tr></thead>`;
    const tbody = document.createElement('tbody');
    cols.forEach(col => {
      const dtype  = ds.dtypes?.[col] ?? 'object';
      const sample = Array.isArray(ds.rows) && ds.rows[0]?.[col] != null
        ? String(ds.rows[0][col]).slice(0, 40)
        : '';
      const tr = document.createElement('tr');
      tr.innerHTML = `<td class="cds-schema-col">${col}</td>
        <td class="cds-schema-dtype cds-schema-dtype--est">${dtype}</td>
        <td class="cds-schema-null cds-schema-null--est">—</td>
        <td class="cds-schema-sample">${sample}</td>`;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    pane.appendChild(table);
  }

  function _findDatasetForVar(varName) {
    // Try cell dataset info first (has varName → filename mapping)
    const cellInfo = getCellDatasetInfo().find(c => c.varName === varName);
    const filename = cellInfo?.filename ?? varName;
    return getAllDatasets().find(d => d.name === filename || d.name === varName) ?? null;
  }

  document.addEventListener('ds-schema-request', async ({ detail: { varName, cellId, cellLabel } }) => {
    const sec = getOrCreateNbSection(cellId, cellLabel, 'python');

    // Toggle: clicking the same varName again restores original output
    if (sec.sectionEl.dataset.schemaVar === varName) {
      sec.sectionEl.dataset.schemaVar = '';
      let stored;
      try { stored = JSON.parse(localStorage.getItem(NB_OUTPUTS_KEY) ?? '{}')[cellId]; } catch { stored = null; }
      if (stored?.outputs?.length) {
        sec.chartPane.innerHTML = '';
        sec.chartPane.classList.remove('has-chart');
        sec.textPane.innerHTML = '';
        _renderIntoSection(sec, stored.outputs, stored.sourceCode ?? null, stored.lang ?? 'python');
      }
      return;
    }

    sec.sectionEl.dataset.schemaVar = varName;
    sec.chartPane.innerHTML = '';
    sec.chartPane.classList.remove('has-chart');
    sec.textPane.innerHTML = `<div class="cds-schema-loading">Loading schema…</div>`;

    try {
      // Check if the variable is actually in the Python kernel
      // queryKernelContext() safely returns [] when kernel isn't initialized
      const kernelCtx = await queryKernelContext();
      const inKernel  = kernelCtx.some(d => d.varName === varName);

      if (inKernel) {
        // ── Full schema: accurate dtypes + real null% from Python ────────────
        const schema = await getDataFrameSchema(varName);
        _renderFullSchema(sec.textPane, varName, schema);
      } else {
        // ── Fallback: JS-only schema from dataset_store ──────────────────────
        const ds = _findDatasetForVar(varName);
        if (ds) {
          _renderFallbackSchema(sec.textPane, varName, ds);
        } else {
          sec.textPane.innerHTML = `<div class="cds-schema-loading">数据未找到 — 请先运行 cell 加载数据</div>`;
          sec.sectionEl.dataset.schemaVar = '';
        }
      }
    } catch (e) {
      sec.sectionEl.dataset.schemaVar = '';
      sec.textPane.innerHTML = `<pre class="output-error">Schema error: ${e.message}</pre>`;
    }

    requestAnimationFrame(() =>
      sec.sectionEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    );
  });

  // Status bar "jump to output" action
  document.addEventListener('scroll-to-cell-output', ({ detail: { cellIndex } }) => {
    for (const [, sec] of nbSections) {
      const span = sec.labelEl?.querySelector('span');
      if (span?.textContent?.includes(`Cell ${cellIndex}`)) {
        nbSections.forEach(s => s.sectionEl.classList.remove('cds-section--active'));
        sec.sectionEl.classList.add('cds-section--active');
        sec.sectionEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        return;
      }
    }
  });

  // Cell focus → highlight the corresponding output section (no scroll — section is inline)
  document.addEventListener('notebook-cell-focused', ({ detail: { cellId } }) => {
    const sec = nbSections.get(cellId);
    if (!sec) return;
    nbSections.forEach(s => s.sectionEl.classList.remove('cds-section--active'));
    sec.sectionEl.classList.add('cds-section--active');
  });

  // Restore outputs from previous session on load
  ;(function _restoreStoredOutputs() {
    if (!getSettings().cacheNotebookOutput) return;  // setting OFF → skip restore
    let stored;
    try { stored = JSON.parse(localStorage.getItem(NB_OUTPUTS_KEY) ?? '{}'); } catch { return; }
    for (const [cellId, entry] of Object.entries(stored)) {
      if (!entry?.outputs?.length) continue;
      const sec = getOrCreateNbSection(cellId, entry.label ?? cellId, entry.lang ?? 'python');
      _renderIntoSection(sec, entry.outputs, entry.sourceCode ?? null, entry.lang ?? 'python');
      // Only mark stale if user has NOT opted into caching — if they did, this IS the normal state
      // cacheNotebookOutput ON → no badge; OFF → show badge warning it's old data
    }
    // Output panel is retired — sections live in mirror-out-pane inside each cell
  })();

  // Clear stale mark when the cell produces fresh output
  document.addEventListener('compile-result', ({ detail }) => {
    if (!detail?.cellId) return;
    nbSections.get(detail.cellId)?.sectionEl.classList.remove('cds-section--stale');
  });

  // ── Chat-mode placeholder ─────────────────────────────
  const chatPlaceholder = document.createElement('div');
  chatPlaceholder.className = 'cds-chat-placeholder';
  chatPlaceholder.innerHTML =
    '<span class="cds-chat-placeholder-icon">💬</span>' +
    '<span class="cds-chat-placeholder-text">Chat 模式 — 小梦在右侧面板等你~</span>';
  document.getElementById('coding-screen-body').appendChild(chatPlaceholder);

  // ── Show notebook vs. chat placeholder ───────────────
  function applyMode(mode) {
    const isChat = mode === 'ai_chat';
    notebookView.style.display    = isChat ? 'none' : 'flex';
    chatPlaceholder.style.display = isChat ? 'flex' : 'none';
  }

  applyMode(getCurrentMode());
  document.addEventListener('compiler-mode-change', ({ detail }) => applyMode(detail.mode));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupCodingScreen);
} else {
  setupCodingScreen();
}
