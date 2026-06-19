const screens = new Map();   // id → { el, state, label, onStateChange }
const LAYOUT  = () => document.getElementById('page-layout');
const PERSIST_PREFIX = 'dp-screen-';

const ICON_RESTORE = `<svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6.5a4.5 4.5 0 1 0 .85-2.6"/><path d="M2 1.5v3h3"/></svg>`;

function applyState(id) {
  const entry = screens.get(id);
  if (!entry) return;
  entry.el.dataset.screenState = entry.state;
  entry.onStateChange?.(entry.state);
}

function showRestoreChip(id) {
  const header = document.querySelector('header.page-header');
  if (!header) return;
  if (header.querySelector(`.sc-restore-chip[data-restore-id="${id}"]`)) return;

  const label = screens.get(id)?.label ?? id;
  const chip  = document.createElement('button');
  chip.className       = 'sc-restore-chip';
  chip.dataset.restoreId = id;
  chip.title           = `Restore ${label}`;
  chip.innerHTML       = `${ICON_RESTORE}<span>${label}</span>`;
  chip.addEventListener('click', () => screenController.restore(id));

  const menuBtn = header.querySelector('#navigation-button');
  menuBtn
    ? header.insertBefore(chip, menuBtn.nextSibling)
    : header.appendChild(chip);
}

function hideRestoreChip(id) {
  document.querySelector(`.sc-restore-chip[data-restore-id="${id}"]`)?.remove();
}

function _persist(id, openOrClosed) {
  try { localStorage.setItem(PERSIST_PREFIX + id, openOrClosed); } catch (_) {}
}

const screenController = {

  // persisted: true  → reads localStorage to restore open/closed across refreshes.
  // defaultOpen: true → falls back to open when no saved state exists.
  // Screens without persisted:true always start as 'normal'.
  register(id, el, { onStateChange, label, persisted = false, defaultOpen = false, noChip = false, group = null } = {}) {
    let initialState = defaultOpen ? 'normal' : 'closed';
    if (persisted) {
      const saved = localStorage.getItem(PERSIST_PREFIX + id);
      if (saved === 'open')   initialState = 'normal';
      else if (saved === 'closed') initialState = 'closed';
      // else: no saved state → use defaultOpen
    }
    screens.set(id, { el, state: initialState, onStateChange, label: label || id, noChip, group });
    el.dataset.screenId    = id;
    el.dataset.screenState = initialState;
    onStateChange?.(initialState);
  },

  maximize(id) {
    screens.forEach((entry, eid) => {
      if (eid !== id && entry.state === 'normal') {
        entry.state = 'hidden-by-max';
        applyState(eid);
      }
    });
    const entry = screens.get(id);
    if (entry) {
      entry.state = 'maximized';
      applyState(id);
    }
    LAYOUT()?.setAttribute('data-has-maximized', '');
  },

  minimize(id) {
    const entry = screens.get(id);
    if (!entry) return;
    const wasMaximized = entry.state === 'maximized';
    entry.state = 'minimized';
    applyState(id);
    if (wasMaximized) screenController._clearMax(id);
    if (!entry.noChip) showRestoreChip(id);
    _persist(id, 'closed');
    document.dispatchEvent(new CustomEvent('screen-minimized', { detail: { id } }));
  },

  restore(id) {
    const entry = screens.get(id);
    if (!entry) return;
    const wasMaximized = entry.state === 'maximized';
    entry.state = 'normal';
    applyState(id);
    if (wasMaximized) screenController._clearMax(id);
    hideRestoreChip(id);
    _persist(id, 'open');
  },

  // Open a persistently-closed screen. No restore chip.
  open(id) {
    const entry = screens.get(id);
    if (!entry) return;
    if (entry.group) screenController._closeGroup(entry.group, id);
    entry.state = 'normal';
    applyState(id);
    hideRestoreChip(id);
    _persist(id, 'open');
    document.dispatchEvent(new CustomEvent('screen-opened', { detail: { id } }));
  },

  // Hide a screen persistently. No restore chip — the screen's own toggle opens it again.
  close(id) {
    const entry = screens.get(id);
    if (!entry) return;
    const wasMaximized = entry.state === 'maximized';
    entry.state = 'closed';
    applyState(id);
    if (wasMaximized) screenController._clearMax(id);
    hideRestoreChip(id);
    _persist(id, 'closed');
    document.dispatchEvent(new CustomEvent('screen-closed', { detail: { id } }));
  },

  // Close every screen except id. Used by toggle buttons to give each screen exclusive focus.
  closeOthers(id) {
    screens.forEach((entry, eid) => {
      if (eid === id || entry.state === 'closed') return;
      const wasMaximized = entry.state === 'maximized';
      entry.state = 'closed';
      applyState(eid);
      if (wasMaximized) screenController._clearMax(eid);
      hideRestoreChip(eid);
      _persist(eid, 'closed');
      document.dispatchEvent(new CustomEvent('screen-closed', { detail: { id: eid } }));
    });
  },

  // Maximize ↔ normal only. Minimize is always a separate action.
  toggle(id) {
    const state = screens.get(id)?.state ?? 'normal';
    if (state === 'maximized') return screenController.restore(id);
    return screenController.maximize(id);
  },

  getState(id) {
    return screens.get(id)?.state ?? null;
  },

  // Bring a screen into view regardless of why it's hidden.
  ensureVisible(id) {
    const state = this.getState(id);
    if (state === 'minimized') {
      this.restore(id);
    } else if (state === 'closed') {
      this.open(id);
    } else if (state === 'hidden-by-max') {
      for (const [eid, entry] of screens) {
        if (entry.state === 'maximized') { this.restore(eid); break; }
      }
    }
  },

  _clearMax(exceptId) {
    screens.forEach((entry, eid) => {
      if (eid !== exceptId && entry.state === 'hidden-by-max') {
        entry.state = 'normal';
        applyState(eid);
      }
    });
    LAYOUT()?.removeAttribute('data-has-maximized');
  },

  _closeGroup(group, exceptId) {
    screens.forEach((entry, eid) => {
      if (eid === exceptId || entry.group !== group || entry.state === 'closed') return;
      const wasMax = entry.state === 'maximized';
      entry.state = 'closed';
      applyState(eid);
      if (wasMax) screenController._clearMax(eid);
      hideRestoreChip(eid);
      _persist(eid, 'closed');
      document.dispatchEvent(new CustomEvent('screen-closed', { detail: { id: eid } }));
    });
  },
};

window.screenController = screenController;
export default screenController;
