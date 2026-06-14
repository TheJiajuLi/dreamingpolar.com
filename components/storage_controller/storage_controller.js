// ── Dreaming Polar — Cache Registry ──────────────────────────────────────────
//  Single source of truth for all DP localStorage / sessionStorage keys.
//  Imported by the Cache button (mobile header) and the 'cache' terminal command.

const DP_LS_KEYS = [
  'dreaming-polar-cells',         // notebook cells (customise_code_block)
  'dreaming-polar-code',          // editor code (coding_screen)
  'dreaming-polar-content-path',  // last visited content page
  'dreaming-polar-nav-open',      // nav sidebar open/closed
  'dreaming-polar-nav-expanded',  // nav sidebar expanded tree nodes
  'dreaming-polar-nav-width',     // nav sidebar width
  'dreaming-polar-lang',          // language preference
  'dreaming-polar-mode',          // compiler mode (python / js / etc.)
  'dp-pwa-dismissed',             // PWA install banner dismissed
  'dp-ai-chat',                   // AI chat history + daily token usage
  'dp-ai-persona',                // AI persona selection (小梦 / 波比)
  'dp-icm-enabled',               // intelligent coding mode toggle
  'theme',                        // colour theme
  'mathfield-font',               // font preference
];

// screen_controller uses 'dp-screen-<id>' for any persisted panel
const DP_LS_PREFIXES = ['dp-screen-'];

// compiling_screen stores run outputs in sessionStorage (cleared on tab close)
const DP_SS_KEYS = ['dreaming-polar-outputs'];

function lsPrefixKeys() {
  const out = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && DP_LS_PREFIXES.some(p => k.startsWith(p))) out.push(k);
  }
  return out;
}

export function getCacheEntries() {
  const entries = [];
  const seen = new Set();

  for (const key of DP_LS_KEYS) {
    const val = localStorage.getItem(key);
    if (val !== null) {
      entries.push({ key, store: 'localStorage', bytes: val.length });
      seen.add(key);
    }
  }
  for (const key of lsPrefixKeys()) {
    if (!seen.has(key)) {
      const val = localStorage.getItem(key);
      entries.push({ key, store: 'localStorage', bytes: val?.length ?? 0 });
    }
  }
  for (const key of DP_SS_KEYS) {
    const val = sessionStorage.getItem(key);
    if (val !== null) entries.push({ key, store: 'sessionStorage', bytes: val.length });
  }
  return entries;
}

export function clearAllCaches() {
  for (const key of DP_LS_KEYS) localStorage.removeItem(key);
  for (const key of lsPrefixKeys()) localStorage.removeItem(key);
  for (const key of DP_SS_KEYS) sessionStorage.removeItem(key);
}

export function exportCacheJson() {
  const obj = {};
  const addEntry = (key, store, getter) => {
    const val = getter(key);
    if (val === null) return;
    const label = `${store}::${key}`;
    try { obj[label] = JSON.parse(val); } catch { obj[label] = val; }
  };

  for (const key of DP_LS_KEYS) addEntry(key, 'localStorage', k => localStorage.getItem(k));
  for (const key of lsPrefixKeys()) addEntry(key, 'localStorage', k => localStorage.getItem(k));
  for (const key of DP_SS_KEYS) addEntry(key, 'sessionStorage', k => sessionStorage.getItem(k));

  return JSON.stringify(obj, null, 2);
}
