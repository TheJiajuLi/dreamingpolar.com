// components/language_selector/language_selector.js
// Translates all registered DOM nodes when the language changes, and
// automatically re-translates any element added to the DOM after init
// (covers components that render HTML after language_selector runs).

const LANGUAGES = [
  { id: 'en', label: 'English',  short: 'EN' },
  { id: 'zh', label: '中文',     short: '中' },
  { id: 'ja', label: '日本語',   short: '日' },
  { id: 'ko', label: '한국어',   short: '한' },
  { id: 'fr', label: 'Français', short: 'FR' },
  { id: 'it', label: 'Italiano', short: 'IT' },
  { id: 'es', label: 'Español',  short: 'ES' },
  { id: 'ru', label: 'Русский',  short: 'RU' },
];

const STORAGE_KEY = 'dreaming-polar-lang';

// ── Translations ───────────────────────────────────────
const T = {
  en: {
    nav:        'Navigation',
    pages:      'Pages',
    content:    'Content',
    code:       'Code',
    output:     'Output',
    chat:       'Chat',
    run:        'Run',
    idle:       'Idle — Python loads on first run.',
    out_hint:   'Run code to see output here.',
    placeholder:`# Example — try running this:
from sympy import symbols, expand, latex
x = symbols('x')
expand((x + 1)**4)

# SymPy, matplotlib, pandas & numpy are preloaded.
# Ctrl/Cmd+Enter to run.`,
  },
  zh: {
    nav:        '导航',
    pages:      '页面',
    content:    '内容',
    code:       '代码',
    output:     '输出',
    chat:       '聊天',
    run:        '运行',
    idle:       '空闲 — Python 在首次运行时加载。',
    out_hint:   '运行代码后，结果将显示在这里。',
    placeholder:`# 示例 — 试着运行这个：
from sympy import symbols, expand, latex
x = symbols('x')
expand((x + 1)**4)

# SymPy、matplotlib、pandas 和 numpy 已预加载。
# Ctrl/Cmd+Enter 运行。`,
  },
  ja: {
    nav:        'ナビゲーション',
    pages:      'ページ',
    content:    'コンテンツ',
    code:       'コード',
    output:     '出力',
    chat:       'チャット',
    run:        '実行',
    idle:       'アイドル — Python は初回実行時に読み込まれます。',
    out_hint:   'コードを実行すると、ここに結果が表示されます。',
    placeholder:`# 例 — 実行してみてください：
from sympy import symbols, expand, latex
x = symbols('x')
expand((x + 1)**4)

# SymPy、matplotlib、pandas、numpy がプリロードされています。
# Ctrl/Cmd+Enter で実行。`,
  },
  ko: {
    nav:        '탐색',
    pages:      '페이지',
    content:    '내용',
    code:       '코드',
    output:     '출력',
    chat:       '채팅',
    run:        '실행',
    idle:       '대기 중 — Python은 첫 실행 시 로드됩니다.',
    out_hint:   '코드를 실행하면 여기에 결과가 표시됩니다.',
    placeholder:`# 예시 — 실행해 보세요：
from sympy import symbols, expand, latex
x = symbols('x')
expand((x + 1)**4)

# SymPy, matplotlib, pandas, numpy가 미리 로드되었습니다.
# Ctrl/Cmd+Enter로 실행。`,
  },
  fr: {
    nav:        'Navigation',
    pages:      'Pages',
    content:    'Contenu',
    code:       'Code',
    output:     'Sortie',
    chat:       'Chat',
    run:        'Exécuter',
    idle:       'Inactif — Python se charge au premier lancement.',
    out_hint:   'Exécutez le code pour voir les résultats ici.',
    placeholder:`# Exemple — essayez d'exécuter ceci :
from sympy import symbols, expand, latex
x = symbols('x')
expand((x + 1)**4)

# SymPy, matplotlib, pandas et numpy sont préchargés.
# Ctrl/Cmd+Entrée pour exécuter.`,
  },
  it: {
    nav:        'Navigazione',
    pages:      'Pagine',
    content:    'Contenuto',
    code:       'Codice',
    output:     'Output',
    chat:       'Chat',
    run:        'Esegui',
    idle:       'Inattivo — Python si carica al primo avvio.',
    out_hint:   'Esegui il codice per vedere i risultati qui.',
    placeholder:`# Esempio — prova a eseguire:
from sympy import symbols, expand, latex
x = symbols('x')
expand((x + 1)**4)

# SymPy, matplotlib, pandas e numpy sono precaricati.
# Ctrl/Cmd+Invio per eseguire.`,
  },
  es: {
    nav:        'Navegación',
    pages:      'Páginas',
    content:    'Contenido',
    code:       'Código',
    output:     'Salida',
    chat:       'Chat',
    run:        'Ejecutar',
    idle:       'Inactivo — Python se carga en el primer uso.',
    out_hint:   'Ejecuta el código para ver los resultados aquí.',
    placeholder:`# Ejemplo — prueba a ejecutar esto:
from sympy import symbols, expand, latex
x = symbols('x')
expand((x + 1)**4)

# SymPy, matplotlib, pandas y numpy están precargados.
# Ctrl/Cmd+Intro para ejecutar.`,
  },
  ru: {
    nav:        'Навигация',
    pages:      'Страницы',
    content:    'Содержание',
    code:       'Код',
    output:     'Вывод',
    chat:       'Чат',
    run:        'Запустить',
    idle:       'Ожидание — Python загружается при первом запуске.',
    out_hint:   'Запустите код, чтобы увидеть результат.',
    placeholder:`# Пример — попробуйте запустить:
from sympy import symbols, expand, latex
x = symbols('x')
expand((x + 1)**4)

# SymPy, matplotlib, pandas и numpy предзагружены.
# Ctrl/Cmd+Enter для запуска.`,
  },
};

