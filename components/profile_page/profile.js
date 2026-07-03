import { initAuth } from '/components/auth/auth_client.js';

initAuth().catch(() => {});

    const username = new URLSearchParams(location.search).get('username')
      ?? location.pathname.split('/community/user/')[1];
    if (!username) location.href = '/community';

    const state = {
      username: decodeURIComponent(username),
      profile: null,
      tutorials: {
        published: [],
        favorites: [],
        likes: [],
      },
      currentTab: 'published',
      me: null,
    };

    const els = {
      topAvatar: document.getElementById('top-avatar'),
      profileAvatar: document.getElementById('profile-avatar'),
      profileName: document.getElementById('profile-name'),
      profileHandle: document.getElementById('profile-handle'),
      profileBio: document.getElementById('profile-bio'),
      statTutorials: document.getElementById('stat-tutorials'),
      statLikes: document.getElementById('stat-likes'),
      statViews: document.getElementById('stat-views'),
      followGroup: document.getElementById('follow-group'),
      skillTags: document.getElementById('skill-tags'),
      tabs: document.getElementById('tabs'),
      list: document.getElementById('list'),
      state: document.getElementById('state'),
    };

    function esc(s) {
      return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function initials(name) {
      const v = String(name || '?').trim();
      return (v.slice(0, 2) || '?').toUpperCase();
    }

    function toNum(v) {
      const n = Number(v ?? 0);
      return Number.isFinite(n) ? n : 0;
    }

    function firstText(...values) {
      for (const v of values) {
        const s = String(v ?? '').trim();
        if (s) return s;
      }
      return '';
    }

    function formatNum(v) {
      const n = toNum(v);
      if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
      return String(n);
    }

    function formatDate(v) {
      if (!v) return '刚刚';
      const d = new Date(typeof v === 'number' && v < 1e12 ? v * 1000 : v);
      if (Number.isNaN(d.getTime())) return '刚刚';
      const diff = Date.now() - d.getTime();
      const day = Math.floor(diff / 86400000);
      if (day <= 0) return '今天';
      if (day < 30) return `${day}天前`;
      const mon = Math.floor(day / 30);
      if (mon < 12) return `${mon}月前`;
      return `${Math.floor(mon / 12)}年前`;
    }

    function tutorialId(t) {
      return String(t.id || t.tutorial_id || t._id || '');
    }

    function tutorialTitle(t) {
      return t.title || t.name || '未命名教程';
    }

    function tutorialSummary(t) {
      return t.summary || t.excerpt || t.description || '暂无摘要';
    }

    function tutorialCover(t) {
      return t.cover_url || t.cover || t.coverUrl || t.cover_image || '';
    }

    function tutorialStatus(t) {
      return String(t?.status || '').toLowerCase();
    }

    function tutorialTags(t) {
      if (Array.isArray(t.tags)) return t.tags.filter(Boolean);
      if (typeof t.tags === 'string') return t.tags.split(',').map(x => x.trim()).filter(Boolean);
      return [];
    }

    function tutorialLikes(t) {
      return toNum(t.likes_count ?? t.likes);
    }

    function tutorialViews(t) {
      return toNum(t.views_count ?? t.views);
    }

    function showState(msg = '', show = false) {
      els.state.textContent = msg;
      els.state.style.display = show ? '' : 'none';
    }

    function getProfileFromTutorial(t) {
      return {
        username: t.author_username || t.username || t.author?.username || state.username,
        name: t.author_name || t.author?.name || t.author_username || t.username || state.username,
        avatar: firstText(
          t.author_avatar,
          t.author_avatar_url,
          t.avatar,
          t.avatar_url,
          t.avatarUrl,
          t.author?.avatar,
          t.author?.avatar_url,
          t.author?.avatarUrl,
          t.author?.photo,
          t.author?.photo_url,
          t.author?.image
        ),
        bio: t.author_bio || t.author?.bio || '',
      };
    }

    async function fetchJson(url) {
      const res = await fetch(url, { credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || `请求失败: ${res.status}`);
      return data;
    }

    function normalizeList(data) {
      if (Array.isArray(data)) return data;
      if (Array.isArray(data?.items)) return data.items;
      if (Array.isArray(data?.tutorials)) return data.tutorials;
      if (Array.isArray(data?.data)) return data.data;
      return [];
    }

    async function loadPublishedTutorials() {
      const data = await fetchJson(`https://api.dreamingpolar.com/auth/tutorials?author=${encodeURIComponent(state.username)}&status=published`);
      state.tutorials.published = normalizeList(data);
      return state.tutorials.published;
    }

    async function loadProfileFromApi() {
      try {
        const data = await fetchJson(`https://api.dreamingpolar.com/auth/users/${encodeURIComponent(state.username)}`);
        const user = data?.user || data?.data || data;
        if (!user) throw new Error('empty');
        state.profile = {
          username: user.username || state.username,
          name: firstText(user.name, user.display_name, user.nickname, user.username, state.username),
          avatar: firstText(
            user.avatar,
            user.avatar_url,
            user.avatarUrl,
            user.profile_image,
            user.profile_image_url,
            user.profileImage,
            user.photo,
            user.photo_url,
            user.image
          ),
          bio: user.bio || '',
        };
      } catch (_) {
        const first = state.tutorials.published[0] || null;
        state.profile = first ? getProfileFromTutorial(first) : {
          username: state.username,
          name: state.username,
          avatar: '',
          bio: '',
        };
      }
    }

    async function loadOptionalTab(tab) {
      const plans = {
        favorites: [
          `https://api.dreamingpolar.com/auth/tutorials?favorited_by=${encodeURIComponent(state.username)}`,
          `https://api.dreamingpolar.com/auth/users/${encodeURIComponent(state.username)}/favorites`,
        ],
        likes: [
          `https://api.dreamingpolar.com/auth/tutorials?liked_by=${encodeURIComponent(state.username)}`,
          `https://api.dreamingpolar.com/auth/users/${encodeURIComponent(state.username)}/likes`,
        ],
      };

      const urls = plans[tab] || [];
      for (const url of urls) {
        try {
          const data = await fetchJson(url);
          state.tutorials[tab] = normalizeList(data);
          return;
        } catch (_) {}
      }
      state.tutorials[tab] = [];
    }

    function loadMeFromCache() {
      try {
        const u = JSON.parse(localStorage.getItem('dp-auth-user') || 'null');
        if (u && u.username) state.me = u;
      } catch (_) {}
    }

    function renderTopAvatar() {
      let username = '';
      try {
        username = window.authClient?.getUser?.()?.username
          ?? JSON.parse(localStorage.getItem('dp-auth-user') || '{}')?.username
          ?? '';
      } catch (_) {}

      if (username) {
        els.topAvatar.href = `/profile?username=${encodeURIComponent(username)}`;
        els.topAvatar.onclick = null;
      } else {
        els.topAvatar.href = '/';
      }

      const meAvatar = firstText(state.me?.avatar, state.me?.avatar_url, state.me?.avatarUrl, state.me?.photo, state.me?.image);
      if (meAvatar) {
        els.topAvatar.innerHTML = `<img src="${esc(meAvatar)}" alt="${esc(state.me?.username || username)}">`;
      } else {
        const text = state.me?.username ? initials(state.me.username) : (username ? initials(username) : '我');
        els.topAvatar.textContent = text;
      }
    }

    function calcStats(list) {
      const tutorials = list.length;
      const likes = list.reduce((sum, t) => sum + tutorialLikes(t), 0);
      const views = list.reduce((sum, t) => sum + tutorialViews(t), 0);
      return { tutorials, likes, views };
    }

    function calcSkills(list) {
      const map = new Map();
      list.forEach((t) => {
        tutorialTags(t).forEach((tag) => {
          map.set(tag, (map.get(tag) || 0) + 1);
        });
      });
      return [...map.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([name]) => name);
    }

    function renderSidebar() {
      const p = state.profile || { username: state.username, name: state.username, avatar: '', bio: '' };
      const isSelf = state.me?.username && state.me.username === (p.username || state.username);
      const displayAvatar = firstText(p.avatar, isSelf ? firstText(state.me?.avatar, state.me?.avatar_url, state.me?.avatarUrl, state.me?.photo, state.me?.image) : '');

      if (displayAvatar) {
        els.profileAvatar.innerHTML = `<img src="${esc(displayAvatar)}" alt="${esc(p.name)}">`;
      } else {
        els.profileAvatar.textContent = initials(p.name);
      }
      els.profileName.textContent = p.name || state.username;
      els.profileHandle.textContent = `@${p.username || state.username}`;
      els.profileBio.textContent = p.bio || '这个人很神秘，还没有填写简介。';

      const stats = calcStats(state.tutorials.published);
      els.statTutorials.textContent = formatNum(stats.tutorials);
      els.statLikes.textContent = formatNum(stats.likes);
      els.statViews.textContent = formatNum(stats.views);

      els.followGroup.style.display = isSelf ? 'none' : '';

      const skills = calcSkills(state.tutorials.published);
      if (!skills.length) {
        els.skillTags.innerHTML = '<span class="tag">暂无</span>';
      } else {
        els.skillTags.innerHTML = skills.map((tag) => `<span class="tag">${esc(tag)}</span>`).join('');
      }
    }

    function cardHtml(t) {
      const title = tutorialTitle(t);
      const summary = tutorialSummary(t);
      const tags = tutorialTags(t).slice(0, 3);
      const likes = tutorialLikes(t);
      const views = tutorialViews(t);
      const time = formatDate(t.published_at || t.created_at || t.updated_at || Date.now());
      const cover = tutorialCover(t);
      const id = tutorialId(t);
      const href = id ? `/tutorial?id=${encodeURIComponent(id)}` : '/community';
      const p = state.profile || { username: state.username };
      const isSelf = state.me?.username && state.me.username === (p.username || state.username);
      const canDelete = isSelf && state.currentTab === 'published' && tutorialStatus(t) !== 'deleted';

      return `
        <article class="card" data-id="${esc(id)}" data-href="${href}">
          ${canDelete ? '<button class="card-delete-btn" type="button" title="删除教程"><i class="ti ti-trash"></i></button>' : ''}
          <div class="card-cover">${cover ? `<img src="${esc(cover)}" alt="${esc(title)}">` : '<i class="ti ti-chart-line" style="font-size:36px;"></i>'}</div>
          <div class="card-body">
            <div class="badge-row">${tags.length ? tags.map(tag => `<span class="badge">${esc(tag)}</span>`).join('') : '<span class="badge">未分类</span>'}</div>
            <h3 class="card-title">${esc(title)}</h3>
            <p class="card-summary">${esc(summary)}</p>
            <div class="card-meta">
              <span><i class="ti ti-heart"></i>${likes}</span>
              <span><i class="ti ti-eye"></i>${views}</span>
              <span><i class="ti ti-clock"></i>${esc(time)}</span>
            </div>
          </div>
        </article>
      `;
    }

    async function deleteTutorial(id) {
      if (!id) throw new Error('教程ID无效');
      const ok = confirm('确认删除这篇教程吗？删除后将无法恢复。');
      if (!ok) return false;

      let token = '';
      try {
        token = window.authClient?.getAccessToken?.() || '';
      } catch (_) {}
      if (!token) throw new Error('请先登录后再删除');

      const res = await fetch(`https://api.dreamingpolar.com/auth/tutorials/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || `删除失败: ${res.status}`);

      state.tutorials.published = (state.tutorials.published || []).filter((x) => tutorialId(x) !== id);
      renderSidebar();
      renderList();
      return true;
    }

    function emptyText(tab) {
      if (tab === 'favorites') return '暂无收藏教程';
      if (tab === 'likes') return '暂无点赞教程';
      return '这个用户还没有发布教程';
    }

    function renderList() {
      const list = state.tutorials[state.currentTab] || [];
      if (!list.length) {
        els.list.innerHTML = '';
        showState(emptyText(state.currentTab), true);
        return;
      }

      showState('', false);
      els.list.innerHTML = list.map(cardHtml).join('');
    }

    function bindTabs() {
      els.tabs.addEventListener('click', async (e) => {
        const btn = e.target.closest('.tab-btn[data-tab]');
        if (!btn) return;

        const tab = btn.dataset.tab;
        if (!tab || tab === state.currentTab) return;

        state.currentTab = tab;
        els.tabs.querySelectorAll('.tab-btn').forEach((x) => x.classList.toggle('active', x === btn));

        if (!state.tutorials[tab] || !state.tutorials[tab].length) {
          showState('加载中...', true);
          if (tab === 'published') {
            await loadPublishedTutorials().catch(() => {});
          } else {
            await loadOptionalTab(tab);
          }
        }
        renderList();
      });
    }

    function bindListActions() {
      els.list.addEventListener('click', async (e) => {
        const delBtn = e.target.closest('.card-delete-btn');
        if (delBtn) {
          e.preventDefault();
          e.stopPropagation();
          const card = delBtn.closest('.card[data-id]');
          if (!card) return;
          const id = card.dataset.id;
          try {
            await deleteTutorial(id);
          } catch (err) {
            alert(err.message || '删除失败');
          }
          return;
        }

        const card = e.target.closest('.card[data-href]');
        if (!card) return;
        const href = card.dataset.href;
        if (!href) return;
        location.href = href;
      });
    }

    async function boot() {
      bindTabs();
      bindListActions();
      loadMeFromCache();
      renderTopAvatar();
      showState('正在加载用户主页...', true);

      try {
        await loadPublishedTutorials();
        await loadProfileFromApi();
        renderSidebar();
        renderList();
      } catch (err) {
        showState(`加载失败：${err.message || '未知错误'}`, true);
      }
    }

    boot();
