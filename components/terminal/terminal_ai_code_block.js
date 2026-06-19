// ── ARIA Interactive Code Block ────────────────────────────────────────────────
//  Smart routing: mathjax/html/markdown → renderBlocks, python → compile.
//  Button layout: one primary action + Insert + subtle Edit/Copy.

import { compile }          from '../compiler/compiler.js';
import { renderBlocks }     from '../screens/compiling_screen/compiling_screen_utility.js';
import { getPrimaryAction } from '../shared/content_router/content_router.js';

const ICON_COPY   = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
const ICON_EDIT   = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
const ICON_INSERT = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5,12 12,5 19,12"/></svg>`;
const ICON_DONE   = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

// ── Public factory ─────────────────────────────────────────────────────────────

export function createAiCodeBlock(lang, rawCode, { onInsert } = {}) {
  let code = rawCode.trimEnd();

  const block = document.createElement('div');
  block.className = 'aria-code-block';

  // Glow shimmer
  const glow = document.createElement('div');
  glow.className = 'aria-code-block-glow';
  block.appendChild(glow);

  // ── Header ──────────────────────────────────────────────────────────────────
  const header = document.createElement('div');
  header.className = 'aria-code-block-hdr';

  const langTag = document.createElement('span');
  langTag.className   = 'aria-code-block-lang';
  langTag.textContent = lang.toUpperCase();

  // Primary action — label and handler from shared content_router
  const action = getPrimaryAction(lang);

  // Utility group: Edit + Copy (subtle, small)
  const utils = document.createElement('div');
  utils.className = 'aria-code-block-utils';
  const editBtn = _btn(ICON_EDIT, 'aria-btn--edit');
  editBtn.title = 'Edit inline';
  const copyBtn = _btn(ICON_COPY, 'aria-btn--copy');
  copyBtn.title = 'Copy';
  utils.append(editBtn, copyBtn);

  if (action.serverOnly) {
    // Server-only language (R, Ruby, etc.) — no Run button, show notice
    const noticeEl = document.createElement('span');
    noticeEl.className   = 'aria-code-block-server-notice';
    noticeEl.title       = action.serverHint;
    noticeEl.textContent = action.serverHint ?? `${lang.toUpperCase()} · server required`;
    header.append(langTag, noticeEl, utils);
  } else {
    const primaryBtn = _btn(action.label, 'aria-btn--run');
    const insertBtn  = _btn(`${ICON_INSERT} Insert`, 'aria-btn--insert');
    insertBtn.innerHTML = `${ICON_INSERT} Insert`;
    header.append(langTag, primaryBtn, insertBtn, utils);
    // Primary click handler attached below (need primaryBtn in scope)
    // Store on block for the handler section
    block._primaryBtn = primaryBtn;
  }

  block.appendChild(header);

  // ── Code body ────────────────────────────────────────────────────────────────
  const pre = document.createElement('pre');
  pre.className = 'aria-code-block-pre';
  pre.textContent = code;

  const codeWrap = document.createElement('div');
  codeWrap.className = 'aria-code-block-body';
  codeWrap.appendChild(pre);
  block.appendChild(codeWrap);

  // ── Output area ──────────────────────────────────────────────────────────────
  const outputArea = document.createElement('div');
  outputArea.className = 'aria-code-block-output';
  block.appendChild(outputArea);

  // ── State ────────────────────────────────────────────────────────────────────
  let editMode = false;
  let editTA   = null;

  // ── Primary (Run / Render / Preview) — only wired for non-server-only langs ───
  const primaryBtn = block._primaryBtn; // null for server-only languages
  if (primaryBtn) primaryBtn.addEventListener('click', async () => {
    const src = editMode ? editTA.value : code;
    outputArea.innerHTML = '<div class="aria-output-running"><span class="aria-output-spinner"></span> Working…</div>';
    primaryBtn.disabled = true;
    try {
      if (action.renderMode) {
        // Non-Python: render directly (latex / html / markdown)
        outputArea.innerHTML = '';
        renderBlocks([{ type: action.renderMode === 'mathjax' ? 'latex' : action.renderMode, content: src }], outputArea);
      } else if (action.handler === 'runInKernel') {
        // Python: compile via shared kernel
        const outputs = await compile(src, 'python');
        outputArea.innerHTML = '';
        if (outputs.length) {
          renderBlocks(outputs, outputArea);
        } else {
          outputArea.innerHTML = '<div class="aria-output-empty">No output</div>';
        }
      } else {
        // insertFullBlock or copyToClipboard — primary button shouldn't execute
        outputArea.innerHTML = '';
      }
    } catch (e) {
      outputArea.innerHTML = `<div class="output-block output-error"><div class="output-text">${String(e)}</div></div>`;
    } finally {
      primaryBtn.disabled = false;
    }
    block.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }); // end if (primaryBtn)

  // ── Insert (only present for non-server-only langs) ─────────────────────────
  const insertBtn = header.querySelector('.aria-btn--insert');
  if (insertBtn) insertBtn.addEventListener('click', () => {
    const src = editMode ? editTA.value : code;
    if (onInsert) {
      onInsert(src);
    } else {
      const ed = document.querySelector('#generative-screen .code-editor');
      if (ed) { ed.value = src; ed.dispatchEvent(new Event('input')); }
    }
    insertBtn.innerHTML = `${ICON_DONE} Inserted`;
    insertBtn.classList.add('aria-btn--done');
    setTimeout(() => {
      insertBtn.innerHTML = `${ICON_INSERT} Insert`;
      insertBtn.classList.remove('aria-btn--done');
    }, 1800);
  }); // end if (insertBtn)

  // ── Edit ─────────────────────────────────────────────────────────────────────
  editBtn.addEventListener('click', () => {
    if (!editMode) {
      editTA = document.createElement('textarea');
      editTA.className  = 'aria-code-block-edit';
      editTA.spellcheck = false;
      editTA.value      = code;
      _autosize(editTA);
      editTA.addEventListener('input', () => _autosize(editTA));
      pre.replaceWith(editTA);
      editBtn.innerHTML = ICON_DONE;
      editBtn.title     = 'Done editing';
      editBtn.classList.add('aria-btn--editing');
      editMode = true;
      editTA.focus();
    } else {
      code = editTA.value.trimEnd();
      pre.textContent = code;
      editTA.replaceWith(pre);
      editBtn.innerHTML = ICON_EDIT;
      editBtn.title     = 'Edit inline';
      editBtn.classList.remove('aria-btn--editing');
      editMode = false;
    }
  });

  // ── Copy ─────────────────────────────────────────────────────────────────────
  copyBtn.addEventListener('click', async () => {
    const src = editMode ? editTA.value : code;
    try {
      await navigator.clipboard.writeText(src);
      copyBtn.innerHTML = ICON_DONE;
      copyBtn.classList.add('aria-btn--done');
      setTimeout(() => {
        copyBtn.innerHTML = ICON_COPY;
        copyBtn.classList.remove('aria-btn--done');
      }, 1800);
    } catch (_) {}
  });

  // ── Entrance animation ───────────────────────────────────────────────────────
  requestAnimationFrame(() => block.classList.add('aria-code-block--in'));

  return block;
}

function _btn(label, cls) {
  const b = document.createElement('button');
  b.className = `aria-btn ${cls}`;
  b.innerHTML = label;
  return b;
}

function _autosize(ta) {
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
}
