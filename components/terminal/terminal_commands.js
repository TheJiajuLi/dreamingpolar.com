// ── Dreaming Polar terminal command registry ───────────────
// Handlers may be async. executeCommand awaits them so async commands work.

import { runAiPrompt, askConfirm } from './terminal_ai.js';
import { getCacheEntries, clearAllCaches, exportCacheJson } from '../storage_controller/storage_controller.js';

const _registry = new Map();

export function registerCommand(name, handler) {
  _registry.set(name.toLowerCase(), handler);
}

export async function executeCommand(line, print) {
  const trimmed = line.trim();
  if (!trimmed) return;

  // Support both "ai prompt text" and "ai<prompt text>" syntax
  let cmd, args;
  const angleMatch = trimmed.match(/^([a-zA-Z_-]+)<(.+)>$/s);
  if (angleMatch) {
    cmd  = angleMatch[1];
    args = angleMatch[2].trim().split(/\s+/);
  } else {
    [cmd, ...args] = trimmed.split(/\s+/);
  }

  const handler = _registry.get(cmd.toLowerCase());
  if (!handler) {
    print(`Unknown command: ${cmd}. Type 'help' for a list.`);
    return;
  }

  await handler(args, print);
}

export function commandList() {
  return [..._registry.keys()].sort();
}

// ── Built-in commands ──────────────────────────────────────

registerCommand('help', (args, print) => {
  print('\x1b[36mARIA\x1b[0m — AI-powered interactive terminal');
  print('');
  print('\x1b[1mCore commands:\x1b[0m');
  print('  \x1b[36mai <task>\x1b[0m      — ask ARIA anything; generates code cards you can run/edit/insert');
  print('  \x1b[36mfix\x1b[0m            — ARIA analyses + fixes bugs in your editor code');
  print('  \x1b[36mexplain\x1b[0m        — ARIA explains your editor code line by line');
  print('  \x1b[36mrun\x1b[0m            — run the current editor code, show output here');
  print('');
  print('\x1b[1mNavigation:\x1b[0m');
  print('  open / close / fullscreen <screen>   screens: content · code · compiling');
  print('  screens   — list all screen states');
  print('  clear     — clear terminal output');
  print('  cache     — list · export · reset cached data');
  print('');
  print('\x1b[2mTip: press Esc to exit AI chat mode.\x1b[0m');
});

registerCommand('clear', () => {
  throw '__CLEAR__';
});

// ── AI command ─────────────────────────────────────────────
//  Usage:
//    ai                          → show prompt hint
//    ai <description>            → auto-routes: text reply in terminal or code in panel
//    ai<description>             → same, angle-bracket style

let _aiPendingPrompt = false;

registerCommand('ai', async (args, print) => {
  if (!args.length) {
    _aiPendingPrompt = true;
    print('\x1b[36mARIA — type your task and press Enter:\x1b[0m');
    return;
  }

  _aiPendingPrompt = false;
  await runAiPrompt(args.join(' '), print);
});

// ── fix — ARIA debugs & rewrites editor code ───────────────

registerCommand('fix', async (args, print) => {
  const ed = document.querySelector('#generative-screen .code-editor');
  const code = ed?.value?.trim();
  if (!code) { print('\x1b[33m⚠ Editor is empty — write some code first.\x1b[0m'); return; }
  print('\x1b[2m⚙ Sending code to ARIA for debugging…\x1b[0m');
  await runAiPrompt(
    `Please find and fix all bugs and issues in this Python code. Provide the corrected version:\n\`\`\`python\n${code}\n\`\`\``,
    print
  );
});

// ── explain — ARIA explains editor code ────────────────────

registerCommand('explain', async (args, print) => {
  const ed = document.querySelector('#generative-screen .code-editor');
  const code = ed?.value?.trim();
  if (!code) { print('\x1b[33m⚠ Editor is empty — write some code first.\x1b[0m'); return; }
  print('\x1b[2m⚙ ARIA is analysing your code…\x1b[0m');
  await runAiPrompt(
    `Explain this Python code clearly and concisely — what it does, how it works, and any important patterns:\n\`\`\`python\n${code}\n\`\`\``,
    print
  );
});

// ── run — compile + run editor code, output in terminal ────

registerCommand('run', (args, print) => {
  const ed = document.querySelector('#generative-screen .code-editor');
  const code = ed?.value?.trim();
  if (!code) { print('\x1b[33m⚠ Editor is empty.\x1b[0m'); return; }
  document.dispatchEvent(new CustomEvent('aria-run-editor-code', { detail: { code } }));
  print('\x1b[2m▶ Running editor code…\x1b[0m');
});

