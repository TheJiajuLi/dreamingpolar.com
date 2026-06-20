import { getDataset } from '../../shared/dataset_store.js';
import { createAriaChat } from './aria_chat.js';

// ── Constants ────────────────────────────────────────────────────────────────
// ── VT button definitions ────────────────────────────────────────────────────
// id must be unique across ALL vt-btn-activated events in the app.
const VT_DEFS = [
  {
    id: 'gen-models', label: 'Models',
    icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`,
  },
];

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
  hint.innerHTML   = 'After loading, ask ARIA a question — or run <code>df.head()</code> in Power Notebook.';

  inner.append(title, sub, btnWrap, hint);
  div.appendChild(inner);
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

  const ariaChat = createAriaChat();
  terminalView.append(ariaChat);

  // ── 2-4. Other views ─────────────────────────────────────────────────────
  const modelsView = _buildModelsView();

  // ── View container ────────────────────────────────────────────────────────
  const viewContainer = document.createElement('div');
  viewContainer.className = 'gen-view-container';
  viewContainer.append(terminalView, modelsView);
  screen.appendChild(viewContainer);

  // ── Active view state ─────────────────────────────────────────────────────
  let _activeView     = 'gen-terminal';
  let _vtBtns         = {};

  function switchView(id) {
    _activeView = id;
    viewContainer.querySelectorAll('.gen-view').forEach(v => {
      v.classList.toggle('gen-view--active', v.dataset.view === id);
    });
    Object.values(_vtBtns).forEach(b => b.classList.remove('active'));
    if (_vtBtns[id]) _vtBtns[id].classList.add('active');
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

  // ── Quick Analysis import (lightweight JS path) ──────────────────────────
  // source='import' → new file loaded → show DATA card, switch to chat view
  // source='switch' → user clicked a tab → DO NOT show DATA card again
  document.addEventListener('dataset-updated', ({ detail }) => {
    if (!detail || detail.source !== 'import') return;
    const state = window.screenController?.getState('terminal');
    if (state !== 'normal' && state !== 'maximized') return;
    switchView('gen-terminal');
    ariaChat._onDataLoaded?.(detail.dataset?.name ?? 'file');
  });

  // ── Power Notebook inject (Python kernel path, kept for compatibility) ────
  document.addEventListener('kernel-mutation', ({ detail: { varName, source } }) => {
    if (source !== 'inject') return;
    const state = window.screenController?.getState('terminal');
    if (state !== 'normal' && state !== 'maximized') return;
    // In this path we don't have dataset_store populated, so just switch view
    switchView('gen-terminal');
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupGenerativeScreen);
} else {
  setupGenerativeScreen();
}
