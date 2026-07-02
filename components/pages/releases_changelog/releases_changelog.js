
const TAG = { new: ['t-new','新功能'], improve: ['t-improve','优化'], fix: ['t-fix','修复'] };

fetch('/content_pages/releases/releases.json')
  .then(r => r.json())
  .then(data => {
    const c = data.current;

    document.getElementById('cur-ver').textContent =
      `Dreaming Polar v${c.app} · 最新发布：${c.released}`;

    document.getElementById('comp-vers').innerHTML = [
      c.aria, c.notebook, c.grid
    ].map(v => `<span class="comp-badge">${v}</span>`).join('');

    document.getElementById('cl-list').innerHTML = data.changelog.map(v => {
      const items = v.items.map(item => {
        const [cls, label] = TAG[item.type] ?? ['t-fix','修复'];
        return `<li class="item"><span class="itag ${cls}">${label}</span><span class="item-text">${item.text}</span></li>`;
      }).join('');
      return `<div class="cl-ver">
        <div class="cl-ver-hdr">
          <div><span class="ver-num">v${v.version}</span><span class="highlights">${v.highlights}</span></div>
          <span class="rel-date">${v.date}</span>
        </div>
        <ul class="items">${items}</ul>
      </div>`;
    }).join('');
  })
  .catch(() => {
    document.getElementById('cl-list').textContent = '暂时无法加载';
  });
