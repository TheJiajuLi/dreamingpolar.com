// ── Activity Logger — localStorage-backed, no backend ────────────────────────
const ACTIVITY_LOG_KEY    = 'dp-activity-log';    // { "2026-06-27": 5, ... }
const ACTIVITY_EVENTS_KEY = 'dp-activity-events'; // [{ type, desc, time }, ...]

export function logActivity(type, desc) {
  const today = new Date().toISOString().slice(0, 10);

  // Update heatmap count (run type only)
  if (type === 'run') {
    try {
      const log = JSON.parse(localStorage.getItem(ACTIVITY_LOG_KEY) ?? '{}');
      log[today] = (log[today] ?? 0) + 1;
      localStorage.setItem(ACTIVITY_LOG_KEY, JSON.stringify(log));
    } catch (_) {}
  }

  // Prepend event (keep latest 100)
  try {
    const events = JSON.parse(localStorage.getItem(ACTIVITY_EVENTS_KEY) ?? '[]');
    events.unshift({ type, desc, time: Date.now() });
    localStorage.setItem(ACTIVITY_EVENTS_KEY, JSON.stringify(events.slice(0, 100)));
  } catch (_) {}
}

// Also expose globally for non-module contexts
window._dpLogActivity = logActivity;
