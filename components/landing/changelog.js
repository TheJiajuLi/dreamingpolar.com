// ── Changelog Page ────────────────────────────────────────────────────────────
const RELEASES_URL = '/content_pages/releases/releases.json';

async function loadReleases() {
  try {
    const r = await fetch(RELEASES_URL);
    return await r.json();
  } catch {
    return { current: {}, changelog: [] };
  }
}

function renderChangelog(data) {
  const { changelog } = data;
  const container = document.getElementById('cl-list');

  if (!changelog.length) {
    container.innerHTML = '<p style="color:#94a3b8;text-align:center">暂无更新记录</p>';
    return;
  }

  container.innerHTML = changelog.map(v => {
    const items = v.items.map(item => {
      const tagClass = { new:'cl-tag-new', improve:'cl-tag-improve', fix:'cl-tag-fix' }[item.type] ?? 'cl-tag-fix';
      const tagLabel = { new:'新功能', improve:'优化', fix:'修复' }[item.type] ?? item.type;
      return `<li class="cl-item">
        <span class="cl-tag ${tagClass}">${tagLabel}</span>
        <span class="cl-item-text">${item.text}</span>
      </li>`;
    }).join('');

    return `<section class="cl-version">
      <div class="cl-version-header">
        <div>
          <span class="cl-ver-num">v${v.version}</span>
          <span class="cl-highlights">${v.highlights}</span>
        </div>
        <span class="cl-date">${v.date}</span>
      </div>
      <ul class="cl-items">${items}</ul>
    </section>`;
  }).join('');
}

document.addEventListener('DOMContentLoaded', async () => {
  const data = await loadReleases();
  const { current } = data;
  const verEl = document.getElementById('cl-current-ver');
  if (verEl) verEl.textContent = `Dreaming Polar v${current.app}  ·  最新发布：${current.released}`;
  renderChangelog(data);
});
