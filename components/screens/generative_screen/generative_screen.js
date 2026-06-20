import { createAriaChat } from './aria_chat.js';

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
      if (isScreenOpen()) {
        // Screen is open → minimize
        window.screenController?.minimize('terminal');
        Object.values(btns).forEach(b => b.classList.remove('active'));
      } else {
        // Screen is closed/minimized → open (screen-opened fires → resets to ARIA chat)
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

    // Deactivate when screen is closed or minimized by something else
    document.addEventListener('screen-closed',    ({ detail }) => { if (detail.id === 'terminal') btn.classList.remove('active'); });
    document.addEventListener('screen-minimized', ({ detail }) => { if (detail.id === 'terminal') btn.classList.remove('active'); });

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

  // ── 1. Terminal view — ARIA chat ──────────────────────────────────────────
  const terminalView = document.createElement('div');
  terminalView.className    = 'gen-view gen-terminal-view gen-view--active';
  terminalView.dataset.view = 'gen-terminal';

  const ariaChat = createAriaChat();
  terminalView.append(ariaChat);

  // ── View container ────────────────────────────────────────────────────────
  const viewContainer = document.createElement('div');
  viewContainer.className = 'gen-view-container';
  viewContainer.append(terminalView);
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
