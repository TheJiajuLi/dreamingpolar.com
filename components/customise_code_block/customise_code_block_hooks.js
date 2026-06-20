import { compile } from '../compiler/compiler.js';
import { getCurrentMode } from '../compiler/compiler_mode_switcher/compiler_mode_switcher.js';

// ── Per-cell hooks ─────────────────────────────────────────
// Called once per cell after all DOM elements are created.
export function attachCellHooks({
  sel, editor, runBtn, upBtn, downBtn, delBtn, copyBtn,
  cell, PLACEHOLDER, ICON_COPY, ICON_CHECK,
  autoResize, saveAll, rebuildCells, cellLabel,
  getCells, setCells, getRunSeq, bumpRunSeq,
  flushPendingInjects,
}) {
  sel.addEventListener('change', () => {
    cell.lang = sel.value;
    editor.placeholder = PLACEHOLDER[cell.lang] ?? '';
    saveAll();
  });

  editor.addEventListener('input', () => {
    autoResize(editor);
    saveAll();
  });

  editor.addEventListener('keydown', e => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = editor.selectionStart;
      editor.value = editor.value.slice(0, s) + '    ' + editor.value.slice(editor.selectionEnd);
      editor.selectionStart = editor.selectionEnd = s + 4;
      saveAll();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      runBtn.click();
    }
  });

  runBtn.addEventListener('click', async () => {
    const code = editor.value.trim();
    if (!code) return;

    if (cell.lang === 'python' && /\binput\s*\(/.test(code)) {
      document.dispatchEvent(new CustomEvent('run-in-terminal', { detail: { code } }));
      return;
    }

    cell.counter.textContent = '*';
    runBtn.disabled = true;
    await flushPendingInjects?.();
    const outputs = await compile(code, cell.lang);
    // If a missing-package was detected, signal the bottom bar so it can
    // offer to install it. The signal carries cellId so the bar can trigger
    // a re-run after a successful install.
    const missingPkg = outputs.find(o => o.type === 'missing-package');
    if (missingPkg) {
      document.dispatchEvent(new CustomEvent('package-missing', {
        detail: { pkg: missingPkg.pkg, cellId: cell.id },
      }));
    }
    runBtn.disabled = false;
    bumpRunSeq();
    cell.counter.textContent = getRunSeq();
    document.dispatchEvent(new CustomEvent('compile-result', {
      detail: { outputs, cellId: cell.id, cellLabel: cellLabel(cell), sourceCode: code, sourceLang: cell.lang }
    }));
  });

  upBtn.addEventListener('click', () => {
    const cells = getCells();
    const i = cells.indexOf(cell);
    if (i > 0) {
      [cells[i], cells[i - 1]] = [cells[i - 1], cells[i]];
      rebuildCells();
      saveAll();
    }
  });

  downBtn.addEventListener('click', () => {
    const cells = getCells();
    const i = cells.indexOf(cell);
    if (i < cells.length - 1) {
      [cells[i], cells[i + 1]] = [cells[i + 1], cells[i]];
      rebuildCells();
      saveAll();
    }
  });

  delBtn.addEventListener('click', () => {
    const cells = getCells();
    if (cells.length === 1) return;
    cell._outputAC?.abort();
    document.dispatchEvent(new CustomEvent('notebook-cell-deleted', { detail: { cellId: cell.id } }));
    setCells(cells.filter(c => c !== cell));
    rebuildCells();
    saveAll();
  });

  copyBtn.addEventListener('click', () => {
    navigator.clipboard?.writeText(editor.value).then(() => {
      copyBtn.innerHTML = ICON_CHECK;
      copyBtn.classList.add('lus-copy-btn--done');
      setTimeout(() => {
        copyBtn.innerHTML = ICON_COPY;
        copyBtn.classList.remove('lus-copy-btn--done');
      }, 1500);
    });
  });
}

// ── Add-button hook ────────────────────────────────────────
// Called once per add-row button.
export function attachAddBtnHook({ btn, insertIdx, makeCell, getCells, rebuildCells, saveAll }) {
  btn.addEventListener('click', () => {
    const c = makeCell('python', '');
    getCells().splice(insertIdx, 0, c);
    rebuildCells();
    c.editor.focus();
    requestAnimationFrame(() => c.el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
    saveAll();
  });
}

// ── Notebook-level hooks ───────────────────────────────────
// Called once from init(): wires the topbar and document events.
export function attachNotebookHooks({ runAllBtn, runAll, getCells, autoResize, saveAll }) {
  runAllBtn.addEventListener('click', () => runAll(runAllBtn));

  document.addEventListener('clear-active-code', () => {
    if (getCurrentMode() !== 'customise') return;
    getCells().forEach(c => {
      c.editor.value = '';
      c.editor.dispatchEvent(new Event('input'));
      autoResize(c.editor);
    });
    saveAll();
  });
}
