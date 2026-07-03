// ── Dreaming Polar Landing Page ───────────────────────────────────────────────
// Fetches releases.json → renders hero, features, compare table, version info.
// Redirect to /app if user was previously logged in (dp-auth-user in localStorage).

const RELEASES_URL = '/content_pages/releases/releases.json';

// Redirect logged-in users directly to the app
(function checkAuth() {
  try {
    const cached = window.dpAuthStore?.loadUserCache?.();
    if (cached?.email) {
      window.location.replace('/app');
      return;
    }
  } catch (_) {}
})();

// ── Data fetch ────────────────────────────────────────────────────────────────
async function loadReleases() {
  try {
    const r = await fetch(RELEASES_URL);
    return await r.json();
  } catch {
    return {
      current: { app: '—', aria: '—', notebook: '—', grid: '—', released: '—' },
      changelog: [],
    };
  }
}

// ── Render ────────────────────────────────────────────────────────────────────
function render(data) {
  const { current, changelog } = data;
  const latest = changelog[0] ?? { items: [] };
  const preview = latest.items.slice(0, 3);

  document.getElementById('lp-app-version').textContent  = `v${current.app}`;
  document.getElementById('lp-released').textContent     = current.released;
  document.getElementById('lp-version-main').textContent = `Dreaming Polar ${current.app}`;
  document.getElementById('lp-version-sub').textContent  =
    `${current.aria}  ·  ${current.notebook}  ·  ${current.grid}`;

  // Recent updates preview
  const list = document.getElementById('lp-updates-list');
  list.innerHTML = preview.map(item => {
    const tagClass = { new:'lp-tag-new', improve:'lp-tag-improve', fix:'lp-tag-fix' }[item.type] ?? 'lp-tag-fix';
    const tagLabel = { new:'新功能', improve:'优化', fix:'修复' }[item.type] ?? item.type;
    return `<div class="lp-update-item">
      <span class="lp-update-tag ${tagClass}">${tagLabel}</span>
      <span>${item.text}</span>
    </div>`;
  }).join('');
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const data = await loadReleases();
  render(data);
});
