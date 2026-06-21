import { ask, systemRefactorForLang } from '../../../ai/ai_client.js';

/**
 * Creates a "Refactor" button for the AI explanation label.
 *
 * @param {object} opts
 * @param {string}  opts.sourceCode   — original code that was run
 * @param {string}  opts.sourceLang   — language (python / latex / etc.)
 * @param {string}  opts.cellId       — '__standalone__' or notebook cell UUID
 * @param {string}  opts.explanation  — raw AI explanation text (from the suggestion box)
 */
export function createRefactorBtn({ sourceCode, sourceLang, cellId, explanation, dfContext = '' }) {
  const btn = document.createElement('button');
  btn.className = 'refactor-btn';
  btn.title = 'Fix and refactor the code based on this AI suggestion';
  btn.textContent = '⟳ Refactor';

  btn.addEventListener('click', async () => {
    if (!sourceCode) return;
    btn.disabled = true;
    btn.innerHTML = '<span class="status-spinner"><i></i><i></i><i></i></span> Refactoring';

    try {
      const prompt =
        `Error / issue:\n${explanation}\n\n` +
        `Full source code (${sourceLang}):\n${sourceCode}` +
        (dfContext ? `\n\n${dfContext.trim()}` : '');

      const raw = await ask(prompt, systemRefactorForLang(sourceLang), 4096);

      const code = raw
        .replace(/^```[\w]*\s*\n?/m, '')
        .replace(/\n?```\s*$/m, '')
        .trim();

      document.dispatchEvent(new CustomEvent('refactor-code', {
        detail: { code, cellId, lang: sourceLang },
      }));

      btn.textContent = '✓ Applied';
      btn.classList.add('refactor-btn--applied');

      // Run button appears right after "✓ Applied"
      const runBtn = document.createElement('button');
      runBtn.className = 'refactor-run-btn';
      runBtn.title = 'Run the refactored code';
      runBtn.innerHTML = '⟳ Re-try';
      runBtn.addEventListener('click', () => {
        document.dispatchEvent(new CustomEvent('ai-insert-and-run', {
          detail: { code, cellId },
        }));
      });
      btn.insertAdjacentElement('afterend', runBtn);

    } catch (e) {
      btn.textContent = '✗ Failed';
      btn.disabled = false;
      btn.title = e.message;
    }
  });

  return btn;
}
