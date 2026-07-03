    import { initAuth } from '/components/auth/auth_client.js';

    initAuth().then(() => {
      if (!window.authClient?.isLoggedIn()) {
        console.warn('[tutorial] 未登录，点赞/评论功能需要先登录');
      }
    });
    const API_BASE = 'https://api.dreamingpolar.com/auth';
    const id = new URLSearchParams(location.search).get('id')
      ?? location.pathname.split('/community/')[1];
    if (!id) location.href = '/community';

    const state = {
      tutorial: null,
      blocks: [],
      liked: false,
      likeCount: 0,
      comments: [],
      related: [],
      compiler: null,
      runningBlocks: new Set(),
      tokenCache: '',
    };

    const els = {
      title: document.getElementById('article-title'),
      summary: document.getElementById('article-summary'),
      meta: document.getElementById('article-meta'),
      cover: document.getElementById('article-cover'),
      content: document.getElementById('tutorial-content'),
      topAuthor: document.getElementById('top-author'),
      likeBtn: document.getElementById('like-btn'),
      likeBtnLabel: document.getElementById('like-btn-label'),
      favBtn: document.getElementById('fav-btn'),
      avatarBtn: document.getElementById('avatar-btn'),
      authorAvatar: document.getElementById('author-avatar'),
      authorName: document.getElementById('author-name'),
      authorRole: document.getElementById('author-role'),
      authorBio: document.getElementById('author-bio'),
      relatedList: document.getElementById('related-list'),
      commentInput: document.getElementById('comment-input'),
      commentSubmit: document.getElementById('comment-submit'),
      commentStatus: document.getElementById('comment-status'),
      commentList: document.getElementById('comment-list'),
    };

    function escapeHtml(value) {
      return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function text(value, fallback = '') {
      const s = String(value ?? '').trim();
      return s || fallback;
    }

    function firstText(...values) {
      for (const v of values) {
        const s = String(v ?? '').trim();
        if (s) return s;
      }
      return '';
    }

    function initials(name = '') {
      const normalized = String(name).trim();
      if (!normalized) return 'DP';
      const parts = normalized.split(/\s+/).filter(Boolean);
      if (parts.length > 1) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
      }
      return normalized.slice(0, 2).toUpperCase();
    }

    function formatTime(v) {
      if (!v) return '';
      const raw = Number(v);
      const normalized = Number.isFinite(raw) && raw < 1e12 ? raw * 1000 : v;
      const date = new Date(normalized);
      if (Number.isNaN(date.getTime())) return String(v);
      return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    }

    function getTokenFromCookie() {
      const m = document.cookie.match(/(?:^|;\s*)accessToken=([^;]+)/);
      return m ? decodeURIComponent(m[1]) : '';
    }

    function getDpAccessCookie() {
      const m = document.cookie.match(/(?:^|;\s*)dp_access=([^;]+)/);
      return m ? decodeURIComponent(m[1]) : '';
    }

    function getTokenFromLocalStorage() {
      try {
        const auth = JSON.parse(localStorage.getItem('dp_auth') || '{}');
        if (auth?.accessToken) return auth.accessToken;
      } catch (_) {}
      return localStorage.getItem('token') || '';
    }

    function getToken() {
      const fromClient = window.authClient?.getAccessToken?.();
      if (fromClient) return fromClient;
      if (state.tokenCache) return state.tokenCache;
      return getTokenFromCookie() || getDpAccessCookie() || getTokenFromLocalStorage();
    }

    async function ensureToken() {
      const token = getToken();
      if (token) {
        state.tokenCache = token;
        return token;
      }
      try {
        await fetch('https://api.dreamingpolar.com/auth/refresh', { method: 'POST', credentials: 'include' });
      } catch (_) {}
      const refreshed = getToken();
      if (refreshed) {
        state.tokenCache = refreshed;
        return refreshed;
      }
      throw new Error('请先登录');
    }

    async function request(url, options = {}) {
      const opts = {
        credentials: 'include',
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {}),
        },
      };

      if (!opts.skipAuth) {
        const token = getToken();
        if (token) opts.headers.Authorization = `Bearer ${token}`;
      }

      const res = await fetch(url, opts);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.message || `请求失败: ${res.status}`);
      }
      return data;
    }

    function normalizeBlocks(blocks) {
      if (!Array.isArray(blocks)) return [];
      return blocks.map((block) => {
        const code = block.code ?? block.content ?? '';
        return {
          ...block,
          type: block.type || 'text',
          content: block.content ?? '',
          code,
          language: block.language || 'python',
          executable: block.executable !== false,
          level: Number(block.level || 2),
          variant: block.variant || 'info',
          imageUrl: block.imageUrl || block.url || '',
          caption: block.caption || '',
        };
      });
    }

    function likeFlag(raw) {
      return Boolean(
        raw?.liked_by_me ||
        raw?.is_liked ||
        raw?.liked ||
        raw?.likedByMe ||
        raw?.viewer_has_liked
      );
    }

    function getLikeCount(raw) {
      const n = raw?.likes_count ?? raw?.like_count ?? raw?.likes ?? 0;
      return Number.isFinite(Number(n)) ? Number(n) : 0;
    }

    function authorOf(tutorial) {
      const a = tutorial?.author || tutorial?.user || tutorial?.creator || {};
      return {
        username: firstText(a.username, tutorial?.author_username, tutorial?.username),
        name: text(firstText(a.name, tutorial?.author_name, a.username, tutorial?.author_username, tutorial?.username), '匿名作者'),
        avatar: firstText(a.avatar, a.avatar_url, a.avatarUrl, a.photo, a.image, tutorial?.author_avatar, tutorial?.author_avatar_url, tutorial?.avatar, tutorial?.avatar_url),
        bio: text(firstText(a.bio, tutorial?.author_bio), '这位作者还没有填写简介。'),
        role: text(a.role || a.title || tutorial?.author_role, '创作者'),
        id: a.id || tutorial?.author_id || '',
      };
    }

    function renderTopAndSidebar() {
      const tutorial = state.tutorial || {};
      const author = authorOf(tutorial);
      const profileHref = author.username ? `/profile?username=${encodeURIComponent(author.username)}` : '#';

      els.title.textContent = text(tutorial.title, '未命名教程');
      els.summary.textContent = text(tutorial.summary, '');
      els.summary.style.display = els.summary.textContent ? '' : 'none';

      const tags = Array.isArray(tutorial.tags) ? tutorial.tags.filter(Boolean) : [];
      const metaBits = [
        text(tutorial.read_time || tutorial.reading_time, ''),
        formatTime(tutorial.published_at || tutorial.publishedAt || tutorial.created_at || tutorial.createdAt || tutorial.updated_at || tutorial.updatedAt),
      ].filter(Boolean);

      els.meta.innerHTML = `
        <a class="author-link" href="${profileHref}">
          <div class="avatar">${author.avatar ? `<img src="${escapeHtml(author.avatar)}" alt="${escapeHtml(author.name)}">` : escapeHtml(initials(author.name))}</div>
          <span>${escapeHtml(author.name)}</span>
        </a>
        ${metaBits.length ? `<span>·</span><span>${escapeHtml(metaBits.join(' · '))}</span>` : ''}
        ${tags.length ? `<span>·</span><span>${tags.map(t => `#${t}`).join(' ')}</span>` : ''}
      `;

      if (tutorial.cover_image) {
        els.cover.src = tutorial.cover_image;
        els.cover.style.display = '';
      } else {
        els.cover.style.display = 'none';
      }

      els.topAuthor.innerHTML = `
        <a class="author-link" href="${profileHref}">
          <div class="avatar">${author.avatar ? `<img src="${escapeHtml(author.avatar)}" alt="${escapeHtml(author.name)}">` : escapeHtml(initials(author.name))}</div>
          <span>${escapeHtml(author.name)}</span>
        </a>
      `;

      if (author.avatar) {
        els.authorAvatar.innerHTML = `<a class="author-link" href="${profileHref}"><img src="${escapeHtml(author.avatar)}" alt="${escapeHtml(author.name)}"></a>`;
      } else {
        els.authorAvatar.innerHTML = `<a class="author-link" href="${profileHref}">${escapeHtml(initials(author.name))}</a>`;
      }
      els.authorName.innerHTML = `<a class="author-link" href="${profileHref}">${escapeHtml(author.name)}</a>`;
      els.authorRole.textContent = author.role;
      els.authorBio.textContent = author.bio;

      renderLikeButton();
    }

    function headingLevel(v) {
      const n = Number(v || 2);
      return [2, 3, 4].includes(n) ? n : 2;
    }

    function iconByVariant(variant) {
      if (variant === 'tip') return 'bulb';
      if (variant === 'warning') return 'alert-triangle';
      return 'info-circle';
    }

    function blockHtml(block, index) {
      if (block.type === 'text') {
        return `<div class="tut-text">${marked.parse(block.content || '')}</div>`;
      }

      if (block.type === 'code') {
        const rawCode = block.code || block.content || '';
        return `
          <div class="tut-code" data-block-index="${index}">
            <div class="code-header">
              <span class="lang-badge">${escapeHtml(block.language || 'text')}</span>
              ${block.executable ? `<button class="run-btn" data-run-index="${index}">▶ 运行</button>` : ''}
            </div>
            <pre><code>${escapeHtml(rawCode)}</code></pre>
            <div class="code-output" data-output-index="${index}" style="display:none"></div>
          </div>
        `;
      }

      if (block.type === 'latex') {
        return `<div class="tut-latex">$$${escapeHtml(block.content || '')}$$</div>`;
      }

      if (block.type === 'heading') {
        const level = headingLevel(block.level);
        return `<h${level} class="tut-heading">${escapeHtml(block.content || '')}</h${level}>`;
      }

      if (block.type === 'image') {
        return `
          <figure class="tut-image">
            <img src="${escapeHtml(block.imageUrl || '')}" alt="${escapeHtml(block.caption || '')}">
            ${block.caption ? `<figcaption>${escapeHtml(block.caption)}</figcaption>` : ''}
          </figure>
        `;
      }

      if (block.type === 'callout') {
        const variant = ['tip', 'warning', 'info'].includes(block.variant) ? block.variant : 'info';
        return `
          <div class="tut-callout tut-callout--${variant}">
            <i class="ti ti-${iconByVariant(variant)}"></i>
            <span>${escapeHtml(block.content || '')}</span>
          </div>
        `;
      }

      return `<div class="tut-text">${escapeHtml(JSON.stringify(block))}</div>`;
    }

    function renderBlocks() {
      if (!state.blocks.length) {
        els.content.innerHTML = '<div class="empty-state">该教程还没有内容。</div>';
        return;
      }

      els.content.innerHTML = state.blocks.map((block, index) => blockHtml(block, index)).join('');

      if (window.MathJax?.typesetPromise) {
        window.MathJax.typesetPromise([els.content]).catch(() => {});
      }
    }

    function renderLikeButton() {
      els.likeBtn.classList.toggle('liked', state.liked);
      els.likeBtnLabel.textContent = state.liked ? `已点赞${state.likeCount ? ` · ${state.likeCount}` : ''}` : `点赞${state.likeCount ? ` · ${state.likeCount}` : ''}`;
      els.likeBtn.innerHTML = `${state.liked ? '<i class="ti ti-heart-filled"></i>' : '<i class="ti ti-heart"></i>'}<span id="like-btn-label">${escapeHtml(els.likeBtnLabel.textContent)}</span>`;
      els.likeBtnLabel = document.getElementById('like-btn-label');
    }

    function renderRelated() {
      if (!state.related.length) {
        els.relatedList.innerHTML = '<div class="empty-state">暂无相关教程。</div>';
        return;
      }

      els.relatedList.innerHTML = state.related.map((item) => {
        const title = text(item.title, '未命名教程');
        const author = authorOf(item).name;
        const href = `/tutorial?id=${encodeURIComponent(item.id || item._id || '')}`;
        return `
          <a class="related-item" href="${href}">
            <p class="related-title">${escapeHtml(title)}</p>
            <p class="related-meta">${escapeHtml(author)}</p>
          </a>
        `;
      }).join('');
    }

    function commentAuthor(comment) {
      const user = comment?.user || comment?.author || {};
      return {
        name: text(user.name || user.username || comment?.username, '匿名用户'),
        avatar: text(user.avatar || user.avatar_url || comment?.avatar, ''),
      };
    }

    function renderComments() {
      if (!state.comments.length) {
        els.commentList.innerHTML = '<div class="empty-state">还没有评论，来抢个沙发吧。</div>';
        return;
      }

      els.commentList.innerHTML = state.comments.map((comment) => {
        const user = commentAuthor(comment);
        const content = text(comment.content, '');
        return `
          <article class="comment-item">
            <div class="comment-head">
              <div class="comment-user">
                <div class="avatar">${user.avatar ? `<img src="${escapeHtml(user.avatar)}" alt="${escapeHtml(user.name)}">` : escapeHtml(initials(user.name))}</div>
                <span class="comment-name">${escapeHtml(user.name)}</span>
              </div>
              <time class="comment-time">${escapeHtml(formatTime(comment.created_at || comment.createdAt))}</time>
            </div>
            <div class="comment-content">${escapeHtml(content)}</div>
          </article>
        `;
      }).join('');
    }

    function setCommentStatus(message, isError = false) {
      els.commentStatus.textContent = message || '';
      els.commentStatus.style.color = isError ? '#b42318' : '#667085';
    }

    function initTopAvatarLink() {
      const avatarBtn = els.avatarBtn;
      if (!avatarBtn) return;

      let username = '';
      let user = null;
      try {
        user = JSON.parse(localStorage.getItem('dp-auth-user') || 'null');
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

      if (user?.avatar) {
        avatarBtn.innerHTML = `<img src="${escapeHtml(user.avatar)}" alt="${escapeHtml(user.username || username || 'me')}">`;
      } else if (username) {
        avatarBtn.textContent = String(username).slice(0, 2).toUpperCase();
      } else {
        avatarBtn.textContent = '我';
      }
    }

    async function ensureCompiler() {
      if (state.compiler) return state.compiler;
      state.compiler = await import('/components/compiler/compiler.js');
      return state.compiler;
    }

    function flattenCompileOutput(output = []) {
      return output.map((item) => {
        if (item.type === 'text' || item.type === 'info') return item.content || '';
        if (item.type === 'error') return `Error: ${item.content || ''}`;
        if (item.type === 'html') return item.content || '';
        if (item.type === 'latex') return item.content || '';
        if (item.type === 'image') return '[image output]';
        return JSON.stringify(item);
      }).join('\n').trim();
    }

    async function runCodeBlock(index, button) {
      const block = state.blocks[index];
      if (!block || state.runningBlocks.has(index)) return;

      const outputEl = els.content.querySelector(`[data-output-index="${index}"]`);
      if (!outputEl) return;

      state.runningBlocks.add(index);
      const original = button.textContent;
      button.disabled = true;
      button.textContent = '运行中...';
      outputEl.style.display = 'block';
      outputEl.textContent = '运行中...';

      try {
        if (typeof window.injectDataFrame === 'function') {
          try {
            window.injectDataFrame({});
          } catch (_) {}
        }

        const compiler = await ensureCompiler();
        const result = await compiler.compile(String(block.code || block.content || ''), 'python');
        const output = flattenCompileOutput(result);
        outputEl.textContent = output || 'Executed (no output).';
      } catch (err) {
        outputEl.textContent = `执行失败: ${err.message}`;
      } finally {
        state.runningBlocks.delete(index);
        button.disabled = false;
        button.textContent = original;
      }
    }

    async function toggleLike() {
      try {
        const token = await ensureToken();
        const method = state.liked ? 'DELETE' : 'POST';
        const res = await fetch(`${API_BASE}/tutorials/${id}/like`, {
          method,
          credentials: 'include',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.message || '点赞操作失败');

        state.liked = !state.liked;
        if (typeof data?.liked === 'boolean') state.liked = data.liked;
        if (Number.isFinite(Number(data?.likes_count))) {
          state.likeCount = Number(data.likes_count);
        } else {
          state.likeCount = Math.max(0, state.likeCount + (state.liked ? 1 : -1));
        }

        renderLikeButton();
      } catch (err) {
        alert(err.message || '请先登录后操作');
      }
    }

    async function loadTutorial() {
      const data = await request(`${API_BASE}/tutorials/${id}`);
      const tutorial = data?.tutorial || data?.data || data;
      state.tutorial = tutorial || {};
      state.blocks = normalizeBlocks(state.tutorial.blocks);
      state.liked = likeFlag(state.tutorial);
      state.likeCount = getLikeCount(state.tutorial);

      renderTopAndSidebar();
      renderBlocks();
    }

    async function loadRelated() {
      try {
        const data = await request(`${API_BASE}/tutorials`, { skipAuth: true });
        const list = Array.isArray(data?.tutorials) ? data.tutorials : (Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []));
        const currentAuthor = authorOf(state.tutorial).id;
        state.related = list
          .filter(item => (item.id || item._id) !== id)
          .filter(item => !currentAuthor || authorOf(item).id === currentAuthor)
          .slice(0, 4);

        if (!state.related.length) {
          state.related = list.filter(item => (item.id || item._id) !== id).slice(0, 4);
        }
        renderRelated();
      } catch (_) {
        els.relatedList.innerHTML = '<div class="empty-state">相关教程加载失败。</div>';
      }
    }

    async function loadComments() {
      try {
        const data = await request(`${API_BASE}/tutorials/${id}/comments`, { skipAuth: true });
        const list = Array.isArray(data?.comments) ? data.comments : (Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []));
        state.comments = list;
        renderComments();
      } catch (_) {
        els.commentList.innerHTML = '<div class="empty-state">评论加载失败。</div>';
      }
    }

    async function submitComment() {
      const content = els.commentInput.value.trim();
      if (!content) {
        setCommentStatus('评论内容不能为空', true);
        return;
      }

      els.commentSubmit.disabled = true;
      setCommentStatus('正在发布...');

      try {
        const token = await ensureToken();
        await fetch(`${API_BASE}/tutorials/${id}/comments`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ content }),
        }).then(async (res) => {
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data?.message || '发表评论失败');
        });

        els.commentInput.value = '';
        setCommentStatus('评论已发布');
        await loadComments();
      } catch (err) {
        setCommentStatus(err.message || '请先登录后评论', true);
      } finally {
        els.commentSubmit.disabled = false;
      }
    }

    function bindEvents() {
      els.content.addEventListener('click', (e) => {
        const runBtn = e.target.closest('.run-btn');
        if (!runBtn) return;
        const index = Number(runBtn.dataset.runIndex);
        if (!Number.isFinite(index)) return;
        runCodeBlock(index, runBtn);
      });

      els.likeBtn.addEventListener('click', toggleLike);
      els.favBtn.addEventListener('click', () => {
        alert('收藏功能即将上线');
      });
      els.commentSubmit.addEventListener('click', submitComment);
    }

    async function boot() {
      initTopAvatarLink();
      bindEvents();
      try {
        await loadTutorial();
        await Promise.all([loadRelated(), loadComments()]);
      } catch (err) {
        document.querySelector('.page').outerHTML = `<div class="error-box">加载教程失败：${escapeHtml(err.message || '未知错误')}</div>`;
        document.querySelector('.comments').style.display = 'none';
      }
    }

    boot();
