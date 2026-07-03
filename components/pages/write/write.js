    import { initAuth } from '/components/auth/auth_client.js';
    const API_BASE = 'https://api.dreamingpolar.com/auth/tutorials';
    const TAGS = ['Python', '数据分析', '可视化', '机器学习', 'LaTeX', '入门'];

    let blocks = [];
    let tutorialMeta = {
      title: '',
      summary: '',
      cover_image: '',
      tags: [],
      status: 'draft'
    };

    let currentTutorialId = null;
    let latestToken = null;
    let modalResolve = null;
    let isSubmitting = false;

    const els = {
      titleInput: document.getElementById('title-input'),
      saveBtn: document.getElementById('btn-save'),
      updateBtn: document.getElementById('btn-update'),
      publishBtn: document.getElementById('btn-publish'),
      avatarBtn: document.getElementById('avatar-btn'),
      saveStatus: document.getElementById('save-status'),
      blockList: document.getElementById('block-list'),
      previewPlaceholder: document.getElementById('preview-placeholder'),
      previewContent: document.getElementById('preview-content'),
      coverUploadBtn: document.getElementById('cover-upload-btn'),
      coverPreview: document.getElementById('cover-preview'),
      metaTitle: document.getElementById('meta-title'),
      metaSummary: document.getElementById('meta-summary'),
      metaTags: document.getElementById('meta-tags'),
      toolPanel: document.querySelector('.block-tools'),
      modalLayer: document.getElementById('modal-layer'),
      modalTitle: document.getElementById('modal-title'),
      modalBody: document.getElementById('modal-body'),
      modalCancel: document.getElementById('modal-cancel'),
      modalConfirm: document.getElementById('modal-confirm'),
    };

    function uid() {
      return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    }

    function esc(text) {
      return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function normalizeBlock(raw = {}) {
      return {
        id: raw.id || uid(),
        type: raw.type || 'text',
        content: raw.content ?? '',
        language: raw.language || 'python',
        executable: typeof raw.executable === 'boolean' ? raw.executable : true,
        level: Number(raw.level || 2),
        variant: raw.variant || 'tip',
        imageUrl: raw.imageUrl || '',
        caption: raw.caption || '',
      };
    }

    function addBlock(partial) {
      blocks.push(normalizeBlock(partial));
      markDirty('已添加 block，待保存');
      renderEditor();
      renderPreview();
    }

    function markDirty(msg = '内容已更新，待保存') {
      els.saveStatus.textContent = msg;
    }

    function setSaved(msg = '已保存') {
      els.saveStatus.textContent = msg;
    }

    function initTopAvatarLink() {
      const avatarBtn = els.avatarBtn;
      if (!avatarBtn) return;

      let username = '';
      let user = null;
      try {
        user = window.authClient?.getUser?.() ?? window.dpAuthStore?.loadUserCache?.() ?? null;
        username = window.authClient?.getUser?.()?.username
          ?? window.dpAuthStore?.loadUserCache?.()?.username
          ?? '';
      } catch (_) {}

      if (username) {
        avatarBtn.href = `/profile?username=${encodeURIComponent(username)}`;
        avatarBtn.onclick = null;
      } else {
        avatarBtn.href = '/';
      }

      if (user?.avatar) {
        avatarBtn.innerHTML = `<img src="${esc(user.avatar)}" alt="${esc(user.username || username || 'me')}">`;
      } else if (username) {
        avatarBtn.textContent = String(username).slice(0, 2).toUpperCase();
      } else {
        avatarBtn.textContent = '我';
      }
    }

    function renderMeta() {
      const title = tutorialMeta.title || '';
      els.titleInput.value = title;
      els.metaTitle.value = title;
      els.metaSummary.value = tutorialMeta.summary || '';

      if (tutorialMeta.cover_image) {
        els.coverPreview.innerHTML = `<img src="${esc(tutorialMeta.cover_image)}" alt="封面">`;
      } else {
        els.coverPreview.textContent = '无封面';
      }

      const builtInTagsHtml = TAGS.map(tag => {
        const active = tutorialMeta.tags.includes(tag) ? 'active' : '';
        return `<button type="button" class="tag-chip ${active}" data-tag="${esc(tag)}">${esc(tag)}</button>`;
      }).join('');

      const customTagsHtml = tutorialMeta.tags
        .filter(tag => !TAGS.includes(tag))
        .map(tag => `<button type="button" class="tag-chip active" data-tag="${esc(tag)}" data-custom="1">${esc(tag)} ×</button>`)
        .join('');

      els.metaTags.innerHTML = `${builtInTagsHtml}${customTagsHtml}
        <div class="tag-input-wrap">
          <input type="text" id="custom-tag-input" placeholder="输入自定义标签..." maxlength="20">
          <button type="button" id="add-custom-tag">+</button>
        </div>`;

      bindCustomTagInput();
    }

    function addCustomTag(value) {
      const tag = String(value || '').trim();
      if (!tag) return;
      if (tutorialMeta.tags.includes(tag)) return;
      if (tutorialMeta.tags.length >= 5) {
        alert('最多添加5个标签');
        return;
      }

      tutorialMeta.tags.push(tag);
      markDirty();
      renderMeta();
      renderPreview();
    }

    function bindCustomTagInput() {
      const customInput = document.getElementById('custom-tag-input');
      const addTagBtn = document.getElementById('add-custom-tag');
      if (!customInput || !addTagBtn) return;

      customInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          addCustomTag(customInput.value);
        }
      });

      addTagBtn.addEventListener('click', () => addCustomTag(customInput.value));
    }

    function typeBadge(type) {
      const map = {
        text: '文本',
        code: '代码',
        latex: '公式',
        heading: '标题',
        image: '图片',
        callout: '提示框',
      };
      return map[type] || type;
    }

    function renderBlockContent(block) {
      if (block.type === 'text') {
        return `<textarea class="block-input" data-field="content" placeholder="输入文本（支持 Markdown）">${esc(block.content)}</textarea>`;
      }

      if (block.type === 'code') {
        return `
          <div class="block-head">
            <span class="type-badge">代码</span>
            <span class="lang-badge">${esc(block.language)}</span>
            <label class="toggle"><input type="checkbox" data-field="executable" ${block.executable ? 'checked' : ''}>可执行</label>
            <select class="block-select" data-field="language" style="max-width:160px;">
              <option value="python" ${block.language === 'python' ? 'selected' : ''}>Python</option>
              <option value="latex" ${block.language === 'latex' ? 'selected' : ''}>LaTeX</option>
              <option value="javascript" ${block.language === 'javascript' ? 'selected' : ''}>JavaScript</option>
              <option value="markdown" ${block.language === 'markdown' ? 'selected' : ''}>Markdown</option>
            </select>
          </div>
          <textarea class="code-editor" data-field="content" placeholder="输入代码...">${esc(block.content)}</textarea>
        `;
      }

      if (block.type === 'latex') {
        return `
          <div class="latex-editor">
            <textarea class="block-input" data-field="content" placeholder="输入 LaTeX 公式">${esc(block.content)}</textarea>
            <div class="latex-live">${block.content ? `\\[${esc(block.content)}\\]` : '公式预览区'}</div>
          </div>
        `;
      }

      if (block.type === 'heading') {
        return `
          <div class="block-head">
            <span class="type-badge">标题</span>
            <select class="block-select" data-field="level" style="max-width:120px;">
              <option value="2" ${Number(block.level) === 2 ? 'selected' : ''}>H2</option>
              <option value="3" ${Number(block.level) === 3 ? 'selected' : ''}>H3</option>
              <option value="4" ${Number(block.level) === 4 ? 'selected' : ''}>H4</option>
            </select>
          </div>
          <input class="block-inline" data-field="content" value="${esc(block.content)}" placeholder="输入标题内容">
        `;
      }

      if (block.type === 'image') {
        return `
          <div class="image-block">
            <input class="block-inline" data-field="imageUrl" value="${esc(block.imageUrl)}" placeholder="图片 URL">
            ${block.imageUrl ? `<img class="image-thumb" src="${esc(block.imageUrl)}" alt="图片">` : ''}
            <input class="block-inline" data-field="caption" value="${esc(block.caption)}" placeholder="图片说明（可选）">
          </div>
        `;
      }

      if (block.type === 'callout') {
        return `
          <div class="block-head">
            <span class="type-badge">提示框</span>
            <select class="block-select" data-field="variant" style="max-width:160px;">
              <option value="tip" ${block.variant === 'tip' ? 'selected' : ''}>tip</option>
              <option value="warning" ${block.variant === 'warning' ? 'selected' : ''}>warning</option>
              <option value="info" ${block.variant === 'info' ? 'selected' : ''}>info</option>
            </select>
          </div>
          <textarea class="block-input" data-field="content" placeholder="输入提示内容">${esc(block.content)}</textarea>
        `;
      }

      return `<textarea class="block-input" data-field="content">${esc(block.content)}</textarea>`;
    }

    function renderEditor() {
      if (!blocks.length) {
        els.blockList.innerHTML = '<div class="block-empty">点击左侧工具栏添加第一个 Block</div>';
        return;
      }

      els.blockList.innerHTML = blocks.map((block, index) => {
        return `
          <div class="block-card" data-id="${block.id}" data-type="${block.type}">
            <div class="block-handle">⠿</div>
            <div class="block-content">
              <div class="block-head"><span class="type-badge">${typeBadge(block.type)}</span></div>
              ${renderBlockContent(block)}
            </div>
            <div class="block-actions">
              <button class="block-move-up" data-action="up" ${index === 0 ? 'disabled' : ''}>↑</button>
              <button class="block-move-down" data-action="down" ${index === blocks.length - 1 ? 'disabled' : ''}>↓</button>
              <button class="block-delete" data-action="delete">×</button>
            </div>
          </div>
        `;
      }).join('');

      if (window.MathJax?.typesetPromise) {
        window.MathJax.typesetPromise([els.blockList]).catch(() => {});
      }
    }

    function renderPreview() {
      const hasContent = blocks.length > 0 || tutorialMeta.title || tutorialMeta.summary || tutorialMeta.cover_image;
      els.previewPlaceholder.style.display = hasContent ? 'none' : '';
      els.previewContent.style.display = hasContent ? '' : 'none';
      if (!hasContent) return;

      const metaHtml = `
        ${tutorialMeta.cover_image ? `<img class="preview-cover" src="${esc(tutorialMeta.cover_image)}" alt="封面">` : ''}
        ${tutorialMeta.title ? `<h1 class="preview-title">${esc(tutorialMeta.title)}</h1>` : ''}
        ${tutorialMeta.summary ? `<p class="preview-summary">${esc(tutorialMeta.summary)}</p>` : ''}
        ${tutorialMeta.tags.length ? `<div class="preview-tag-row">${tutorialMeta.tags.map(t => `<span class="preview-tag">${esc(t)}</span>`).join('')}</div>` : ''}
      `;

      const blocksHtml = blocks.map(block => {
        if (block.type === 'text') {
          return `<section>${marked.parse(block.content || '', { breaks: true })}</section>`;
        }
        if (block.type === 'code') {
          const lang = String(block.language || '').toLowerCase();
          return `<pre class="preview-code"><code class="language-${esc(lang)}">${esc(block.content || '')}</code></pre>`;
        }
        if (block.type === 'latex') {
          return `<section>\\[${esc(block.content || '')}\\]</section>`;
        }
        if (block.type === 'heading') {
          const lv = [2, 3, 4].includes(Number(block.level)) ? Number(block.level) : 2;
          return `<h${lv}>${esc(block.content || '标题')}</h${lv}>`;
        }
        if (block.type === 'image') {
          if (!block.imageUrl) return '';
          return `<figure><img class="preview-cover" src="${esc(block.imageUrl)}" alt="图片">${block.caption ? `<figcaption>${esc(block.caption)}</figcaption>` : ''}</figure>`;
        }
        if (block.type === 'callout') {
          const v = ['tip', 'warning', 'info'].includes(block.variant) ? block.variant : 'tip';
          return `<section class="preview-callout ${v}">${marked.parse(block.content || '', { breaks: true })}</section>`;
        }
        return '';
      }).join('');

      els.previewContent.innerHTML = `${metaHtml}${blocksHtml}`;

      if (window.hljs) {
        els.previewContent.querySelectorAll('pre code').forEach(node => {
          window.hljs.highlightElement(node);
        });
      }
      if (window.MathJax?.typesetPromise) {
        window.MathJax.typesetPromise([els.previewContent]).catch(() => {});
      }
    }

    function moveBlock(id, dir) {
      const idx = blocks.findIndex(b => b.id === id);
      if (idx < 0) return;
      const next = idx + dir;
      if (next < 0 || next >= blocks.length) return;
      const temp = blocks[idx];
      blocks[idx] = blocks[next];
      blocks[next] = temp;
      markDirty('Block 顺序已调整，待保存');
      renderEditor();
      renderPreview();
    }

    function removeBlock(id) {
      const idx = blocks.findIndex(b => b.id === id);
      if (idx < 0) return;
      blocks.splice(idx, 1);
      markDirty('Block 已删除，待保存');
      renderEditor();
      renderPreview();
    }

    function openModal(title, bodyHtml) {
      els.modalTitle.textContent = title;
      els.modalBody.innerHTML = bodyHtml;
      els.modalLayer.classList.add('show');
      els.modalLayer.setAttribute('aria-hidden', 'false');

      return new Promise(resolve => {
        modalResolve = resolve;
      });
    }

    function closeModal(result) {
      els.modalLayer.classList.remove('show');
      els.modalLayer.setAttribute('aria-hidden', 'true');
      const fn = modalResolve;
      modalResolve = null;
      if (fn) fn(result);
    }

    function readModalValues() {
      const form = {};
      els.modalBody.querySelectorAll('[name]').forEach(el => {
        if (el.type === 'checkbox') {
          form[el.name] = el.checked;
        } else {
          form[el.name] = el.value;
        }
      });
      return form;
    }

    async function promptCodeBlock() {
      const result = await openModal('代码 Block 设置', `
        <label class="modal-field">语言
          <select name="language">
            <option value="python">Python</option>
            <option value="latex">LaTeX</option>
            <option value="javascript">JavaScript</option>
            <option value="markdown">Markdown</option>
          </select>
        </label>
        <label class="modal-field"><span><input type="checkbox" name="executable" checked> 是否可执行（默认开启）</span></label>
      `);
      if (!result) return;
      addBlock({ type: 'code', content: '', language: result.language || 'python', executable: !!result.executable });
    }

    async function promptHeadingBlock() {
      const result = await openModal('标题级别', `
        <label class="modal-field">选择级别
          <select name="level">
            <option value="2">H2</option>
            <option value="3">H3</option>
            <option value="4">H4</option>
          </select>
        </label>
      `);
      if (!result) return;
      addBlock({ type: 'heading', level: Number(result.level || 2), content: '' });
    }

    async function promptCalloutBlock() {
      const result = await openModal('提示框类型', `
        <label class="modal-field">选择类型
          <select name="variant">
            <option value="tip">tip</option>
            <option value="warning">warning</option>
            <option value="info">info</option>
          </select>
        </label>
      `);
      if (!result) return;
      addBlock({ type: 'callout', variant: result.variant || 'tip', content: '' });
    }

    async function promptImageBlock() {
      const waitResult = openModal('图片 Block', `
        <div class="img-upload-options">
          <label class="upload-option upload-pick">
            <i class="ti ti-upload"></i>
            <span>本地上传</span>
            <input type="file" accept="image/*" style="display:none" id="img-file-input">
          </label>
          <div class="upload-divider">或</div>
          <div class="upload-option url-option">
            <i class="ti ti-link"></i>
            <input type="text" name="imageUrl" placeholder="粘贴图片URL..." id="img-url-input">
          </div>
          <label class="modal-field">图片说明
            <input name="caption" placeholder="可选">
          </label>
          <div class="upload-status" id="img-upload-status"></div>
        </div>
      `);

      const fileInput = document.getElementById('img-file-input');
      const statusEl = document.getElementById('img-upload-status');
      if (fileInput) {
        fileInput.addEventListener('change', async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;

          if (statusEl) statusEl.textContent = '上传中...';
          els.modalConfirm.disabled = true;
          els.modalCancel.disabled = true;

          try {
            const imageUrl = await uploadImageToCOS(file);
            addBlock({ type: 'image', imageUrl, caption: '' });
            closeModal({ uploaded: true });
          } catch (err) {
            if (statusEl) statusEl.textContent = `上传失败：${err.message}`;
          } finally {
            els.modalConfirm.disabled = false;
            els.modalCancel.disabled = false;
          }
        });
      }

      const result = await waitResult;
      if (!result || result.uploaded) return;
      addBlock({ type: 'image', imageUrl: result.imageUrl || '', caption: result.caption || '' });
    }

    async function promptCoverUrl() {
      const waitResult = openModal('设置封面图', `
        <div class="img-upload-options">
          <label class="upload-option upload-pick">
            <i class="ti ti-upload"></i>
            <span>本地上传封面</span>
            <input type="file" accept="image/*" style="display:none" id="cover-file-input">
          </label>
          <div class="upload-divider">或</div>
          <div class="upload-option url-option">
            <i class="ti ti-link"></i>
            <input type="text" name="coverImage" value="${esc(tutorialMeta.cover_image || '')}" placeholder="粘贴封面URL...">
          </div>
          <div class="upload-status" id="cover-upload-status"></div>
        </div>
      `);

      const fileInput = document.getElementById('cover-file-input');
      const statusEl = document.getElementById('cover-upload-status');
      if (fileInput) {
        fileInput.addEventListener('change', async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;

          if (statusEl) statusEl.textContent = '上传中...';
          els.modalConfirm.disabled = true;
          els.modalCancel.disabled = true;

          try {
            const croppedFile = await cropCoverToRatio(file, 16 / 9);
            const imageUrl = await uploadImageToCOS(croppedFile);
            tutorialMeta.cover_image = imageUrl;
            markDirty('封面已更新，待保存');
            renderMeta();
            renderPreview();
            closeModal({ uploaded: true });
          } catch (err) {
            if (statusEl) statusEl.textContent = `上传失败：${err.message}`;
          } finally {
            els.modalConfirm.disabled = false;
            els.modalCancel.disabled = false;
          }
        });
      }

      const result = await waitResult;
      if (!result || result.uploaded) return;
      tutorialMeta.cover_image = result.coverImage || '';
      markDirty('封面已更新，待保存');
      renderMeta();
      renderPreview();
    }

    async function cropCoverToRatio(file, ratio = 16 / 9) {
      if (!(file instanceof File) || !file.type.startsWith('image/')) return file;

      const img = await new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const image = new Image();
        image.onload = () => {
          URL.revokeObjectURL(url);
          resolve(image);
        };
        image.onerror = (err) => {
          URL.revokeObjectURL(url);
          reject(err);
        };
        image.src = url;
      }).catch(() => null);

      if (!img) return file;

      const srcW = img.naturalWidth || img.width;
      const srcH = img.naturalHeight || img.height;
      if (!srcW || !srcH) return file;

      let cropW = srcW;
      let cropH = Math.round(cropW / ratio);
      if (cropH > srcH) {
        cropH = srcH;
        cropW = Math.round(cropH * ratio);
      }

      const sx = Math.max(0, Math.floor((srcW - cropW) / 2));
      const sy = Math.max(0, Math.floor((srcH - cropH) / 2));
      const maxW = 1600;
      const outW = Math.min(cropW, maxW);
      const outH = Math.round(outW / ratio);

      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d');
      if (!ctx) return file;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, sx, sy, cropW, cropH, 0, 0, outW, outH);

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
      if (!blob) return file;

      const base = (file.name || 'cover').replace(/\.[^.]+$/, '');
      return new File([blob], `${base}-cover.jpg`, { type: 'image/jpeg' });
    }

    function bindToolbar() {
      els.toolPanel.addEventListener('click', async e => {
        const btn = e.target.closest('[data-add]');
        if (!btn) return;
        const t = btn.dataset.add;

        if (t === 'text') return addBlock({ type: 'text', content: '' });
        if (t === 'code') return promptCodeBlock();
        if (t === 'latex') return addBlock({ type: 'latex', content: '' });
        if (t === 'image') return promptImageBlock();
        if (t === 'heading') return promptHeadingBlock();
        if (t === 'callout') return promptCalloutBlock();
      });
    }

    function bindBlockEditor() {
      els.blockList.addEventListener('click', e => {
        const card = e.target.closest('.block-card');
        if (!card) return;
        const id = card.dataset.id;
        const action = e.target.closest('button')?.dataset?.action;
        if (!action) return;
        if (action === 'up') return moveBlock(id, -1);
        if (action === 'down') return moveBlock(id, 1);
        if (action === 'delete') return removeBlock(id);
      });

      els.blockList.addEventListener('input', e => {
        const card = e.target.closest('.block-card');
        if (!card) return;
        const id = card.dataset.id;
        const field = e.target.dataset.field;
        if (!field) return;

        const block = blocks.find(b => b.id === id);
        if (!block) return;

        let value;
        if (e.target.type === 'checkbox') {
          value = !!e.target.checked;
        } else if (field === 'level') {
          value = Number(e.target.value || 2);
        } else {
          value = e.target.value;
        }
        block[field] = value;

        if (field === 'imageUrl') {
          const img = card.querySelector('.image-thumb');
          if (img) img.src = value;
        }

        markDirty();
        renderPreview();
      });

      els.blockList.addEventListener('change', e => {
        const card = e.target.closest('.block-card');
        if (!card) return;
        const id = card.dataset.id;
        const field = e.target.dataset.field;
        if (!field) return;
        const block = blocks.find(b => b.id === id);
        if (!block) return;

        if (e.target.type === 'checkbox') {
          block[field] = !!e.target.checked;
        } else if (field === 'level') {
          block[field] = Number(e.target.value || 2);
        } else {
          block[field] = e.target.value;
        }
        markDirty();
        renderEditor();
        renderPreview();
      });
    }

    function bindMetaEditor() {
      const onTitleInput = v => {
        tutorialMeta.title = v;
        if (els.titleInput.value !== v) els.titleInput.value = v;
        if (els.metaTitle.value !== v) els.metaTitle.value = v;
        markDirty();
        renderPreview();
      };

      els.titleInput.addEventListener('input', e => onTitleInput(e.target.value));
      els.metaTitle.addEventListener('input', e => onTitleInput(e.target.value));

      els.metaSummary.addEventListener('input', e => {
        tutorialMeta.summary = e.target.value;
        markDirty();
        renderPreview();
      });

      els.metaTags.addEventListener('click', e => {
        const chip = e.target.closest('[data-tag]');
        if (!chip) return;
        const tag = chip.dataset.tag;
        if (tutorialMeta.tags.includes(tag)) {
          tutorialMeta.tags = tutorialMeta.tags.filter(t => t !== tag);
        } else {
          if (tutorialMeta.tags.length >= 5) {
            alert('最多添加5个标签');
            return;
          }
          tutorialMeta.tags.push(tag);
        }
        markDirty();
        renderMeta();
        renderPreview();
      });

      els.coverUploadBtn.addEventListener('click', promptCoverUrl);
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
      const keys = ['dp-access-token', 'accessToken', 'token', 'dp-token'];
      for (const k of keys) {
        const v = localStorage.getItem(k);
        if (v) return v;
      }
      return '';
    }

    function getToken() {
      const fromClient = window.authClient?.getAccessToken?.();
      if (fromClient) return fromClient;
      if (latestToken) return latestToken;
      return getTokenFromCookie() || getDpAccessCookie() || getTokenFromLocalStorage();
    }

    function getCachedUser() {
      try {
        const u = window.authClient?.getUser?.() ?? window.dpAuthStore?.loadUserCache?.() ?? null;
        return u && u.username ? u : null;
      } catch (_) {
        return null;
      }
    }

    function isWriterLoggedIn() {
      if (window.authClient?.isLoggedIn?.()) return true;
      return Boolean(getCachedUser() && getToken());
    }

    function syncWriterAuthStatus() {
      const text = String(els.saveStatus.textContent || '');
      const isAuthHint = /^(游客模式|未登录|登录恢复中)/.test(text);

      if (isWriterLoggedIn()) {
        if (isAuthHint) els.saveStatus.textContent = '';
        return;
      }

      if (getCachedUser()) {
        // Cached user exists but token may still be restoring via refresh.
        els.saveStatus.textContent = '登录恢复中...';
        return;
      }

      els.saveStatus.textContent = '游客模式：仅可预览，登录后可保存/发布。';
    }

    function requireWriterLogin() {
      if (isWriterLoggedIn()) return true;
      els.saveStatus.textContent = '未登录，无法发帖。请先登录。';
      window.dpAuthModal?.open?.('login');
      return false;
    }

    function resolveUploadedImageUrl(data) {
      const imageUrl = data?.url
        || data?.public_url
        || data?.file_url
        || data?.publicUrl
        || data?.fileUrl
        || (() => {
          const key = data?.cos_key || data?.cosKey || data?.key || data?.path || data?.file_key || data?.fileKey;
          if (key) {
            const rawKey = String(key);
            if (rawKey.startsWith('http://') || rawKey.startsWith('https://')) {
              return rawKey;
            }
            const noLeadSlash = rawKey.replace(/^\/+/, '');
            const cleanKey = noLeadSlash.startsWith('users/') ? noLeadSlash : `users/${noLeadSlash}`;
            return `https://dp-1317483118.cos.ap-hongkong.myqcloud.com/${cleanKey}`;
          }

          const id = data?.id;
          if (id) return `${API_BASE.replace('/tutorials', '')}/files/${encodeURIComponent(String(id))}`;
          return '';
        })();

      if (!imageUrl) throw new Error('上传成功但未返回图片地址');
      return imageUrl;
    }

    function normalizeImageUrl(v) {
      const s = String(v || '').trim();
      if (!s) return '';
      if (s.startsWith('http://') || s.startsWith('https://') || s.startsWith('data:image/') || s.startsWith('blob:')) return s;
      if (s.startsWith('users/') || s.includes('/')) {
        const noLeadSlash = s.replace(/^\/+/, '');
        const cleanKey = noLeadSlash.startsWith('users/') ? noLeadSlash : `users/${noLeadSlash}`;
        return `https://dp-1317483118.cos.ap-hongkong.myqcloud.com/${cleanKey}`;
      }
      return `${API_BASE.replace('/tutorials', '')}/files/${encodeURIComponent(s)}`;
    }

    async function uploadImageToCOS(file) {
      const token = getToken();
      if (!token) throw new Error('请先登录');

      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('https://api.dreamingpolar.com/auth/files/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.message || `上传失败: ${res.status}`);
      }

      return resolveUploadedImageUrl(data);
    }

    async function ensureToken() {
      let token = getToken();
      if (token) {
        latestToken = token;
        return token;
      }

      try {
        const res = await fetch('https://api.dreamingpolar.com/auth/refresh', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        });
        if (!res.ok) return '';
        const data = await res.json().catch(() => ({}));
        latestToken = data.accessToken || '';
        return latestToken;
      } catch {
        return '';
      }
    }

    function buildPayload(status) {
      return {
        ...tutorialMeta,
        title: (tutorialMeta.title || '').trim(),
        summary: (tutorialMeta.summary || '').trim(),
        cover_image: (tutorialMeta.cover_image || '').trim(),
        tags: Array.isArray(tutorialMeta.tags) ? tutorialMeta.tags : [],
        blocks,
        status,
      };
    }

    function extractTutorialId(respData) {
      return String(respData?.id || respData?.tutorial_id || respData?.tutorialId || '');
    }

    function setEditMode(isEdit) {
      els.updateBtn.style.display = isEdit ? '' : 'none';
      els.saveBtn.style.display = isEdit ? 'none' : '';
    }

    function setTopActionDisabled(disabled) {
      [els.saveBtn, els.updateBtn, els.publishBtn].forEach((btn) => {
        if (!btn) return;
        btn.disabled = !!disabled;
      });
    }

    async function withSubmitLock(task) {
      if (isSubmitting) {
        els.saveStatus.textContent = '请求进行中，请稍候...';
        return false;
      }

      isSubmitting = true;
      setTopActionDisabled(true);
      try {
        await task();
        return true;
      } finally {
        isSubmitting = false;
        setTopActionDisabled(false);
      }
    }

    async function requestWithAuth(method, url, body) {
      const token = await ensureToken();
      if (!token) throw new Error('未登录或登录已过期，请先登录。');

      const res = await fetch(url, {
        method,
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.message || `请求失败: ${res.status}`);
      }
      return data;
    }

    async function createTutorial(status) {
      const payload = buildPayload(status);
      if (!payload.title) throw new Error('请先填写教程标题');
      const data = await requestWithAuth('POST', API_BASE, payload);
      const id = extractTutorialId(data);
      if (id) {
        currentTutorialId = id;
        history.replaceState({}, '', `/write?id=${encodeURIComponent(id)}`);
        setEditMode(true);
      }
      tutorialMeta.status = status;
      return data;
    }

    async function updateTutorial(status = tutorialMeta.status || 'draft') {
      if (!currentTutorialId) throw new Error('当前不是已存在教程');
      const payload = buildPayload(status);
      if (!payload.title) throw new Error('请先填写教程标题');
      const data = await requestWithAuth('PUT', `${API_BASE}/${encodeURIComponent(currentTutorialId)}`, payload);
      tutorialMeta.status = status;
      return data;
    }

    async function onSaveDraft() {
      if (!requireWriterLogin()) return;
      await withSubmitLock(async () => {
        try {
          els.saveStatus.textContent = '保存中...';
          await createTutorial('draft');
          setSaved('草稿已保存');
        } catch (e) {
          els.saveStatus.textContent = `保存失败: ${e.message}`;
        }
      });
    }

    async function onUpdate() {
      if (!requireWriterLogin()) return;
      await withSubmitLock(async () => {
        try {
          els.saveStatus.textContent = '更新中...';
          await updateTutorial('draft');
          setSaved('已更新');
        } catch (e) {
          els.saveStatus.textContent = `更新失败: ${e.message}`;
        }
      });
    }

    async function onPublish() {
      if (!requireWriterLogin()) return;
      await withSubmitLock(async () => {
        try {
          els.saveStatus.textContent = '发布中...';
          if (currentTutorialId) {
            await updateTutorial('published');
          } else {
            await createTutorial('published');
          }
          setSaved('发布成功，正在跳转...');
          if (currentTutorialId) {
            location.href = `/tutorial?id=${encodeURIComponent(currentTutorialId)}`;
          }
        } catch (e) {
          els.saveStatus.textContent = `发布失败: ${e.message}`;
        }
      });
    }

    async function loadExistingTutorial() {
      const id = new URLSearchParams(location.search).get('id');
      if (!id) {
        setEditMode(false);
        return;
      }

      try {
        els.saveStatus.textContent = '加载中...';
        const token = await ensureToken();
        if (!token) throw new Error('请先登录后再编辑教程');

        const res = await fetch(`${API_BASE}/${encodeURIComponent(id)}`, {
          method: 'GET',
          credentials: 'include',
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.message || `加载失败: ${res.status}`);

        currentTutorialId = id;
        tutorialMeta = {
          title: data.title || '',
          summary: data.summary || '',
          cover_image: normalizeImageUrl(data.cover_image || ''),
          tags: Array.isArray(data.tags) ? data.tags : [],
          status: data.status || 'draft'
        };
        blocks = Array.isArray(data.blocks) ? data.blocks.map(normalizeBlock) : [];

        setEditMode(true);
        renderMeta();
        renderEditor();
        renderPreview();
        setSaved('已加载教程');
      } catch (e) {
        setEditMode(false);
        els.saveStatus.textContent = `加载失败: ${e.message}`;
      }
    }

    function bindTopButtons() {
      els.saveBtn.addEventListener('click', onSaveDraft);
      els.updateBtn.addEventListener('click', onUpdate);
      els.publishBtn.addEventListener('click', onPublish);
    }

    function bindModal() {
      els.modalCancel.addEventListener('click', () => closeModal(null));
      els.modalConfirm.addEventListener('click', () => closeModal(readModalValues()));
      els.modalLayer.addEventListener('click', e => {
        if (e.target === els.modalLayer) closeModal(null);
      });
    }

    function bindAuthStateSync() {
      document.addEventListener('dp-auth-state', () => {
        initTopAvatarLink();
        syncWriterAuthStatus();
      });

      document.addEventListener('dp-auth-logout', () => {
        initTopAvatarLink();
        syncWriterAuthStatus();
      });
    }

    function init() {
      initTopAvatarLink();
      renderMeta();
      renderEditor();
      renderPreview();
      bindToolbar();
      bindBlockEditor();
      bindMetaEditor();
      bindTopButtons();
      bindModal();
      bindAuthStateSync();
      syncWriterAuthStatus();

      initAuth().then(() => {
        initTopAvatarLink();
        syncWriterAuthStatus();
        if (!window.authClient?.isLoggedIn()) {
          console.warn('[write] 未登录，保存/发布功能需要先登录');
        }
      });

      loadExistingTutorial();
    }

    init();
