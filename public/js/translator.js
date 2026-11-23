// Shared translation helper (community messages, DMs on request, the Translator page).
import { api } from './api.js';
import { getLang } from './i18n.js';

const cache = new Map();
export const myLang = () => (getLang() || 'en');
export async function translate(text, to = myLang(), from = '') {
  const key = `${from}|${to}|${text}`;
  if (cache.has(key)) return cache.get(key);
  const p = api.post('/api/translate', { text, to, from: from || undefined }).catch((e) => { cache.delete(key); throw e; });
  cache.set(key, p); return p;
}
let langs = null;
export async function languages() { if (!langs) langs = api.get('/api/translate/langs').then((r) => r).catch(() => ({ langs: { en: 'English', es: 'Spanish' }, engine: 'mymemory' })); return langs; }
