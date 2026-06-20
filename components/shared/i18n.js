// ── i18n — flat-key translation infrastructure ────────────────────────────────
//
// Public API:
//   initI18n()          — load saved/browser locale, apply to DOM, start observer
//   setLocale(lang)     — switch locale, persist to localStorage, re-apply DOM
//   getLocale()         — return current locale string (e.g. 'ja')
//   t(key, fallback?)   — return translated string for a flat dot-key
//   applyTranslations() — apply all [data-i18n] elements in document (or subtree)
//
// Markup convention:
//   <span data-i18n="btn.save"></span>          → textContent
//   <input data-i18n="btn.cancel"
//          data-i18n-attr="placeholder">        → placeholder attribute
//   data-i18n-attr values: text (default) | html | placeholder | title | <attr>

const STORAGE_KEY  = 'dreaming-polar-lang';
const DEFAULT      = 'en';
const SUPPORTED    = ['en', 'zh', 'ja', 'ko', 'fr', 'it', 'es', 'ru'];

let _locale       = DEFAULT;
let _translations = {};

// ── Loader ────────────────────────────────────────────────────────────────────

async function _load(lang) {
  try {
    const resp = await fetch(`${window.BASE || ''}/locales/${lang}.json`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } catch (e) {
    console.warn(`[i18n] failed to load locale "${lang}":`, e.message);
    return null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Return the current locale code. */
export function getLocale() { return _locale; }

/**
 * Look up a translation key.  Falls back to `fallback` (default: the key
 * itself) so missing keys are visually obvious but never break the UI.
 */
export function t(key, fallback = key) {
  return _translations[key] ?? fallback;
}

/**
 * Walk all [data-i18n] elements in `root` (defaults to document) and set
 * their content / attribute to the current translation.
 * Also called automatically by the MutationObserver for new subtrees.
 */
export function applyTranslations(root = document) {
  const query = root.querySelectorAll ? root : document;
  for (const el of query.querySelectorAll('[data-i18n]')) {
    const key  = el.dataset.i18n;
    const attr = el.dataset.i18nAttr ?? 'text';
    const val  = t(key);
    if      (attr === 'text')        el.textContent = val;
    else if (attr === 'html')        el.innerHTML   = val;
    else if (attr === 'placeholder') el.placeholder = val;
    else if (attr === 'title')       el.title       = val;
    else                             el.setAttribute(attr, val);
  }
}

/**
 * Switch the active locale, persist it, and update the DOM.
 * Fires a 'language-change' CustomEvent on document so other modules
 * (e.g. language_selector.js) can react without a circular import.
 */
export async function setLocale(lang) {
  if (!SUPPORTED.includes(lang)) {
    console.warn(`[i18n] unsupported locale "${lang}" — keeping "${_locale}"`);
    return;
  }
  const data = await _load(lang);
  if (!data) return;                        // load failed; keep current locale

  _translations = data;
  _locale       = lang;
  localStorage.setItem(STORAGE_KEY, lang);
  document.documentElement.lang = lang;
  document.documentElement.setAttribute('data-lang', lang);
  document.dispatchEvent(new CustomEvent('i18n-locale-changed', { detail: { lang } }));
  applyTranslations();
}

/**
 * Bootstrap i18n:
 *  1. Resolve locale from localStorage → browser → 'en'
 *  2. Load the locale JSON
 *  3. Apply to existing DOM
 *  4. Start MutationObserver so dynamically-added subtrees are translated
 */
export async function initI18n() {
  const saved    = localStorage.getItem(STORAGE_KEY);
  const browser  = navigator.language?.split('-')[0];
  const resolved = [saved, browser].find(l => SUPPORTED.includes(l)) ?? DEFAULT;

  const data = await _load(resolved);
  _translations = data ?? {};
  _locale       = data ? resolved : DEFAULT;

  document.documentElement.lang = _locale;
  document.documentElement.setAttribute('data-lang', _locale);
  applyTranslations();
  _startObserver();
}

// ── MutationObserver ──────────────────────────────────────────────────────────
// Translates [data-i18n] elements added to the DOM after initI18n() runs
// (covers components that render HTML asynchronously).

function _startObserver() {
  new MutationObserver(mutations => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        // Translate the node itself if it carries [data-i18n]
        if (node.dataset?.i18n) applyTranslations(node.parentElement ?? node);
        // Translate any [data-i18n] descendants
        else if (node.querySelector?.('[data-i18n]')) applyTranslations(node);
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
}
