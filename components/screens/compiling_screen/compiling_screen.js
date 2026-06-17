import { createSourceWidget } from '../../look_up_source/look_up_source.js';
import { renderBlocks, escHtml } from './compiling_screen_utility.js';
import { persistOutputs, recoverOutputs, wipeOutputs } from './compiling_screen_hook.js';
import { getCellOrder } from '../../customise_code_block/customise_code_block.js';
import { ask, systemExplainForLang } from '../../ai/ai_client.js';
import { createRefactorBtn } from './refactorization_button/refactorization_button.js';

function parseAIResponse(text) {
  const blocks = [];
  // Split on ```lang\ncode\n``` fences
  const parts = text.split(/(```[\w]*\n[\s\S]*?```)/g);
  for (const part of parts) {
    const fenceMatch = part.match(/^```([\w]*)\n([\s\S]*?)```$/);
    if (fenceMatch) {
      const lang = fenceMatch[1].toLowerCase();
      const code = fenceMatch[2].trimEnd();
      if (lang === 'latex' || lang === 'mathjax') {
        blocks.push({ type: 'latex', content: code });
      } else {
        blocks.push({ type: 'text', content: code });
      }
    } else if (part.trim()) {
      // Plain prose — may contain inline LaTeX; output as html with escaping
      const html = escHtml(part.trim()).replace(/\n/g, '<br>');
      blocks.push({ type: 'html', content: `<span class="ai-prose">${html}</span>` });
    }
  }
  return blocks.length ? blocks : [{ type: 'html', content: `<span class="ai-prose">${escHtml(text).replace(/\n/g,'<br>')}</span>` }];
}

// ── Per-cell section map ──────────────────────────────
// cellId → { sectionEl, labelEl, bodyEl, outputs, sourceWidget }
const _sections = new Map();

// Current live notebook cell order — kept in sync via notebook-cells-reordered.
// Used to insert new output sections at the correct position instead of always
// appending, so orphaned sections from deleted cells don't displace active ones.
let _cellOrder = [];

// ── Persist ───────────────────────────────────────────
export function saveOutputs() {
  persistOutputs(_sections);
}

// ── Get or create a per-cell output section ───────────
export function getOrCreateSection(area, cellId, cellLabel) {
  if (_sections.has(cellId)) {
    const sec = _sections.get(cellId);
    if (cellLabel) sec.labelEl.querySelector('span').textContent = cellLabel;
    sec.bodyEl.innerHTML = '';
    return sec;
  }

  area.querySelector('.output-placeholder')?.remove();

  const sectionEl = document.createElement('div');
  sectionEl.className = 'cds-output-section';
  sectionEl.dataset.cellId = cellId;

  const labelEl = document.createElement('div');
  labelEl.className = 'cds-output-section-label';

  const labelInner = document.createElement('div');
  labelInner.className = 'cds-output-section-label-text';

  const labelText = document.createElement('span');
  labelText.textContent = cellLabel ?? '';
  labelInner.appendChild(labelText);

  const sourceWidget = createSourceWidget();
  labelInner.appendChild(sourceWidget.element);
  labelEl.appendChild(labelInner);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'cds-output-section-close';
  closeBtn.title = 'Dismiss (re-run cell to restore)';
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', () => {
    sectionEl.remove();
    _sections.delete(cellId);
    if (_sections.size === 0) {
      area.innerHTML = '<p class="output-placeholder">Run code to see output here.</p>';
    }
    saveOutputs();
  });
  labelEl.appendChild(closeBtn);

  const bodyEl = document.createElement('div');
  bodyEl.className = 'cds-output-section-body';

  sectionEl.append(labelEl, bodyEl);

  // Insert at the position matching the live cell order rather than appending.
  // Scan forward from this cell's index in _cellOrder and find the first
  // already-rendered section — insert before it. Falls back to append.
  let inserted = false;
  const pos = _cellOrder.indexOf(cellId);
  if (pos >= 0) {
    for (let i = pos + 1; i < _cellOrder.length; i++) {
      const nextSec = _sections.get(_cellOrder[i]);
      if (nextSec?.sectionEl.parentNode === area) {
        area.insertBefore(sectionEl, nextSec.sectionEl);
        inserted = true;
        break;
      }
    }
  }
  if (!inserted) area.appendChild(sectionEl);

  const sec = { sectionEl, labelEl, bodyEl, outputs: [], sourceWidget };
  _sections.set(cellId, sec);
  return sec;
}

