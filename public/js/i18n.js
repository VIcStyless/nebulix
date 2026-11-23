// English text is the key. Spanish lives in es.js (bundled); Português, Français, Deutsch and Italiano are loaded on demand
// from /js/lang/<code>.json (index → text, aligned with /js/lang/keys.json). Missing keys simply fall back to English.
import ES from './es.js';
export const LANGS = [['en', 'English', '🇬🇧'], ['es', 'Español', '🇪🇸'], ['pt', 'Português', '🇧🇷'], ['fr', 'Français', '🇫🇷'], ['de', 'Deutsch', '🇩🇪'], ['it', 'Italiano', '🇮🇹']];
const CODES = LANGS.map((l) => l[0]);
let lang = 'en'; let dict = null;
export function t(s, vars) {
  let r = dict !== null && Object.prototype.hasOwnProperty.call(dict, s) ? dict[s] : s;
  if (vars) r = r.replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined ? '' : vars[k]));
  return r;
}
export const getLang = () => lang;
export const langName = (l = lang) => (LANGS.find((x) => x[0] === l) || LANGS[0])[1];
const norm = (l) => { l = String(l || '').toLowerCase().slice(0, 2); return CODES.includes(l) ? l : 'en'; };
function commit(l) { lang = l; document.documentElement.lang = l; try { localStorage.setItem('nbx.lang', l); } catch {} }
// Load a language pack and switch to it (Spanish is instant; the others are fetched once).
export async function loadLang(l) {
  l = norm(l);
  if (l === 'en') dict = null;
  else if (l === 'es') dict = ES;
  else {
    try {
      const [keys, vals] = await Promise.all([fetch('/js/lang/keys.json').then((r) => r.json()), fetch(`/js/lang/${l}.json`).then((r) => r.json())]);
      const d = {}; for (const i of Object.keys(vals)) { const k = keys[i]; if (k !== undefined && typeof vals[i] === 'string') d[k] = vals[i]; }
      dict = d;
    } catch { dict = null; l = 'en'; }
  }
  commit(l); return l;
}
// Synchronous switch for code paths that reload the page right after (the pack is fetched on the next boot).
export function setLang(l) { l = norm(l); if (l === 'en') dict = null; else if (l === 'es') dict = ES; commit(l); }
export function detectLang() {
  try { const s = localStorage.getItem('nbx.lang'); if (s) return norm(s); } catch {}
  return norm(navigator.language || 'en');
}
// Bilingual data pairs [en, es] coming from older catalogs: Spanish uses the pair, other languages translate the English text.
export const pick2 = (pair) => (Array.isArray(pair) ? (lang === 'es' ? pair[1] : t(pair[0])) : pair);
export const locale = () => ({ en: 'en-US', es: 'es-ES', pt: 'pt-BR', fr: 'fr-FR', de: 'de-DE', it: 'it-IT' }[lang] || 'en-US');
