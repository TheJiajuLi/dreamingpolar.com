import { visualiseVar, previewClean, applyClean } from '../../compiler/compiler.js';

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

export function renderBlocks(outputs, container, { onAskAI } = {}) {
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
          block.innerHTML = `<pre class="output-text">${escHtml(o.content)}</pre>`;
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
      case 'image':
        block.className += ' output-image';
        block.innerHTML = `<img src="data:image/png;base64,${o.content}" alt="Plot">`;
        break;
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
        const kindLabel = { dataframe: 'DataFrame', series: 'Series', ndarray: 'ndarray' }[o.kind] ?? o.kind;

        // ── Header row ────────────────────────────────────────────────────────
        const header = document.createElement('div');
        header.className = 'viz-suggest-header';

        const icon = document.createElement('span');
        icon.className = 'viz-suggest-icon';
        icon.textContent = '◈';

        const label = document.createElement('span');
        label.className = 'viz-suggest-label';
        label.textContent = o.varName;
        const meta = document.createElement('span');
        meta.className = 'viz-suggest-meta';
        meta.textContent = ` ${kindLabel}  ${o.shape ?? ''}`;
        label.appendChild(meta);

        const vizBtn = document.createElement('button');
        vizBtn.className = 'viz-suggest-btn';
        vizBtn.type = 'button';
        vizBtn.textContent = '可视化';
        vizBtn.addEventListener('click', async () => {
          vizBtn.disabled = true;
          vizBtn.textContent = '生成中…';
          try {
            const img = await visualiseVar(o.varName);
            const imgBlock = document.createElement('div');
            imgBlock.className = 'output-block output-image';
            const image = document.createElement('img');
            image.src = `data:image/png;base64,${img}`;
            image.alt = o.varName;
            imgBlock.appendChild(image);
            block.insertAdjacentElement('afterend', imgBlock);
            block.style.display = 'none';
          } catch (err) {
            console.warn('[viz-suggestion] chart failed:', err);
            vizBtn.textContent = '生成失败';
            vizBtn.disabled = false;
          }
        });

        header.append(icon, label, vizBtn);

        // ── 清洗 panel (DataFrame only) ───────────────────────────────────────
        if (o.kind === 'dataframe') {
          const cleanBtn = document.createElement('button');
          cleanBtn.className = 'viz-suggest-btn';
          cleanBtn.type = 'button';
          cleanBtn.textContent = '清洗';

          const cleanPanel = document.createElement('div');
          cleanPanel.className = 'viz-clean-panel';
          cleanPanel.hidden = true;

          // Helper: build one operation row
          function _makeCleanRow(label, op) {
            const row = document.createElement('div');
            row.className = 'viz-clean-row';

            const rowLabel = document.createElement('span');
            rowLabel.className = 'viz-clean-label';
            rowLabel.textContent = label;

            const checkBtn = document.createElement('button');
            checkBtn.className = 'viz-clean-action-btn';
            checkBtn.textContent = '检查影响';

            const previewEl = document.createElement('span');
            previewEl.className = 'viz-clean-preview';

            const confirmBtn = document.createElement('button');
            confirmBtn.className = 'viz-clean-action-btn viz-clean-confirm-btn';
            confirmBtn.textContent = '确认执行';
            confirmBtn.hidden = true;

            let _pendingCols = null; // for date_fmt

            checkBtn.addEventListener('click', async () => {
              checkBtn.disabled = true;
              previewEl.textContent = '检查中…';
              confirmBtn.hidden = true;
              _pendingCols = null;
              try {
                const info = await previewClean(o.varName, op);
                if (op === 'dropna') {
                  if (info.affected === 0) {
                    previewEl.textContent = '无全空行，无需操作';
                    previewEl.className = 'viz-clean-preview viz-clean-ok';
                  } else {
                    previewEl.textContent = `将删除 ${info.affected} 行全空行（共 ${info.total} 行）`;
                    previewEl.className = 'viz-clean-preview viz-clean-warn';
                    confirmBtn.hidden = false;
                  }
                } else if (op === 'drop_dup') {
                  if (info.affected === 0) {
                    previewEl.textContent = '无重复行，无需操作';
                    previewEl.className = 'viz-clean-preview viz-clean-ok';
                  } else {
                    previewEl.textContent = `将删除 ${info.affected} 行重复行（共 ${info.total} 行）`;
                    previewEl.className = 'viz-clean-preview viz-clean-warn';
                    confirmBtn.hidden = false;
                  }
                } else if (op === 'date_fmt') {
                  if (!info.candidates?.length) {
                    previewEl.textContent = '未检测到日期列';
                    previewEl.className = 'viz-clean-preview viz-clean-ok';
                  } else {
                    _pendingCols = info.candidates.map(c => c.col);
                    previewEl.textContent = `将统一列：${_pendingCols.join('、')}`;
                    previewEl.className = 'viz-clean-preview viz-clean-warn';
                    confirmBtn.hidden = false;
                  }
                }
              } catch (e) {
                previewEl.textContent = `检查失败：${e.message}`;
                previewEl.className = 'viz-clean-preview viz-clean-err';
                console.warn('[clean preview]', op, e);
              } finally {
                checkBtn.disabled = false;
              }
            });

            confirmBtn.addEventListener('click', async () => {
              confirmBtn.disabled = true;
              previewEl.textContent = '执行中…';
              try {
                const res = await applyClean(o.varName, op, _pendingCols);
                if (op === 'dropna' || op === 'drop_dup') {
                  previewEl.textContent = `✓ 完成，${res.before} → ${res.after} 行`;
                  previewEl.className = 'viz-clean-preview viz-clean-ok';
                } else if (op === 'date_fmt') {
                  const okMsg = res.applied?.length ? `✓ 已统一：${res.applied.join('、')}` : '';
                  const errMsg = res.errors?.map(e => `✗ ${e.col}：${e.err}`).join('；') ?? '';
                  previewEl.textContent = [okMsg, errMsg].filter(Boolean).join('  ');
                  previewEl.className = res.errors?.length
                    ? 'viz-clean-preview viz-clean-warn'
                    : 'viz-clean-preview viz-clean-ok';
                }
                // Refresh shape in meta
                meta.textContent = ` ${kindLabel}  (已更新)`;
              } catch (e) {
                previewEl.textContent = `执行失败：${e.message}`;
                previewEl.className = 'viz-clean-preview viz-clean-err';
                console.warn('[clean apply]', op, e);
              } finally {
                confirmBtn.disabled = false;
                confirmBtn.hidden = true;
              }
            });

            row.append(rowLabel, checkBtn, previewEl, confirmBtn);
            return row;
          }

          cleanPanel.append(
            _makeCleanRow('删除全空行', 'dropna'),
            _makeCleanRow('删除重复行', 'drop_dup'),
            _makeCleanRow('统一日期格式', 'date_fmt'),
          );

          cleanBtn.addEventListener('click', () => {
            cleanPanel.hidden = !cleanPanel.hidden;
            cleanBtn.textContent = cleanPanel.hidden ? '清洗' : '收起';
          });

          header.append(cleanBtn);
          block.append(header, cleanPanel);
        } else {
          block.append(header);
        }

        break;
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
