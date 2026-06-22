import { visualiseVar, previewClean, applyClean, exportDataFrame, diagnoseChart } from '../../compiler/compiler.js';
import { downloadBlob, MIME } from '../../shared/file_download.js';

export function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function looksLikeLatex(s) {
  if (!s || s.length > 500) return false;
  const t = s.trim();
  if (/^(\$\$|\\begin\{|\\\[|\\\()/.test(t)) return true;
  return /\\(frac|sqrt|sum|int|prod|lim|alpha|beta|gamma|delta|sigma|mu|pi|tau|theta|phi|psi|omega|partial|nabla|infty|cdot|times|text|mathbb|mathbf|mathrm)\b/.test(t);
}

export function parseAIResponse(text) {
  const blocks = [];
  const parts = text.split(/(```[\w]*\n[\s\S]*?```)/g);
  for (const part of parts) {
    const fenceMatch = part.match(/^```([\w]*)\n([\s\S]*?)```$/);
    if (fenceMatch) {
      const lang = fenceMatch[1].toLowerCase();
      const code = fenceMatch[2].trimEnd();
      blocks.push(lang === 'latex' || lang === 'mathjax'
        ? { type: 'latex', content: code }
        : { type: 'text',  content: code });
    } else if (part.trim()) {
      const html = escHtml(part.trim()).replace(/\n/g, '<br>');
      blocks.push({ type: 'html', content: `<span class="ai-prose">${html}</span>` });
    }
  }
  return blocks.length
    ? blocks
    : [{ type: 'html', content: `<span class="ai-prose">${escHtml(text).replace(/\n/g, '<br>')}</span>` }];
}

export function renderBlocks(outputs, container, { onAskAI, chartContainer } = {}) {
  const mathBlocks = [];

  for (const o of outputs) {
    if (o.type === 'missing-package') continue; // handled by bottom-bar prompt, not rendered here

    const block = document.createElement('div');
    block.className = 'output-block';

    switch (o.type) {
      case 'text': {
        const t = o.content.trim();
        if (looksLikeLatex(t)) {
          block.className += ' output-latex';
          const wrapped = /^(\\\[|\\\(|\$\$|\\begin\{)/.test(t) ? t : `\\[${t}\\]`;
          block.textContent = wrapped;
          mathBlocks.push(block);
        } else {
          // Separate the pandas metadata line "[N rows x M cols]" for subdued styling
          const metaRe = /\n(\[[\d,]+ rows [×x] [\d,]+ columns?\])\s*$/;
          const metaMatch = o.content.match(metaRe);
          if (metaMatch) {
            const mainText = o.content.slice(0, o.content.lastIndexOf(metaMatch[0]));
            const wrap = document.createElement('div');
            wrap.className = 'output-text-wrap';
            const pre = document.createElement('pre');
            pre.className = 'output-text';
            pre.textContent = mainText.replace(/\n$/, '');
            const meta = document.createElement('span');
            meta.className = 'output-text-meta';
            meta.textContent = metaMatch[1];
            wrap.append(pre, meta);
            block.appendChild(wrap);
          } else {
            const wrap = document.createElement('div');
            wrap.className = 'output-text-wrap';
            const pre = document.createElement('pre');
            pre.className = 'output-text';
            pre.textContent = o.content;
            wrap.appendChild(pre);
            block.appendChild(wrap);
          }
        }
        break;
      }
      case 'error': {
        block.innerHTML = `<pre class="output-error">${escHtml(o.content)}</pre>`;
        if (onAskAI) {
          const btn = document.createElement('button');
          btn.className = 'ask-ai-btn';
          btn.textContent = 'AI debug';
          btn.addEventListener('click', () => onAskAI(o.content, block, btn));
          block.appendChild(btn);
        }
        break;
      }
      case 'info':
        block.innerHTML = `<div class="output-info">${escHtml(o.content)}</div>`;
        break;
      case 'image': {
        block.className += ' output-image';
        block.innerHTML = `<img src="data:image/png;base64,${o.content}" alt="Plot">`;
        const imgTarget = chartContainer ?? container;
        imgTarget.appendChild(block);
        if (chartContainer) chartContainer.classList.add('has-chart');
        continue; // already appended, skip default append below
      }
      case 'chart-placeholder': {
        // Shown when a chart output was saved to localStorage but image data was stripped.
        block.className += ' output-chart-placeholder';
        block.innerHTML = `<span class="chart-placeholder-text"><i class="ti ti-refresh" style="font-size:11px;vertical-align:middle"></i> 运行该 cell 即可重新生成图表</span>`;
        const phTarget = chartContainer ?? container;
        phTarget.appendChild(block);
        if (chartContainer) chartContainer.classList.add('has-chart');
        continue;
      }
      case 'cell-separator':
        block.className = 'nb-output-separator';
        block.innerHTML = `<span class="nb-sep-label">${escHtml(o.label ?? '')}</span>`;
        break;
      case 'html':
        block.className += ' output-html';
        block.innerHTML = o.content;
        mathBlocks.push(block);
        break;
      case 'latex': {
        block.className += ' output-latex';
        const wrapped = /^(\\\[|\\\(|\$\$|\\begin\{)/.test(o.content)
          ? o.content
          : `\\[${o.content}\\]`;
        block.textContent = wrapped;
        mathBlocks.push(block);
        break;
      }
      case 'viz-suggestion': {
        block.className = 'output-block output-viz-suggestion';

        // ── Collapsible trigger row ───────────────────────────────────────────
        const trigger = document.createElement('div');
        trigger.className = 'vsug-trigger';

        const triggerLeft = document.createElement('div');
        triggerLeft.className = 'vsug-trigger-left';

        const chevron = document.createElement('i');
        chevron.className = 'ti ti-chevron-down vsug-chevron';

        const triggerIcon = document.createElement('i');
        triggerIcon.className = 'ti ti-adjustments-horizontal vsug-trigger-ti';

        const vizBtn = document.createElement('button');
        vizBtn.className = 'vsug-icon-btn vsug-viz-btn';
        vizBtn.type = 'button';
        vizBtn.title = '可视化';
        vizBtn.innerHTML = `<i class="ti ti-chart-line"></i>`;

        const nameEl = document.createElement('span');
        nameEl.className = 'vsug-name';
        nameEl.textContent = o.varName;
        const metaEl = document.createElement('span');
        metaEl.className = 'vsug-meta';
        metaEl.textContent = o.shape ?? '';

        // chevron left of adjustments icon — both animate together on expand/collapse
        triggerLeft.append(chevron, triggerIcon, nameEl, metaEl);

        const triggerRight = document.createElement('div');
        triggerRight.className = 'vsug-trigger-right';
        triggerRight.appendChild(vizBtn);

        trigger.append(triggerLeft, triggerRight);

        // ── Collapsible body ──────────────────────────────────────────────────
        const body = document.createElement('div');
        body.className = 'vsug-body';
        body.hidden = true;

        // Toggle collapse
        // Placeholder — reassigned inside the dataframe block below
        let _prefetchCounts = async () => {};

        trigger.addEventListener('click', e => {
          if (e.target.closest('.vsug-viz-btn')) return; // don't collapse on chart click
          const opening = body.hidden;
          body.hidden = !opening;
          chevron.classList.toggle('vsug-chevron--open', opening);
          if (opening) _prefetchCounts();
        });

        // ── Chart toggle (vizBtn in trigger) ──────────────────────────────────
        let _chartBlock = null;
        vizBtn.addEventListener('click', async () => {
          if (_chartBlock) {
            const hidden = _chartBlock.style.display === 'none';
            _chartBlock.style.display = hidden ? '' : 'none';
            vizBtn.classList.toggle('vsug-icon-btn--active', hidden);
            if (chartContainer) chartContainer.classList.toggle('has-chart', hidden);
            return;
          }
          vizBtn.disabled = true;
          vizBtn.classList.add('vsug-icon-btn--loading');
          try {
            const img = await visualiseVar(o.varName);
            _chartBlock = document.createElement('div');
            _chartBlock.className = 'output-block output-image';
            const image = document.createElement('img');
            image.src = `data:image/png;base64,${img}`;
            image.alt = o.varName;
            _chartBlock.appendChild(image);
            if (chartContainer) {
              chartContainer.appendChild(_chartBlock);
              chartContainer.classList.add('has-chart');
            } else {
              block.insertAdjacentElement('afterend', _chartBlock);
            }
            vizBtn.classList.remove('vsug-icon-btn--loading');
            vizBtn.classList.add('vsug-icon-btn--active');
            vizBtn.disabled = false;
          } catch (err) {
            vizBtn.classList.remove('vsug-icon-btn--loading');
            vizBtn.disabled = false;
            const isNoNumeric = String(err?.message ?? err).includes('__NO_NUMERIC__');
            const isNotReady  = err?.message === 'KERNEL_NOT_READY';

            _chartBlock = document.createElement('div');
            _chartBlock.className = 'vsug-no-chart-msg';

            // ── Helper: run cell → in-place replace error card with chart ────────
            // Never removes has-chart or _chartBlock from DOM — swaps content in-place.
            // This eliminates ALL collapse/expand flicker.
            const _runAndViz = (rb) => {
              const secEl  = _chartBlock.closest('[data-cell-id]');
              const cellId = secEl?.dataset?.cellId;
              if (!cellId) return;

              // Mark section: skip chartPane clear on next compile-result
              if (secEl) secEl.dataset.preserveChart = '1';

              // Show loading spinner in-place — error card stays in DOM, chartPane unchanged
              _chartBlock.innerHTML =
                `<div class="vsug-no-chart-loading">` +
                `<i class="ti ti-loader-2"></i>` +
                `</div>`;
              _chartBlock.style.cursor = 'default';
              _chartBlock.title = '';
              rb = null; // rb is now detached

              document.dispatchEvent(new CustomEvent('run-cell-by-id', { detail: { cellId } }));
              vizBtn.disabled = true;
              vizBtn.classList.add('vsug-icon-btn--loading');

              const _onDone = async ({ detail }) => {
                if (detail?.cellId !== cellId) return;
                document.removeEventListener('compile-result', _onDone);
                try {
                  const img = await visualiseVar(o.varName);
                  // Build image element and swap it for the error card in-place
                  const imgWrap = document.createElement('div');
                  imgWrap.className = 'output-block output-image';
                  const image = document.createElement('img');
                  image.src = `data:image/png;base64,${img}`;
                  image.alt = o.varName;
                  imgWrap.appendChild(image);
                  _chartBlock.replaceWith(imgWrap);   // ← atomic swap, no DOM height change
                  _chartBlock = imgWrap;
                  // chartPane already has has-chart — no need to touch it
                  vizBtn.classList.remove('vsug-icon-btn--loading');
                  vizBtn.classList.add('vsug-icon-btn--active');
                } catch (_) {
                  // Restore a minimal retry state without rebuilding the whole card
                  _chartBlock.innerHTML =
                    `<div class="vsug-error-icon-wrap"><i class="ti ti-chart-bar-off"></i></div>` +
                    `<div class="vsug-error-title">无法载入图表</div>`;
                  _chartBlock.style.cursor = 'pointer';
                  _chartBlock.title = '点击收起';
                }
                vizBtn.disabled = false;
              };
              document.addEventListener('compile-result', _onDone);
              setTimeout(() => {
                document.removeEventListener('compile-result', _onDone);
                vizBtn.disabled = false;
              }, 25000);
            };

            // ── Helper: build a compact secondary action button ────────────────
            const _makeActionBtn = (label, icon, bg) => {
              const rb = document.createElement('button');
              rb.className = 'vsug-error-action-btn';
              if (bg) rb.style.setProperty('--btn-bg', bg);
              rb.innerHTML = `<i class="ti ${icon}"></i><span>${label}</span>`;
              return rb;
            };

            if (isNotReady || (!isNoNumeric && diagnoseChart(o.varName).issue === 'not_found')) {
              // Kernel empty (e.g. after page refresh with cached outputs): auto-run without error card
              _chartBlock.innerHTML = `<div class="vsug-no-chart-loading"><i class="ti ti-loader-2"></i></div>`;
              const autoTarget = chartContainer ?? container;
              autoTarget.appendChild(_chartBlock);
              if (chartContainer) chartContainer.classList.add('has-chart');
              _runAndViz(null);
              return;

            } else if (isNoNumeric && o.sepHint) {
              const sepArg = o.sepHint === '\t' ? `sep='\\t'` : `sep=';'`;
              _chartBlock.innerHTML =
                `<div class="vsug-error-icon-wrap vsug-error-icon-wrap--warn"><i class="ti ti-file-alert"></i></div>` +
                `<div class="vsug-error-title">文件解析可能有误</div>` +
                `<div class="vsug-error-body">检测到数据集中在单列，分隔符可能不匹配。</div>`;
              const rb = _makeActionBtn(`修复分隔符 (${sepArg})`, 'ti-adjustments', '#d97706');
              rb.addEventListener('click', () => {
                document.dispatchEvent(new CustomEvent('sep-hint-reload', { detail: { varName: o.varName, sepArg } }));
                rb.innerHTML = `<i class="ti ti-check"></i><span>已插入修复代码</span>`; rb.disabled = true;
              });
              _chartBlock.appendChild(rb);

            } else if (isNoNumeric) {
              const diag = diagnoseChart(o.varName);
              if (diag.issue === 'date_as_text' && diag.dateCols.length) {
                const col = diag.dateCols[0];
                _chartBlock.innerHTML =
                  `<div class="vsug-error-icon-wrap vsug-error-icon-wrap--warn"><i class="ti ti-calendar-x"></i></div>` +
                  `<div class="vsug-error-title">日期列未转换</div>` +
                  `<div class="vsug-error-body">"${col}" 列为文本格式，无法用作时间轴。</div>`;
                const rb = _makeActionBtn(`转换 "${col}" 并重绘`, 'ti-bolt', '#d97706');
                rb.addEventListener('click', () => {
                  const cellId = _chartBlock.closest('[data-cell-id]')?.dataset?.cellId;
                  const patchCode = `import pandas as pd\n${o.varName}["${col}"] = pd.to_datetime(${o.varName}["${col}"])\n${o.varName} = ${o.varName}.set_index("${col}")`;
                  document.dispatchEvent(new CustomEvent('rb-insert-file', { detail: { code: patchCode } }));
                  if (cellId) _runAndViz(rb);
                });
                _chartBlock.appendChild(rb);
              } else {
                _chartBlock.innerHTML =
                  `<div class="vsug-error-icon-wrap"><i class="ti ti-chart-bar-off"></i></div>` +
                  `<div class="vsug-error-title">无数值列可绘制</div>` +
                  `<div class="vsug-error-body">图表需要数字类型列（如 price、count、score）。</div>`;
              }
            } else {
              // Generic — show run button
              _chartBlock.innerHTML =
                `<div class="vsug-error-icon-wrap"><i class="ti ti-chart-bar-off"></i></div>` +
                `<div class="vsug-error-title">无法载入图表</div>` +
                `<div class="vsug-error-body">此 Cell 需要重新运行以生成最新数据。</div>`;
              const rb = _makeActionBtn('重新运行 Cell', 'ti-player-play', 'var(--accent,#6366f1)');
              rb.addEventListener('click', () => _runAndViz(rb));
              _chartBlock.appendChild(rb);
            }
            const target = chartContainer ?? container;
            target.appendChild(_chartBlock);
            if (chartContainer) chartContainer.classList.add('has-chart');
            // Clicking the message itself triggers the same collapse as clicking vizBtn again
            _chartBlock.style.cursor = 'pointer';
            _chartBlock.title = '点击收起';
            _chartBlock.addEventListener('click', e => {
              if (e.target.closest('button')) return; // don't intercept button clicks
              vizBtn.click();
            });
          }
        });

        block.append(trigger);

        // ── Separator hint banner ─────────────────────────────────────────────
        if (o.sepHint) {
          const sepDisp = o.sepHint === '\t' ? '\\t' : o.sepHint;
          const sepArg  = o.sepHint === '\t' ? `sep='\\t'` : `sep=';'`;
          const hint = document.createElement('div');
          hint.className = 'vsug-sep-hint';

          const hintText = document.createElement('div');
          hintText.className = 'vsug-sep-hint-text';
          hintText.innerHTML =
            `<i class="ti ti-alert-triangle vsug-sep-hint-icon"></i>` +
            `检测到分隔符 <code>${sepDisp}</code>——数据未正确解析（全部挤在 1 列里）。`;

          const reloadBtn = document.createElement('button');
          reloadBtn.className = 'vsug-sep-reload-btn';
          reloadBtn.textContent = `重新导入 (${sepArg})`;
          reloadBtn.addEventListener('click', () => {
            // Dispatch event so the notebook can patch the active cell's code
            document.dispatchEvent(new CustomEvent('sep-hint-reload', {
              detail: { varName: o.varName, sepArg },
            }));
            hint.style.opacity = '0.5';
            reloadBtn.disabled = true;
            reloadBtn.textContent = '已插入代码 ↑';
          });

          hint.append(hintText, reloadBtn);
          block.appendChild(hint);
        }

        if (o.kind === 'dataframe') {
          // ── Clean section ─────────────────────────────────────────────────
          const cleanSection = document.createElement('div');
          cleanSection.className = 'vsug-section';

          const cleanTitle = document.createElement('div');
          cleanTitle.className = 'vsug-section-title';
          cleanTitle.textContent = '清洗';

          const cleanChipRow = document.createElement('div');
          cleanChipRow.className = 'vsug-chip-row';

          const cleanFeedback = document.createElement('div');
          cleanFeedback.className = 'vsug-feedback';
          cleanFeedback.hidden = true;

          const confirmRow = document.createElement('div');
          confirmRow.className = 'vsug-confirm-row';
          confirmRow.hidden = true;

          let _cleanPending = null;
          let _activeChip = null;
          let _counts = null; // cached { dropna, drop_dup }

          function _setFeedback(text, mod = '') {
            cleanFeedback.textContent = text;
            cleanFeedback.className = 'vsug-feedback' + (mod ? ` vsug-fb-${mod}` : '');
            cleanFeedback.hidden = !text;
          }

          // Pre-fetch empty/duplicate counts once when panel opens; cache result.
          // previewClean itself guards against uninitialized kernel — any error is silent.
          _prefetchCounts = async function() {
            if (_counts) return;
            try {
              const [na, dup] = await Promise.all([
                previewClean(o.varName, 'dropna'),
                previewClean(o.varName, 'drop_dup'),
              ]);
              _counts = { dropna: na.affected ?? 0, drop_dup: dup.affected ?? 0 };
              naChip._setBadge(_counts.dropna);
              dupChip._setBadge(_counts.drop_dup);
            } catch (_) { /* silent — kernel not ready or pandas not loaded */ }
          }

          function _makeCleanChip(icon, label, op) {
            const chip = document.createElement('button');
            chip.className = 'vsug-chip vsug-clean-chip';
            chip.type = 'button';

            const ico = document.createElement('i');
            ico.className = `ti ${icon}`;
            const lbl = document.createElement('span');
            lbl.textContent = label;

            // Badge for count (filled by _prefetchCounts)
            const badge = document.createElement('span');
            badge.className = 'vsug-badge';
            badge.hidden = true;
            chip._setBadge = (n) => { badge.textContent = n > 0 ? String(n) : ''; badge.hidden = n <= 0; };

            chip.append(ico, lbl, badge);

            chip.addEventListener('click', async () => {
              // Toggle selected state
              if (_activeChip && _activeChip !== chip) {
                _activeChip.classList.remove('vsug-chip--selected');
              }
              const selecting = !chip.classList.contains('vsug-chip--selected');
              chip.classList.toggle('vsug-chip--selected', selecting);
              _activeChip = selecting ? chip : null;

              if (!selecting) {
                _cleanPending = null;
                confirmRow.hidden = true;
                _setFeedback('');
                return;
              }

              _setFeedback('Checking…');
              _cleanPending = null;
              confirmRow.hidden = true;
              try {
                const info = await previewClean(o.varName, op);
                if (op === 'dropna') {
                  if (info.affected === 0) { _setFeedback('No empty rows — nothing to clean', 'ok'); chip.classList.remove('vsug-chip--selected'); _activeChip = null; }
                  else { _setFeedback(`${info.affected} empty rows will be removed (of ${info.total})`, 'warn'); _cleanPending = { op }; confirmRow.hidden = false; }
                } else if (op === 'drop_dup') {
                  if (info.affected === 0) { _setFeedback('No duplicates — nothing to clean', 'ok'); chip.classList.remove('vsug-chip--selected'); _activeChip = null; }
                  else { _setFeedback(`${info.affected} duplicate rows will be removed (of ${info.total})`, 'warn'); _cleanPending = { op }; confirmRow.hidden = false; }
                } else if (op === 'date_fmt') {
                  if (!info.candidates?.length) { _setFeedback('No date columns detected', 'ok'); chip.classList.remove('vsug-chip--selected'); _activeChip = null; }
                  else {
                    const cols = info.candidates.map(c => c.col);
                    _setFeedback(`Will normalize: ${cols.join(', ')}`, 'warn');
                    _cleanPending = { op, cols };
                    confirmRow.hidden = false;
                  }
                }
              } catch (e) {
                if (e?.message === 'KERNEL_NOT_READY') {
                  // Implicit chain: run cell → wait for DOM rebuild → find NEW chip → click it
                  _setFeedback('正在加载数据…', 'warn');
                  chip.disabled = true;
                  const secEl  = chip.closest('[data-cell-id]');
                  const cellId = secEl?.dataset?.cellId;
                  if (cellId) {
                    document.dispatchEvent(new CustomEvent('run-cell-by-id', { detail: { cellId } }));
                    const _onDone = ({ detail }) => {
                      if (detail?.cellId !== cellId) return;
                      document.removeEventListener('compile-result', _onDone);
                      // compile-result rebuilt the viz-suggestion card with NEW DOM nodes.
                      // Find the new chip by matching the op label, then click it.
                      const opLabel = { dropna: 'Empty rows', drop_dup: 'Duplicates', date_fmt: 'Date cols' }[op];
                      setTimeout(() => {
                        const newSec  = document.querySelector(`[data-cell-id="${cellId}"]`);
                        const newChip = newSec && [...newSec.querySelectorAll('.vsug-clean-chip')]
                          .find(c => c.querySelector('span')?.textContent === opLabel);
                        if (newChip && !newChip.disabled) {
                          // Expand the vsug body first if collapsed
                          const body = newChip.closest('.vsug-body');
                          if (body?.hidden) {
                            const trigger = body.previousElementSibling;
                            trigger?.click();
                          }
                          newChip.click();
                        }
                      }, 400); // wait for renderBlocks to finish
                    };
                    document.addEventListener('compile-result', _onDone);
                    setTimeout(() => {
                      document.removeEventListener('compile-result', _onDone);
                      chip.disabled = false;
                    }, 20000);
                  }
                } else {
                  _setFeedback(`Error: ${e.message}`, 'err');
                  console.warn('[clean preview]', op, e);
                }
              }
            });
            return chip;
          }

          const naChip  = _makeCleanChip('ti-eraser',          'Empty rows',  'dropna');
          const dupChip = _makeCleanChip('ti-copy',            'Duplicates',  'drop_dup');
          const dtChip  = _makeCleanChip('ti-calendar-event',  'Date cols',   'date_fmt');

          cleanChipRow.append(naChip, dupChip, dtChip);

          const applyBtn = document.createElement('button');
          applyBtn.className = 'vsug-apply-btn';
          applyBtn.type = 'button';
          applyBtn.textContent = 'Apply';

          const discardBtn = document.createElement('button');
          discardBtn.className = 'vsug-discard-btn';
          discardBtn.type = 'button';
          discardBtn.textContent = 'Cancel';

          discardBtn.addEventListener('click', () => {
            confirmRow.hidden = true;
            _setFeedback('');
            _cleanPending = null;
            if (_activeChip) { _activeChip.classList.remove('vsug-chip--selected'); _activeChip = null; }
          });

          applyBtn.addEventListener('click', async () => {
            if (!_cleanPending) return;
            applyBtn.disabled = true;
            _setFeedback('Applying…');
            try {
              const res = await applyClean(o.varName, _cleanPending.op, _cleanPending.cols ?? null);
              const { op } = _cleanPending;
              if (op === 'dropna' || op === 'drop_dup') {
                _setFeedback(`✓ Done — ${res.before} → ${res.after} rows`, 'ok');
              } else {
                const ok  = res.applied?.length ? `✓ Normalized: ${res.applied.join(', ')}` : '';
                const err = res.errors?.map(e => `✗ ${e.col}: ${e.err}`).join('; ') ?? '';
                _setFeedback([ok, err].filter(Boolean).join('  '), res.errors?.length ? 'warn' : 'ok');
              }
              metaEl.textContent = `${o.shape ?? ''} (updated)`;
              confirmRow.hidden = true;
              _cleanPending = null;
              _counts = null; // invalidate cache after mutation
              if (_activeChip) { _activeChip.classList.remove('vsug-chip--selected'); _activeChip = null; }
            } catch (e) {
              _setFeedback(`Error: ${e.message}`, 'err');
            } finally {
              applyBtn.disabled = false;
            }
          });

          confirmRow.append(applyBtn, discardBtn);
          cleanSection.append(cleanTitle, cleanChipRow, cleanFeedback, confirmRow);

          // ── Export section ────────────────────────────────────────────────
          const exportSection = document.createElement('div');
          exportSection.className = 'vsug-section vsug-section--export';

          const exportTitle = document.createElement('div');
          exportTitle.className = 'vsug-section-title';
          exportTitle.textContent = '导出为';

          const exportChipRow = document.createElement('div');
          exportChipRow.className = 'vsug-chip-row';

          const exportStatus = document.createElement('span');
          exportStatus.className = 'vsug-export-status';
          exportStatus.hidden = true;

          [
            { fmt: 'csv',  label: 'CSV',   ext: 'csv',  icon: 'ti-table' },
            { fmt: 'json', label: 'JSON',  ext: 'json', icon: 'ti-code' },
            { fmt: 'xlsx', label: 'Excel', ext: 'xlsx', icon: 'ti-file-spreadsheet' },
            { fmt: 'xml',  label: 'XML',   ext: 'xml',  icon: 'ti-file-code' },
          ].forEach(({ fmt, label, ext, icon }) => {
            const chip = document.createElement('button');
            chip.className = 'vsug-chip vsug-export-chip';
            chip.type = 'button';
            const ico = document.createElement('i');
            ico.className = `ti ${icon}`;
            const lbl = document.createElement('span');
            lbl.textContent = label;
            chip.append(ico, lbl);
            chip.addEventListener('click', async () => {
              chip.disabled = true;
              exportStatus.textContent = `Exporting ${label}…`;
              exportStatus.className = 'vsug-export-status';
              exportStatus.hidden = false;
              try {
                const { content, b64 } = await exportDataFrame(o.varName, fmt);
                downloadBlob(content, `${o.varName}.${ext}`, MIME[fmt] ?? 'application/octet-stream', b64);
                exportStatus.textContent = `✓ ${label} downloaded`;
                exportStatus.className = 'vsug-export-status vsug-fb-ok';
              } catch (err) {
                if (err?.message === 'KERNEL_NOT_READY') {
                  // Implicit chain: run cell → DOM rebuilt → find new export chip → click
                  exportStatus.textContent = '正在加载数据…';
                  const cellId = chip.closest('[data-cell-id]')?.dataset?.cellId;
                  if (cellId) {
                    document.dispatchEvent(new CustomEvent('run-cell-by-id', { detail: { cellId } }));
                    const _onDone = ({ detail }) => {
                      if (detail?.cellId !== cellId) return;
                      document.removeEventListener('compile-result', _onDone);
                      // compile-result rebuilt the viz card — find the new export chip by fmt label
                      setTimeout(() => {
                        const newSec  = document.querySelector(`[data-cell-id="${cellId}"]`);
                        const newChip = newSec && [...newSec.querySelectorAll('.vsug-export-chip')]
                          .find(c => c.querySelector('span')?.textContent === label);
                        if (newChip && !newChip.disabled) {
                          const body = newChip.closest('.vsug-body');
                          if (body?.hidden) body.previousElementSibling?.click();
                          newChip.click();
                        }
                      }, 400);
                    };
                    document.addEventListener('compile-result', _onDone);
                    setTimeout(() => { document.removeEventListener('compile-result', _onDone); chip.disabled = false; }, 20000);
                    return;
                  }
                } else {
                  exportStatus.textContent = `✗ ${err.message ?? '导出失败'}`;
                  exportStatus.className = 'vsug-export-status vsug-fb-err';
                  console.warn('[export]', fmt, err);
                }
              } finally {
                chip.disabled = false;
              }
            });
            exportChipRow.append(chip);
          });

          exportSection.append(exportTitle, exportChipRow, exportStatus);
          body.append(cleanSection, exportSection);
          block.append(body);
        }

        // Always in textPane — chartPane collapses and would hide the card
        container.appendChild(block);
        continue;
      }
      default:
        block.innerHTML = `<pre class="output-text">${escHtml(String(o.content))}</pre>`;
    }

    container.appendChild(block);
  }

  if (mathBlocks.length && window.MathJax) {
    const run = () => MathJax.typesetPromise(mathBlocks).catch(() => {});
    window.MathJax.startup?.promise ? MathJax.startup.promise.then(run) : run();
  }
}
