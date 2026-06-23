// ── Icons ──────────────────────────────────────────────
export const ICON_COPY  = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
export const ICON_CHECK = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
const COPY_BTN          = `<button class="lus-copy-btn cs-copy-btn" title="Copy code">${ICON_COPY}</button>`;

// ── Escape ─────────────────────────────────────────────
export function escapeHtml(text = '') {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── Header buttons ─────────────────────────────────────
export function createMaximizeBtn() {
  const btn = document.createElement('button');
  btn.className   = 'sc-btn';
  btn.id          = 'cs-maximize-btn';
  btn.title       = 'Maximize';
  btn.textContent = '⤢';
  return btn;
}

export function createMinimizeBtn() {
  const btn = document.createElement('button');
  btn.className   = 'sc-btn';
  btn.id          = 'cs-minimize-btn';
  btn.title       = 'Minimize';
  btn.textContent = '−';
  return btn;
}

// ── Copy-button click handler ──────────────────────────
// Returns true if the click was handled (caller should return early).
export function handleCopyClick(e) {
  const copyBtn = e.target.closest('.cs-copy-btn');
  if (!copyBtn) return false;
  const code = copyBtn.closest('.cs-code-wrap')?.querySelector('code')?.textContent ?? '';
  navigator.clipboard?.writeText(code).then(() => {
    copyBtn.innerHTML = ICON_CHECK;
    copyBtn.classList.add('lus-copy-btn--done');
    setTimeout(() => {
      copyBtn.innerHTML = ICON_COPY;
      copyBtn.classList.remove('lus-copy-btn--done');
    }, 1500);
  });
  return true;
}

// ── Plot-run click handler factory ─────────────────────
export function createPlotRunHandler(getBody, compile) {
  return async function(e) {
    const btn = e.target.closest('.output-plot-run');
    if (!btn) return;
    const plotDiv = btn.closest('.output-plot');
    const body    = getBody();
    const setup   = decodeURIComponent(body?.dataset.plotSetup ?? '');
    const code    = (setup ? setup + '\n' : '') + decodeURIComponent(plotDiv.dataset.plotCode ?? '');
    btn.disabled    = true;
    btn.textContent = '⟳';
    try {
      const outputs = await compile(code, 'python');
      const images  = outputs.filter(o => o.type === 'image');
      if (images.length) {
        plotDiv.classList.add('output-plot--rendered');
        plotDiv.innerHTML = images.map(img =>
          `<img src="data:image/png;base64,${img.content}" class="output-plot-img" alt="">`
        ).join('');
      } else {
        btn.textContent = '▷';
        btn.disabled    = false;
      }
    } catch (_) {
      btn.textContent = '▷';
      btn.disabled    = false;
    }
  };
}

// ── JSON renderer ──────────────────────────────────────
export function renderJson(data, body) {
  const { title, setup, blocks = [] } = data;
  let html = '';

  if (title) {
    html += `<h1 class="content-title">${escapeHtml(title)}</h1>`;
  }

  if (setup) {
    html += `
      <section class="card" id="setup">
        <h2>Setup</h2>
        <div class="cs-code-wrap"><pre class="code-block"><code>${escapeHtml(setup.trim())}</code></pre>${COPY_BTN}</div>
      </section>`;
  }

  for (const block of blocks) {
    const id       = (block.label ?? '').toLowerCase().replace(/\s+/g, '-');
    const examples = block.examples ?? (block.code ? [{ code: block.code, result: block.result, resultType: block.resultType }] : []);

    // Optional intro paragraph
    const introHtml = block.intro
      ? `<p class="card-intro">${escapeHtml(block.intro)}</p>`
      : '';

    // Optional callout / note box
    const noteHtml = block.note
      ? `<div class="card-note"><span class="card-note-icon">💡</span><span>${escapeHtml(block.note)}</span></div>`
      : '';

    // Optional bullet list
    const itemsHtml = block.items?.length
      ? `<ul class="card-items">${block.items.map(it => `<li>${escapeHtml(it)}</li>`).join('')}</ul>`
      : '';

    const exHtml = examples.map(ex => {
      let resultHtml = '';
      if (ex.result) {
        if (ex.resultType === 'text') {
          resultHtml = `<pre class="output-preview">${escapeHtml(ex.result)}</pre>`;
        } else if (ex.resultType === 'plot') {
          const enc = encodeURIComponent(ex.code ?? '');
          resultHtml = `<div class="output-plot" data-plot-code="${enc}">` +
            `<span class="output-plot-label">${escapeHtml(ex.result)}</span>` +
            `<button class="output-plot-run" title="Run and show plot">▷</button></div>`;
        } else {
          resultHtml = `<div class="expression">\\[${ex.result}\\]</div>`;
        }
      }
      // Optional per-example description
      const exDesc = ex.desc ? `<p class="ex-desc">${escapeHtml(ex.desc)}</p>` : '';
      return `
        <div class="example-pair">
          ${exDesc}
          <div class="cs-code-wrap"><pre class="code-block"><code>${escapeHtml(ex.code ?? '')}</code></pre>${COPY_BTN}</div>
          ${resultHtml}
        </div>`;
    }).join('');

    html += `
      <section class="card" id="${id}">
        <h2>${escapeHtml(block.label ?? '')}</h2>
        ${introHtml}${noteHtml}${itemsHtml}${exHtml}
      </section>`;
  }

  body.innerHTML = html;
  body.dataset.plotSetup = encodeURIComponent(data.setup ?? '');

  if (window.MathJax?.typesetPromise) {
    MathJax.typesetPromise([body]);
  }
}
