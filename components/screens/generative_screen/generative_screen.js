import { createAriaChat } from './aria_chat.js';
import { recordRecentItem } from '../../empty_state_dashboard/empty_state_dashboard.js';

// ── Add VT navigation button (open / minimize Quick Analysis) ────────────────
function _addVtButtons(switchView, getActiveView, isScreenOpen) {
  const vtTop = document.querySelector('#vertical-toolbar .vt-top');
  if (!vtTop) return {};

  const btn = document.createElement('button');
  btn.className       = 'vt-btn gen-vt-btn';
  btn.title           = 'Quick Analysis';
  btn.dataset.genView = 'gen-terminal';
  btn.innerHTML       = `<svg width="18" height="18" viewBox="3 3 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="2.2"/><circle cx="5.5" cy="5.5" r="1.4"/><circle cx="18.5" cy="5.5" r="1.4"/><circle cx="5.5" cy="18.5" r="1.4"/><circle cx="18.5" cy="18.5" r="1.4"/><line x1="12" y1="9.8" x2="6.8" y2="6.8"/><line x1="12" y1="9.8" x2="17.2" y2="6.8"/><line x1="12" y1="14.2" x2="6.8" y2="17.2"/><line x1="12" y1="14.2" x2="17.2" y2="17.2"/></svg>`;

  btn.addEventListener('click', () => {
    if (isScreenOpen()) {
      window.screenController?.minimize('terminal');
      btn.classList.remove('active');
    } else {
      window.screenController?.open('terminal');
      btn.classList.add('active');
      document.dispatchEvent(new CustomEvent('vt-btn-activated', { detail: { id: 'terminal' } }));
    }
  });

  document.addEventListener('vt-btn-activated', ({ detail: { id } }) => {
    if (id !== 'terminal') btn.classList.remove('active');
  });
  document.addEventListener('screen-closed',    ({ detail }) => { if (detail.id === 'terminal') btn.classList.remove('active'); });
  document.addEventListener('screen-minimized', ({ detail }) => { if (detail.id === 'terminal') btn.classList.remove('active'); });

  vtTop.appendChild(btn);
  return { 'gen-terminal': btn };
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
    if (detail?.id === 'terminal') {
      switchView('gen-terminal');
      recordRecentItem({ id: 'generative', name: 'ARIA 智能助手', type: 'generative', screenId: 'terminal' });
    }
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

  // ── Handle cloud file injection from file manager ──────────────────────────
  document.addEventListener('dp-send-to-aria', async (e) => {
    const { filename, data, varName } = e.detail;
    if (!filename || !data) return;
    try {
      const ext = filename.split('.').pop().toLowerCase();
      const fileFormat = ['csv', 'json', 'xlsx', 'xls', 'xml']
        .includes(ext) ? ext : 'csv';

      // Inject file data into Python kernel
      const resolvedVarName = varName || filename.replace(/\.[^/.]+$/, '')
        .replace(/[^a-zA-Z0-9_]/g, '_') || 'df';
      if (window.injectDataFrame) {
        await window.injectDataFrame(
          resolvedVarName,
          data instanceof Uint8Array ? data : new Uint8Array(data),
          fileFormat,
          filename
        );
      }
      // Open ARIA screen and dispatch dataset selection
      const state = window.screenController?.getState('terminal');
      if (state !== 'normal' && state !== 'maximized') {
        window.screenController?.open('terminal');
      }
      switchView('gen-terminal');
      // 解析CSV写入dataset_store让ARIA能访问数据
      if (ext === 'csv') {
        const text = new TextDecoder('utf-8').decode(
          data instanceof Uint8Array ? data : new Uint8Array(data)
        );
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length > 0) {
          const cols = lines[0].split(',').map(c => c.trim().replace(/^"|"$/g,''));
          const rows = lines.slice(1).filter(l => l.trim()).map(line => {
            const vals = line.split(',');
            return Object.fromEntries(cols.map((c,i) => [c, vals[i]?.trim() ?? '']));
          });
          const { setDataset } = await import('../../shared/dataset_store.js');
          setDataset({ name: filename, columns: cols, dtypes: {}, rows });
        }
      } else {
        const { setDataset } = await import('../../shared/dataset_store.js');
        setDataset({ name: filename, columns: [], dtypes: {}, rows: [] });
      }
      // Signal ARIA to select this dataset
      document.dispatchEvent(new CustomEvent('aria-select-dataset', {
        detail: { varName: resolvedVarName, filename }
      }));

      // Fallback for selector-based implementations
      const select = document.querySelector('.aria-dataset-select');
      if (select) {
        select.value = resolvedVarName;
        select.dispatchEvent(new Event('change'));
      }
    } catch (err) {
      console.error('[dp-send-to-aria]', err);
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupGenerativeScreen);
} else {
  setupGenerativeScreen();
}
