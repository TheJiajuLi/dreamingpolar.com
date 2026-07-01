// ── Shared Nudge Banner — 提示符 ──────────────────────────────────────────────
// Reusable upgrade / permission / quota nudge bar.
//
// Usage:
//   import { createNudgeBanner } from '/components/shared/nudge_banner/nudge_banner.js';
//   const banner = createNudgeBanner({ id: 'grid-row-limit', content: '<strong>…</strong>' });
//   if (banner) container.prepend(banner);
//
// id       — unique key used for snooze/dismiss storage (no spaces)
// content  — HTML string for the left-side message area
//
// "稍后提示" → snoozes for 30 min (localStorage); banner returns null until timer expires
// "×"       → dismisses for the session (sessionStorage)

const _SNOOZE_MS = 30 * 60 * 1000;

// ── Inject CSS once ───────────────────────────────────────────────────────────
if (!document.getElementById('dp-nudge-banner-css')) {
  const style = document.createElement('style');
  style.id = 'dp-nudge-banner-css';
  style.textContent = `
.g-nudge-content {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.g-nudge-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: 12px;
  flex-shrink: 0;
}
.g-nudge-snooze {
  padding: 2px 8px;
  border: 1px solid rgba(251,191,36,0.4);
  border-radius: 5px;
  background: rgba(251,191,36,0.10);
  color: var(--text, #0f172a);
  font-size: 0.68rem;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
  transition: background .12s;
}
.g-nudge-snooze:hover { background: rgba(251,191,36,0.20); }
.g-nudge-close {
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 50%;
  background: rgba(0,0,0,0.07);
  color: var(--text-muted, #64748b);
  font-size: 11px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  padding: 0;
  font-family: inherit;
  transition: background .12s;
}
.g-nudge-close:hover { background: rgba(0,0,0,0.14); }
`;
  document.head.appendChild(style);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns a .g-pro-banner element with snooze + close controls, or null if
 * the banner is currently snoozed or dismissed for this session.
 *
 * @param {{ id: string, content: string }} opts
 * @returns {HTMLDivElement|null}
 */
export function createNudgeBanner({ id, content }) {
  if (!shouldShowNudge(id)) return null;

  const el = document.createElement('div');
  el.className = 'g-pro-banner';
  el.innerHTML =
    `<span class="g-nudge-content">${content}</span>` +
    `<span class="g-nudge-actions">` +
      `<button class="g-nudge-snooze">稍后提示</button>` +
      `<button class="g-nudge-close" title="关闭">✕</button>` +
    `</span>`;

  el.querySelector('.g-nudge-snooze').addEventListener('click', () => {
    localStorage.setItem(`dp-nudge-snooze-${id}`, String(Date.now() + _SNOOZE_MS));
    el.remove();
  });
  el.querySelector('.g-nudge-close').addEventListener('click', () => {
    sessionStorage.setItem(`dp-nudge-dismissed-${id}`, '1');
    el.remove();
  });

  return el;
}

/**
 * Returns true if the nudge should be shown (not dismissed this session,
 * not currently snoozed).
 */
export function shouldShowNudge(id) {
  if (sessionStorage.getItem(`dp-nudge-dismissed-${id}`)) return false;
  const snoozeUntil = Number(localStorage.getItem(`dp-nudge-snooze-${id}`) ?? 0);
  return Date.now() >= snoozeUntil;
}