// ── Main screen setup ─────────────────────────────────
export function setupCompilingScreen() {
  const screen = document.getElementById('compiling-screen');
  if (!screen) return;

  screen.innerHTML = `
    <div class="compiling-screen-header">
      <span class="compiling-screen-label">Output</span>
      <div class="sc-toolbar">
        <button class="sc-btn" id="cps-clear-btn" title="Clear output">⊘</button>
        <button class="sc-btn" id="cps-max-btn"   title="Maximize">⤢</button>
        <button class="sc-btn" id="cps-min-btn"   title="Minimize">−</button>
      </div>
    </div>
    <div class="compiling-screen-body" id="compiling-output-area">
      <p class="output-placeholder">Run code to see output here.</p>
    </div>
  `;

  const area     = document.getElementById('compiling-output-area');
  const clearBtn = document.getElementById('cps-clear-btn');
  const maxBtn   = document.getElementById('cps-max-btn');
  const minBtn   = document.getElementById('cps-min-btn');

  function syncBtn(state) {
    if (maxBtn) maxBtn.textContent = state === 'maximized' ? '⤡' : '⤢';
  }

  requestAnimationFrame(() => {
    window.screenController?.register('compiling', screen, { onStateChange: syncBtn, label: 'Output', persisted: true });
    maxBtn?.addEventListener('click', () => window.screenController?.toggle('compiling'));
    minBtn?.addEventListener('click', () => window.screenController?.minimize('compiling'));
  });

  clearBtn?.addEventListener('click', () => {
    area.innerHTML = '<p class="output-placeholder">Run code to see output here.</p>';
    _sections.clear();
    wipeOutputs();
  });

  // ── Seed cell order from the notebook's current state ─
  _cellOrder = getCellOrder();

  // ── Restore saved outputs on load ─────────────────────
  const saved = recoverOutputs();
  if (saved.length) {
    area.innerHTML = '';
    for (const { cellId, cellLabel: rawLabel, outputs, sourceCode, sourceLang } of saved) {
      if (!cellId || !Array.isArray(outputs) || !outputs.length) continue;
      const cellLabel = (rawLabel ?? '').replace(/\s*✕\s*$/, '');
      const sec = getOrCreateSection(area, cellId, cellLabel);
      sec.outputs    = outputs;
      sec.sourceCode = sourceCode ?? null;
      sec.sourceLang = sourceLang ?? null;
      if (sourceCode) sec.sourceWidget.setSource(sourceCode, sourceLang);
      renderBlocks(outputs, sec.bodyEl);
    }
    if (window.MathJax?.startup?.promise) {
      MathJax.startup.promise.then(() => MathJax.typesetPromise([area]).catch(() => {}));
    }
  }

  // ── Sync section order when cells are reordered ───────
  document.addEventListener('notebook-cells-reordered', ({ detail: { order } }) => {
    if (!Array.isArray(order)) return;
    _cellOrder = [...order];

    // Move section elements into the new order (appendChild moves existing nodes)
    order.forEach(cellId => {
      const sec = _sections.get(cellId);
      if (sec) area.appendChild(sec.sectionEl);
    });

    // Rebuild _sections Map in the same order so persistOutputs saves correctly
    const reordered = new Map();
    order.forEach(cellId => {
      if (_sections.has(cellId)) reordered.set(cellId, _sections.get(cellId));
    });
    // Preserve any sections not in the order array (e.g. __standalone__)
    _sections.forEach((sec, cellId) => {
      if (!reordered.has(cellId)) reordered.set(cellId, sec);
    });
    _sections.clear();
    reordered.forEach((sec, cellId) => _sections.set(cellId, sec));

    saveOutputs();
  });

  // ── Clear all sections (Run All start) ────────────────
  document.addEventListener('notebook-clear-output', () => {
    area.innerHTML = '';
    _sections.clear();
    wipeOutputs();
  });

  // ── New compile result ────────────────────────────────
  document.addEventListener('compile-result', ({ detail: { outputs, cellId, cellLabel, sourceCode, sourceLang } }) => {
    window.screenController?.ensureVisible('compiling');

    const id    = cellId    ?? '__standalone__';
    const label = cellLabel ?? 'Output';

    const sec = getOrCreateSection(area, id, label);
    sec.outputs    = outputs;
    sec.sourceCode = sourceCode ?? null;
    sec.sourceLang = sourceLang ?? null;
    if (sourceCode) sec.sourceWidget.setSource(sourceCode, sourceLang);
    renderBlocks(outputs, sec.bodyEl, {
      onAskAI: async (errorText, block, btn) => {
        btn.disabled = true;
        btn.textContent = 'Thinking…';
        try {
          const context = sec.sourceCode
            ? `Code (${sec.sourceLang ?? 'unknown'}):\n${sec.sourceCode}\n\nError:\n${errorText}`
            : errorText;
          const explanation = await ask(context, systemExplainForLang(sec.sourceLang), 512);

          const explDiv = document.createElement('div');
          explDiv.className = 'output-ai-explanation';

          // Label row: text + refactor button side by side
          const labelEl = document.createElement('div');
          labelEl.className = 'ai-explanation-label';

          const labelText = document.createElement('span');
          labelText.className = 'ai-explanation-label-text';
          labelText.textContent = 'AI suggestion';
          labelEl.appendChild(labelText);

          if (sec.sourceCode) {
            const refactorBtn = createRefactorBtn({
              sourceCode: sec.sourceCode,
              sourceLang: sec.sourceLang,
              cellId: id,
              explanation,
            });
            labelEl.appendChild(refactorBtn);
          }

          const bodyEl = document.createElement('div');
          bodyEl.className = 'ai-explanation-body';
          renderBlocks(parseAIResponse(explanation), bodyEl);

          explDiv.append(labelEl, bodyEl);
          block.appendChild(explDiv);
          btn.remove();
        } catch (e) {
          btn.textContent = `Error: ${e.message}`;
          btn.disabled = false;
        }
      },
    });
    requestAnimationFrame(() =>
      sec.sectionEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    );

    saveOutputs();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupCompilingScreen);
} else {
  setupCompilingScreen();
}