// ── Selector registry ──────────────────────────────────
// Add one entry here to make any class of element translatable.
// { sel, key|keyFn, attr?, fmt?, guard? }
//   sel   — CSS selector
//   key   — fixed key in T[langId]
//   keyFn — (el: Element) => key, for per-element dynamic lookup
//   attr  — 'text' (default) | 'html' | 'placeholder' | 'title'
//   fmt   — (value: string) => string, wraps the translated value
//   guard — (el: Element) => boolean, skip element when false

function _isIdleText(text) {
  return !text || Object.values(T).some(t => text === t.idle);
}

// Maps screen restore-id → T key (covers all registered screens)
const _CHIP_KEYS = { compiling: 'output', coding: 'code', content: 'content', 'ai-chat': 'chat' };

const SELECTORS = [
  { sel: '.nav-title',              key: 'nav'          },
  // removed: overwrites dynamic section titles from buildTree
  { sel: '.content-screen-label',   key: 'content'      },
  { sel: '.coding-screen-label',    key: 'code'         },
  { sel: '.compiling-screen-label', key: 'output'       },
  { sel: '.run-btn',  key: 'run',   attr: 'html', fmt: v => `&#9654; ${v}` },
  { sel: '.code-editor',            key: 'placeholder', attr: 'placeholder' },
  { sel: '.output-placeholder',     key: 'out_hint'     },
  {
    sel:   '.compiler-status-bar',
    key:   'idle',
    guard: el => !el.querySelector('.status-spinner') && _isIdleText(el.textContent.trim()),
  },
  // Restore chips — label text inside the <span>
  {
    sel:   '.sc-restore-chip span',
    keyFn: el => _CHIP_KEYS[el.closest('.sc-restore-chip')?.dataset.restoreId],
  },
  // Restore chips — tooltip title on the chip itself
  {
    sel:   '.sc-restore-chip',
    attr:  'title',
    keyFn: el => _CHIP_KEYS[el.dataset.restoreId],
    fmt:   v  => `Restore ${v}`,
  },
];

// ── Translation engine ─────────────────────────────────
let _lang = 'en';

function _applyEntry(el, { key, keyFn, attr = 'text', fmt, guard }, t) {
  if (guard && !guard(el)) return;
  const resolvedKey = keyFn ? keyFn(el) : key;
  if (!resolvedKey || !(resolvedKey in t)) return;
  const val = fmt ? fmt(t[resolvedKey]) : t[resolvedKey];
  if      (attr === 'text')        el.textContent = val;
  else if (attr === 'html')        el.innerHTML   = val;
  else if (attr === 'placeholder') el.placeholder = val;
  else if (attr === 'title')       el.title       = val;
}