export function consumeAiPending(line, print) {
  if (!_aiPendingPrompt) return false;
  _aiPendingPrompt = false;
  runAiPrompt(line.trim(), print);
  return true;
}

// ── Screen commands ────────────────────────────────────────

const SCREEN_ALIASES = {
  content:   'content-screen',
  code:      'coding-screen',
  coding:    'coding-screen',
  compile:   'compiling-screen',
  compiling: 'compiling-screen',
  output:    'compiling-screen',
  terminal:  'terminal',
};

function resolveScreen(arg) {
  if (!arg) return null;
  return SCREEN_ALIASES[arg.toLowerCase()] ?? arg;
}

registerCommand('fullscreen', (args, print) => {
  const id = resolveScreen(args[0]);
  if (!id) { print('Usage: fullscreen <content|coding|compiling>'); return; }
  window.screenController?.maximize?.(id) ?? window.screenController?.open?.(id);
  print(`Fullscreen → ${id}`);
});

registerCommand('open', (args, print) => {
  const id = resolveScreen(args[0]);
  if (!id) { print('Usage: open <content|coding|compiling|terminal>'); return; }
  window.screenController?.open(id);
  print(`Opened → ${id}`);
});

registerCommand('close', (args, print) => {
  const id = resolveScreen(args[0]);
  if (!id) { print('Usage: close <content|coding|compiling|terminal>'); return; }
  window.screenController?.close(id);
  print(`Closed → ${id}`);
});

registerCommand('escape', (args, print) => {
  const sc = window.screenController;
  if (!sc) return;
  ['content-screen', 'coding-screen', 'compiling-screen'].forEach(id => {
    if (sc.getState?.(id) === 'maximized') sc.restore?.(id) ?? sc.open?.(id);
  });
  print('Restored screens.');
});

registerCommand('screens', (args, print) => {
  const sc = window.screenController;
  if (!sc) { print('No screen controller found.'); return; }
  print('Screen states:');
  const ids = ['content-screen', 'coding-screen', 'compiling-screen', 'terminal'];
  for (const id of ids) {
    const state = sc.getState?.(id) ?? 'unknown';
    print(`  ${state === 'normal' ? '●' : '○'} ${id.padEnd(20)} ${state}`);
  }
});

// ── Cache command ──────────────────────────────────────────
//  cache          → same as cache list
//  cache list     → show all DP cache entries with key, store, and size
//  cache export   → print full JSON to terminal + expose on window for copy
//  cache reset    → y/n confirmation, then wipes all DP caches and reloads

registerCommand('cache', async (args, print) => {
  const sub = (args[0] ?? 'list').toLowerCase();

  if (sub === 'list') {
    const entries = getCacheEntries();
    if (!entries.length) { print('No DP cache entries found.'); return; }
    print(`DP cache  (${entries.length} entries):`);
    print('');
    for (const { key, store, bytes } of entries) {
      const size = bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
      const tag  = store === 'localStorage' ? '\x1b[2mls\x1b[0m' : '\x1b[2mss\x1b[0m';
      print(`  ${tag}  \x1b[36m${key}\x1b[0m  \x1b[2m${size}\x1b[0m`);
    }
    print('');
    print('\x1b[2mSubcommands: cache list · cache export · cache reset\x1b[0m');
    return;
  }

  if (sub === 'export') {
    const json = exportCacheJson();
    print('DP cache export:');
    print('');
    for (const ln of json.split('\n')) print(ln);
    print('');
    window.__dpCacheExport = json;
    print('\x1b[2m(also stored at window.__dpCacheExport — paste into browser console to copy)\x1b[0m');
    return;
  }

  if (sub === 'reset') {
    const entries = getCacheEntries();
    print(`\x1b[33m将清除 ${entries.length} 条 DP 缓存记录（主题、代码、历史记录等）\x1b[0m`);
    const ok = await askConfirm('\x1b[33m确认清除所有 DP 缓存？(y/n)\x1b[0m', print);
    if (!ok) { print('\x1b[2m✕ 已取消\x1b[0m'); return; }
    clearAllCaches();
    print('\x1b[32m✓ 所有 DP 缓存已清除，页面将在 2 秒后刷新…\x1b[0m');
    setTimeout(() => location.reload(), 2000);
    return;
  }

  print('Usage: cache [list | export | reset]');
  print('  list   — show all stored DP cache entries');
  print('  export — print full cache JSON to terminal');
  print('  reset  — clear all DP caches (with y/n confirmation)');
});
