// ── Activity Logger — localStorage-backed, no backend ────────────────────────
import { loadScopedJson, saveScopedJson } from '../auth/auth_hooks.js';

const ACTIVITY_LOG_KEY    = 'dp-activity-log';    // { "2026-06-27": 5, ... }
const ACTIVITY_EVENTS_KEY = 'dp-activity-events'; // [{ type, desc, time }, ...]

export function logActivity(type, desc) {
  const today = new Date().toISOString().slice(0, 10);

  // Update heatmap count (run type only)
  if (type === 'run') {
    try {
      const log = loadScopedJson(ACTIVITY_LOG_KEY, {});
      log[today] = (log[today] ?? 0) + 1;
      saveScopedJson(ACTIVITY_LOG_KEY, log);
    } catch (_) {}
  }

  // Prepend event (keep latest 100)
  try {
    const events = loadScopedJson(ACTIVITY_EVENTS_KEY, []);
    events.unshift({ type, desc, time: Date.now() });
    saveScopedJson(ACTIVITY_EVENTS_KEY, events.slice(0, 100));
  } catch (_) {}
}

// Also expose globally for non-module contexts
window._dpLogActivity = logActivity;
