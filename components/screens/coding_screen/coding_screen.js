import { getCurrentMode } from '../../compiler/compiler_mode_switcher/compiler_mode_switcher.js';
import { init as initNotebook, addImportedCell, setVarNameResolver, clearAllDatasetLabels } from '../../customise_code_block/customise_code_block.js';
import { createClearCellsBtn } from './coding_screen_utility.js';
import { renderBlocks, parseAIResponse } from '../compiling_screen/compiling_screen_utility.js';
import { ask, systemExplainForLang } from '../../ai/ai_client.js';
import { createRefactorBtn } from '../compiling_screen/refactorization_button/refactorization_button.js';
import { createSourceWidget } from '../../look_up_source/look_up_source.js';
import { resetKernel, preloadPython } from '../../compiler/compiler.js';

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
    // Warm up the Python interpreter in the background so it's ready before
    // the user clicks Run. This eliminates the KBS appearing mid-run.
    preloadPython();
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
  const restartKernelBtn = document.createElement('button');
  restartKernelBtn.className   = 'sc-btn sc-btn--danger';
  restartKernelBtn.title       = 'Restart kernel — clears all variables (click twice to confirm)';
  restartKernelBtn.textContent = '↺';

  nbToolbar.append(runAllSlot, clearCellsBtn, restartKernelBtn);

  // ── Variable name resolver — shared across all cell import buttons ──
  const _usedVarNames = new Set();

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
      restartKernelBtn.textContent = 'Sure?';
      restartKernelBtn.classList.add('sc-btn--danger-armed');
      setTimeout(() => {
        if (_restartArmed) {
          _restartArmed = false;
          restartKernelBtn.textContent = '↺';
          restartKernelBtn.classList.remove('sc-btn--danger-armed');
        }
      }, 3000);
      return;
    }
    _restartArmed = false;
    restartKernelBtn.classList.remove('sc-btn--danger-armed');
    restartKernelBtn.disabled    = true;
    restartKernelBtn.textContent = '↺…';
    await resetKernel();
    _usedVarNames.clear();
    clearAllDatasetLabels();
    restartKernelBtn.disabled    = false;
    restartKernelBtn.textContent = '↺';
  });

  // ── Mode label ────────────────────────────────────────
  const cdsModeLabel = document.createElement('span');
  cdsModeLabel.className   = 'cds-mode-label';
  nbToolbar.appendChild(cdsModeLabel);

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
  nbOutClearBtn.title = 'Clear output';
  nbOutClearBtn.textContent = '⊘';

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
  nbOutToolbar.append(nbOutClearBtn, nbOutMaxBtn, nbOutMinBtn);

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

  // ── Per-cell output sections ──────────────────────────
  const nbSections = new Map();

  function getOrCreateNbSection(cellId, cellLabel, lang) {
    if (nbSections.has(cellId)) {
      const sec = nbSections.get(cellId);
      const spanEl = sec.labelEl.querySelector('span');
      if (spanEl && cellLabel) spanEl.textContent = cellLabel;
      if (lang) sec.lang = lang;
      sec.bodyEl.innerHTML = '';
      return sec;
    }
    nbOutputPlaceholder.style.display = 'none';

    const sectionEl = document.createElement('div');
    sectionEl.className = 'cds-output-section';
    sectionEl.dataset.cellId = cellId;

    const labelEl = document.createElement('div');
    labelEl.className = 'cds-output-section-label';

    const labelInner = document.createElement('div');
    labelInner.className = 'cds-output-section-label-text';
    const labelSpan = document.createElement('span');
    labelSpan.textContent = cellLabel ?? '';
    labelInner.appendChild(labelSpan);
    labelEl.appendChild(labelInner);

    const sourceWidget = createSourceWidget();
    labelEl.appendChild(sourceWidget.element);

    const ICON_COPY  = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    const ICON_CHECK = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

    const copySourceBtn = document.createElement('button');
    copySourceBtn.className = 'nb-btn lus-copy-btn cds-copy-source-btn';
    copySourceBtn.title = 'Copy output';
    copySourceBtn.innerHTML = ICON_COPY;
    copySourceBtn.style.display = 'none';
    copySourceBtn.addEventListener('click', () => {
      const text = sec?.bodyEl?.innerText ?? '';
      if (!text.trim()) return;
      navigator.clipboard?.writeText(text).then(() => {
        copySourceBtn.innerHTML = ICON_CHECK;
        copySourceBtn.classList.add('lus-copy-btn--done');
        setTimeout(() => {
          copySourceBtn.innerHTML = ICON_COPY;
          copySourceBtn.classList.remove('lus-copy-btn--done');
        }, 1500);
      });
    });
    labelEl.appendChild(copySourceBtn);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'cds-output-section-close';
    closeBtn.title = 'Dismiss';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => {
      sectionEl.remove();
      nbSections.delete(cellId);
      if (nbSections.size === 0) nbOutputPlaceholder.style.display = '';
    });
    labelEl.appendChild(closeBtn);

    const bodyEl = document.createElement('div');
    bodyEl.className = 'cds-output-section-body';

    sectionEl.append(labelEl, bodyEl);
    nbOutputBody.appendChild(sectionEl);

    const sec = { sectionEl, labelEl, bodyEl, lang: lang ?? '', sourceWidget, copySourceBtn, sourceCode: null };
    nbSections.set(cellId, sec);
    return sec;
  }

  document.addEventListener('notebook-cells-reordered', ({ detail: { order } }) => {
    if (!Array.isArray(order)) return;
    order.forEach((cellId, idx) => {
      const sec = nbSections.get(cellId);
      if (!sec) return;
      nbOutputBody.appendChild(sec.sectionEl);
      const spanEl = sec.labelEl.querySelector('span');
      if (spanEl && sec.lang) spanEl.textContent = `Cell ${idx + 1} · ${sec.lang}`;
    });
  });

  nbOutClearBtn.addEventListener('click', () => {
    nbOutputBody.innerHTML = '';
    nbSections.clear();
    nbOutputPlaceholder.style.display = '';
  });

  document.addEventListener('notebook-clear-output', () => {
    nbOutputBody.innerHTML = '';
    nbSections.clear();
    nbOutputPlaceholder.style.display = '';
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

  nbOutMinBtn.addEventListener('click', () => {
    nbOutputPanel.style.display = 'none';
  });

  document.addEventListener('compile-result', () => {
    nbOutputPanel.style.display = '';
  });

  document.addEventListener('compile-result', ({ detail }) => {
    if (!detail.cellId) return;
    const { outputs, cellId, cellLabel, sourceCode, sourceLang } = detail;
    const sec = getOrCreateNbSection(cellId, cellLabel, sourceLang);
    sec.sourceWidget?.setSource(sourceCode ?? null, sourceLang ?? null);
    sec.sourceCode = sourceCode ?? null;
    // Show copy button whenever there's output to copy (not gated on sourceCode).
    if (sec.copySourceBtn) sec.copySourceBtn.style.display = outputs?.length ? '' : 'none';
    renderBlocks(outputs, sec.bodyEl, {
      onAskAI: async (errorText, block, btn) => {
        btn.disabled = true;
        btn.textContent = 'Thinking…';
        try {
          const context = sourceCode
            ? `Code (${sourceLang ?? 'unknown'}):\n${sourceCode}\n\nError:\n${errorText}`
            : errorText;
          const explanation = await ask(context, systemExplainForLang(sourceLang), 512);
          const explDiv = document.createElement('div');
          explDiv.className = 'output-ai-explanation';
          const lbl = document.createElement('div');
          lbl.className = 'ai-explanation-label';
          lbl.textContent = '小梦 suggests:';
          const bodyEl = document.createElement('div');
          bodyEl.className = 'ai-explanation-body';
          explDiv.append(lbl, bodyEl);
          block.after(explDiv);
          lbl.appendChild(createRefactorBtn({ sourceCode, sourceLang, cellId, explanation }));
          renderBlocks(parseAIResponse(explanation), bodyEl);
        } catch { /* ignore */ }
        finally { btn.disabled = false; btn.textContent = 'Ask AI'; }
      },
    });
    requestAnimationFrame(() =>
      sec.sectionEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    );
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
