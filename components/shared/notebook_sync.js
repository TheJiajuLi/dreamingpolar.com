// ── Notebook Cloud Sync ───────────────────────────────────────────────────────
// Debounced auto-save (3s) + Ctrl+S manual save.
// Cloud is an extra persistence layer; existing localStorage logic is unchanged.

const AUTH_BASE   = 'https://api.dreamingpolar.com';
let _notebookId   = null;
let _syncTimer    = null;
let _lastCompilerStatus = null;
const DEBOUNCE_MS = 3000;

// ── Internal helpers ──────────────────────────────────────────────────────────

function _fetch(path, opts = {}) {
  return window.authClient?.authedFetch(AUTH_BASE + path, opts);
}

function _showStatus(msg, isError = false) {
  // Snapshot current compiler status so we can restore it
  document.dispatchEvent(new CustomEvent('compiler-status', {
    detail: { status: isError ? 'error' : 'ready', message: msg }
  }));
  setTimeout(() => {
    // Restore last known compiler state (or clear to idle)
    if (_lastCompilerStatus) {
      document.dispatchEvent(new CustomEvent('compiler-status', {
        detail: _lastCompilerStatus
      }));
    }
  }, 2000);
}

// Track the compiler's own status so we can restore after showing sync msg
document.addEventListener('compiler-status', ({ detail }) => {
  // Don't snapshot our own sync messages
  if (detail.message?.startsWith('☁') || detail.message?.startsWith('⚠')) return;
  _lastCompilerStatus = detail;
});

// ── Public API ────────────────────────────────────────────────────────────────

/** Called once after login. Fetches or creates the default notebook, then restores cells. */
export async function initSync() {
  if (!window.authClient?.isLoggedIn()) return;
  try {
    const res = await _fetch('/auth/notebooks');
    if (!res?.ok) return;
    const list = await res.json();

    if (Array.isArray(list) && list.length > 0) {
      _notebookId = list[0].id;
      await _restoreFromCloud();
    } else {
      const r = await _fetch('/auth/notebooks', {
        method: 'POST',
        body: JSON.stringify({ name: 'My Notebook' }),
      });
      if (!r?.ok) return;
      const nb = await r.json();
      _notebookId = nb.id;
    }
  } catch (e) {
    console.warn('[notebook-sync] initSync failed:', e.message);
  }
}

async function _restoreFromCloud() {
  if (!_notebookId) return;
  try {
    const res = await _fetch(`/auth/notebooks/${_notebookId}/cells`);
    if (!res?.ok) return;
    const cells = await res.json();
    if (!Array.isArray(cells) || !cells.length) return;
    document.dispatchEvent(new CustomEvent('dp-cloud-restore', { detail: { cells } }));
  } catch (e) {
    console.warn('[notebook-sync] restore failed:', e.message);
  }
}

/** Push all cells to cloud. */
export async function syncToCloud(cells) {
  if (!_notebookId || !window.authClient?.isLoggedIn() || !_syncEnabled()) return;
  try {
    const payloadCells = Array.isArray(cells)
      ? cells
      : [...document.querySelectorAll('.nb-cell[data-nb-id]')].map((el, i) => ({
          id:          el.dataset.nbId,
          order_index: i,
          language:    el.querySelector('.nb-lang-select')?.value ?? 'python',
          code:        el.querySelector('.nb-editor')?.value ?? '',
        }));

    // 不允许用空 cells 覆盖云端有内容的版本
    const hasContent = payloadCells.some(c => c.code?.trim());
    if (!hasContent) {
      console.warn('[sync] 跳过同步——所有cell都是空的');
      return;
    }

    const res = await _fetch(`/auth/notebooks/${_notebookId}/cells`, {
      method: 'PUT',
      body:   JSON.stringify({ cells: payloadCells }),
    });

    if (res?.ok) {
      _showStatus('☁ 已同步');
    } else {
      _showStatus('⚠ 同步失败，将在下次重试', true);
    }
  } catch (e) {
    console.warn('[notebook-sync] syncToCloud failed:', e.message);
    _showStatus('⚠ 同步失败，将在下次重试', true);
  }
}

function _syncEnabled() {
  try {
    const s = JSON.parse(localStorage.getItem('dp-settings') ?? '{}');
    return s.cloudSyncEnabled !== false; // default true
  } catch { return true; }
}

/** Schedule a debounced cloud sync (called on every editor input). */
export function scheduleSave() {
  if (!window.authClient?.isLoggedIn() || !_notebookId || !_syncEnabled()) return;
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(syncToCloud, DEBOUNCE_MS);
}

window._dpSync = { initSync, syncToCloud, scheduleSave };