function applyTranslations(langId) {
  const t = T[langId] ?? T.en;
  for (const entry of SELECTORS) {
    for (const el of document.querySelectorAll(entry.sel)) {
      _applyEntry(el, entry, t);
    }
  }
}

// Translate a newly-added subtree without re-scanning the full document
function _translateSubtree(root, t) {
  for (const entry of SELECTORS) {
    if (root.matches?.(entry.sel))             _applyEntry(root, entry, t);
    for (const el of root.querySelectorAll?.(entry.sel) ?? []) {
      _applyEntry(el, entry, t);
    }
  }
}

// ── MutationObserver ───────────────────────────────────
// Components rendered after language_selector.js (coding, compiling,
// content screens) add DOM nodes that need translating. The observer
// catches those insertions automatically, removing the need for timers.
function _startObserver() {
  new MutationObserver(mutations => {
    const t = T[_lang] ?? T.en;
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;   // elements only
        _translateSubtree(node, t);
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
}

// ── Public: change language ────────────────────────────
function applyLanguage(lang) {
  _lang = lang.id;
  document.documentElement.setAttribute('data-lang', lang.id);
  document.documentElement.lang = lang.id;
  localStorage.setItem(STORAGE_KEY, lang.id);
  document.dispatchEvent(new CustomEvent('language-change', { detail: { lang } }));
  applyTranslations(lang.id);
}

// ── Setup ──────────────────────────────────────────────
function setupLanguageButton() {
  const header = document.querySelector('.page-header');
  if (!header) return;

  const savedId = localStorage.getItem(STORAGE_KEY) || 'en';
  let current   = LANGUAGES.find(l => l.id === savedId) ?? LANGUAGES[0];

  // Prime lang state before observer starts so mutations are translated correctly
  _lang = current.id;
  document.documentElement.setAttribute('data-lang', current.id);
  document.documentElement.lang = current.id;

  _startObserver();
  // Sync pass for elements already in the DOM (navigation_screen runs before us)
  applyTranslations(current.id);

  // ── Button ──────────────────────────────────────────
  const btn = document.createElement('button');
  btn.className = 'lang-btn';
  btn.setAttribute('aria-label', 'Switch language');
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('title', current.label);
  btn.textContent = current.short;

  // ── Dropdown ────────────────────────────────────────
  const dropdown = document.createElement('div');
  dropdown.className = 'lang-dropdown';
  dropdown.setAttribute('role', 'listbox');

  function buildList() {
    dropdown.innerHTML = '';
    for (const lang of LANGUAGES) {
      const item = document.createElement('button');
      item.className = 'lang-option' + (lang.id === current.id ? ' active' : '');
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(lang.id === current.id));
      item.innerHTML = `<span class="lang-option-short">${lang.short}</span>`
                     + `<span class="lang-option-label">${lang.label}</span>`;
      item.addEventListener('click', () => {
        current = lang;
        applyLanguage(lang);
        btn.textContent = lang.short;
        btn.setAttribute('title', lang.label);
        close();
        buildList();
      });
      dropdown.appendChild(item);
    }
  }

  function open()  {
    buildList();
    dropdown.classList.add('lang-open');
    btn.setAttribute('aria-expanded', 'true');
    btn.classList.add('open');
  }

  function close() {
    dropdown.classList.remove('lang-open');
    btn.setAttribute('aria-expanded', 'false');
    btn.classList.remove('open');
  }

  btn.addEventListener('click', e => {
    e.stopPropagation();
    dropdown.classList.contains('lang-open') ? close() : open();
  });

  // Close only when clicking outside the header
  document.addEventListener('click', e => { if (!header.contains(e.target)) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

  // ── Wrapper ─────────────────────────────────────────
  const wrapper = document.createElement('div');
  wrapper.className = 'lang-btn-wrapper';
  wrapper.appendChild(btn);
  wrapper.appendChild(dropdown);

  const fontBtn = header.querySelector('.font-switcher-btn');
  if (fontBtn) header.insertBefore(wrapper, fontBtn);
  else         header.appendChild(wrapper);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupLanguageButton);
} else {
  setupLanguageButton();
}
