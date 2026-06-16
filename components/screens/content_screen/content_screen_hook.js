import { compile }                              from '../../compiler/compiler.js';
import { handleCopyClick, createPlotRunHandler } from './content_screen_utility.js';

export const CONTENT_PATH_KEY  = 'dreaming-polar-content-path';
export const CONTENT_TITLE_KEY = 'dreaming-polar-content-title';
export const CONTENT_CHAT_KEY  = 'dp-cs-chat-open';

export function attachContentScreenHooks(hero, getBody) {
  const onPlotRun = createPlotRunHandler(getBody, compile);

  hero.addEventListener('click', async e => {
    if (handleCopyClick(e)) return;
    await onPlotRun(e);
  });

  requestAnimationFrame(() => {
    window.screenController?.register('content', hero, { label: 'Content', persisted: true, defaultOpen: true });
  });

  document.addEventListener('screen-opened', ({ detail }) => {
    if (detail.id === 'content') {
      const s = window.screenController?.getState('coding');
      if (s && s !== 'closed') window.screenController?.close('coding');
    }
  });

  document.addEventListener('screen-closed', ({ detail }) => {
    if (detail.id === 'coding') {
      const s = window.screenController?.getState('content');
      if (!s || s === 'closed' || s === 'minimized') window.screenController?.open('content');
    }
  });
}

export function restoreLastContent() {
  const savedPath  = localStorage.getItem(CONTENT_PATH_KEY);
  const savedTitle = localStorage.getItem(CONTENT_TITLE_KEY) || null;
  if (savedPath) {
    requestAnimationFrame(() => window.contentScreen?.renderFromJson(savedPath, { openScreen: false, title: savedTitle }));
  }
}
