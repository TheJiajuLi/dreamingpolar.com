import { compile }                              from '../../compiler/compiler.js';
import { handleCopyClick, createPlotRunHandler } from './content_screen_utility.js';

export const CONTENT_PATH_KEY  = 'dreaming-polar-content-path';
export const CONTENT_TITLE_KEY = 'dreaming-polar-content-title';
export const CONTENT_CHAT_KEY  = 'dp-cs-chat-open';

export function attachContentScreenHooks(hero, maximizeBtn, getBody) {
  const onPlotRun = createPlotRunHandler(getBody, compile);

  hero.addEventListener('click', async e => {
    if (handleCopyClick(e)) return;
    await onPlotRun(e);
  });

  function syncBtn(state) {
    maximizeBtn.textContent = state === 'maximized' ? '⤡' : '⤢';
  }

  requestAnimationFrame(() => {
    window.screenController?.register('content', hero, { onStateChange: syncBtn, label: 'Content', persisted: true });
    maximizeBtn.addEventListener('click', () => window.screenController?.toggle('content'));
  });
}

export function restoreLastContent() {
  const savedPath  = localStorage.getItem(CONTENT_PATH_KEY);
  const savedTitle = localStorage.getItem(CONTENT_TITLE_KEY) || null;
  if (savedPath) {
    requestAnimationFrame(() => window.contentScreen?.renderFromJson(savedPath, { openScreen: false, title: savedTitle }));
  }
}
