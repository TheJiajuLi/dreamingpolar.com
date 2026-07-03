
    const tutorialsState = {
      all: [],
      keyword: '',
      mode: 'all',
      tag: null,
      favs: new Set(),
    };

    function esc(s) {
      return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function formatDate(v) {
      if (!v) return '刚刚';
      const d = new Date(typeof v === 'number' && v < 1e12 ? v * 1000 : v);
      if (Number.isNaN(d.getTime())) return '刚刚';
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function toNum(v) {
      const n = Number(v ?? 0);
      return Number.isFinite(n) ? n : 0;
    }

    function tutorialCover(t) {
      return t.cover_image || t.cover_url || t.cover || t.coverUrl || '';
    }

    function tutorialTitle(t) {
      return t.title || t.name || '未命名教程';
    }

    function tutorialSummary(t) {
      return t.summary || t.excerpt || t.description || '暂无摘要';
    }

    function tutorialTags(t) {
      if (Array.isArray(t.tags)) return t.tags;
      if (typeof t.tags === 'string') return t.tags.split(',').map(x => x.trim()).filter(Boolean);
      return [];
    }

    function tutorialAuthor(t) {
      return t.author_name || t.author?.name || t.author_username || t.username || t.author?.username || '匿名作者';
    }

    function tutorialAuthorUsername(t) {
      return t.author_username || t.author?.username || t.username || '';
    }

    function tutorialAuthorAvatar(t) {
      return t.author_avatar || t.author_avatar_url || t.avatar || t.avatar_url || t.author?.avatar || t.author?.avatar_url || '';
    }

    function tutorialId(t) {
      return String(t.id ?? t.tutorial_id ?? t.tutorialId ?? t._id ?? '');
    }

    function normalizeList(data) {
      if (Array.isArray(data)) return data;
      if (Array.isArray(data?.items)) return data.items;
      if (Array.isArray(data?.tutorials)) return data.tutorials;
      if (Array.isArray(data?.data)) return data.data;
      if (Array.isArray(data?.results)) return data.results;
      if (Array.isArray(data?.list)) return data.list;
      return [];
    }

    function isPublishedTutorial(t) {
      const status = String(t?.status ?? '').toLowerCase();
      if (status === 'published' || status === 'public') return true;
      if (status === 'draft' || status === 'private' || status === 'deleted' || status === 'archived') return false;
      if (status) return false;

      // Backward-compatible records without status: only show if they have publish timestamp.
      return true; // status未知时默认显示
    }

    function tutorialStats(t) {
      return {
        likes: toNum(t.likes_count ?? t.likes),
        views: toNum(t.views_count ?? t.views),
        ts: toNum(t.published_at ?? t.created_at ?? t.updated_at ?? Date.now()),
      };
    }

    function initials(name) {
      return String(name || '?').trim().slice(0, 2).toUpperCase() || '?';
    }

    function setState(msg, show) {
      const el = document.getElementById('state');
      el.textContent = msg || '';
      el.style.display = show ? '' : 'none';
    }

    function cardHtml(t) {
      const title = tutorialTitle(t);
      const summary = tutorialSummary(t);
      const tags = tutorialTags(t).slice(0, 5);
      const author = tutorialAuthor(t);
      const authorUsername = tutorialAuthorUsername(t);
      const avatar = tutorialAuthorAvatar(t);
      const cover = tutorialCover(t);
      const stats = tutorialStats(t);

      const badgeHtml = tags.length
        ? tags.map(tag => `<span class="badge">${esc(tag)}</span>`).join('')
        : '<span class="badge">未分类</span>';

      const avatarHtml = avatar
        ? `<span class="avatar"><img src="${esc(avatar)}" alt="${esc(author)}"></span>`
        : `<span class="avatar">${esc(initials(author))}</span>`;

      const authorLink = authorUsername
        ? `/profile?username=${encodeURIComponent(authorUsername)}`
        : '#';

      const tid = tutorialId(t);
      const tutorialLink = tid ? `/tutorial?id=${encodeURIComponent(tid)}` : '#';

      const coverHtml = cover
        ? `<img class="cover" src="${esc(cover)}" alt="${esc(title)}">`
        : '<div class="cover"></div>';

      return `
        <a class="card" href="${tutorialLink}">
          ${coverHtml}
          <div class="content">
            <h3 class="title">${esc(title)}</h3>
            <div class="author" onclick="event.preventDefault();event.stopPropagation();location.href='${authorLink}'">${avatarHtml}<span>${esc(author)}</span></div>
            <p class="summary">${esc(summary)}</p>
            <div class="badge-list">${badgeHtml}</div>
            <div class="meta">
              <span><i class="ti ti-heart"></i>${stats.likes}</span>
              <span><i class="ti ti-eye"></i>${stats.views}</span>
              <span><i class="ti ti-clock"></i>${formatDate(stats.ts)}</span>
            </div>
          </div>
        </a>
      `;
    }

    function applyFilters() {
      const k = tutorialsState.keyword.trim().toLowerCase();
      let items = [...tutorialsState.all];

      if (k) {
        items = items.filter(t => {
          const tags = tutorialTags(t).join(' ');
          const text = `${tutorialTitle(t)} ${tutorialSummary(t)} ${tutorialAuthor(t)} ${tags}`.toLowerCase();
          return text.includes(k);
        });
      }

      if (tutorialsState.tag) {
        items = items.filter(t => tutorialTags(t).some(tag => String(tag).toLowerCase() === tutorialsState.tag.toLowerCase()));
      }

      if (tutorialsState.mode === 'latest') {
        items.sort((a, b) => tutorialStats(b).ts - tutorialStats(a).ts);
      } else if (tutorialsState.mode === 'hot') {
        items.sort((a, b) => (tutorialStats(b).likes + tutorialStats(b).views) - (tutorialStats(a).likes + tutorialStats(a).views));
      } else if (tutorialsState.mode === 'favorites') {
        items = items.filter(t => tutorialsState.favs.has(tutorialId(t)));
      }

      const cards = document.getElementById('cards');
      if (!items.length) {
        cards.innerHTML = '';
        setState('暂无符合条件的教程', true);
        return;
      }

      setState('', false);
      cards.innerHTML = items.map(cardHtml).join('');
    }

    function setupUserArea() {
      let user = null;
      try { user = JSON.parse(localStorage.getItem('dp-auth-user') || 'null'); } catch (_) {}
      const loginBtn = document.getElementById('login-btn');
      const avatarBtn = document.getElementById('avatar-btn');

      let username = '';
      try {
        username = window.authClient?.getUser?.()?.username
          ?? JSON.parse(localStorage.getItem('dp-auth-user') || '{}')?.username
          ?? '';
      } catch (_) {}

      if (username) {
        avatarBtn.href = `/profile?username=${encodeURIComponent(username)}`;
        avatarBtn.onclick = null;
      } else {
        avatarBtn.href = '/';
      }

      if (user && user.username) {
        loginBtn.style.display = 'none';
        avatarBtn.style.display = '';
        avatarBtn.title = user.username;
        if (user.avatar) {
          avatarBtn.innerHTML = `<img src="${esc(user.avatar)}" alt="${esc(user.username)}" style="width:100%;height:100%;object-fit:cover;border-radius:999px;">`;
        } else {
          avatarBtn.textContent = initials(user.username);
        }
      }
    }

    function hasLoginSession() {
      if (window.authClient?.isLoggedIn?.()) return true;
      if (/(?:^|;\s*)(?:accessToken|dp_access)=/.test(document.cookie || '')) return true;
      return Boolean(
        localStorage.getItem('dp-access-token') ||
        localStorage.getItem('accessToken') ||
        localStorage.getItem('token') ||
        localStorage.getItem('dp-token')
      );
    }

    function bindFilters() {
      document.getElementById('main-filters').addEventListener('click', (e) => {
        const btn = e.target.closest('.pill[data-filter]');
        if (!btn) return;
        if (btn.dataset.filter === 'favorites' && !hasLoginSession()) {
          alert('请先登录查看收藏');
          return;
        }
        tutorialsState.mode = btn.dataset.filter;
        document.querySelectorAll('#main-filters .pill').forEach(x => x.classList.toggle('active', x === btn));
        applyFilters();
      });

      document.getElementById('tag-filters').addEventListener('click', (e) => {
        const btn = e.target.closest('.tag[data-tag]');
        if (!btn) return;
        const selected = btn.dataset.tag;
        tutorialsState.tag = tutorialsState.tag === selected ? null : selected;
        document.querySelectorAll('#tag-filters .tag').forEach(x => x.classList.toggle('active', x === btn && tutorialsState.tag === selected));
        applyFilters();
      });

      document.getElementById('search-input').addEventListener('input', (e) => {
        tutorialsState.keyword = e.target.value || '';
        applyFilters();
      });
    }

    async function loadTutorials() {
      setState('正在加载社区教程...', true);
      const urls = [
        'https://api.dreamingpolar.com/auth/tutorials?status=published',
        'https://api.dreamingpolar.com/auth/tutorials?status=published&limit=100',
        'https://api.dreamingpolar.com/auth/tutorials',
      ];
      try {
        let list = [];
        for (const url of urls) {
          const resp = await fetch(url, { credentials: 'include' });
          if (!resp.ok) continue;
          const data = await resp.json().catch(() => ({}));
          list = normalizeList(data);
          if (list.length) break;
        }
        tutorialsState.all = list.filter(isPublishedTutorial);
      } catch (err) {
        console.error('[community] load tutorials failed', err);
        tutorialsState.all = [];
      }
      applyFilters();
      if (!tutorialsState.all.length) setState('还没有可展示的已发布教程', true);
    }

    function loadFavorites() {
      try {
        const v = JSON.parse(localStorage.getItem('dp-favorite-tutorials') || '[]');
        tutorialsState.favs = new Set(Array.isArray(v) ? v.map(x => String(x)) : []);
      } catch (_) {
        tutorialsState.favs = new Set();
      }
    }

    setupUserArea();
    bindFilters();
    loadFavorites();
    loadTutorials();
  