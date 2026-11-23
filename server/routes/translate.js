'use strict';
// Translator: used by the "Translate" button on messages and by the Translator page.
// Engine: the same AI Nova uses (Claude / Ollama / OpenAI-compatible) when one is connected,
// otherwise the free MyMemory service (text is sent to translated.net). TRANSLATE_PROVIDER=off disables it.
const cfg = require('../config');
const ai = require('./ai');
const { HttpError } = require('../util');

const LANGS = { en: 'English', es: 'Spanish', pt: 'Portuguese', fr: 'French', de: 'German', it: 'Italian', ca: 'Catalan', nl: 'Dutch', pl: 'Polish', ru: 'Russian', uk: 'Ukrainian', tr: 'Turkish', ar: 'Arabic', zh: 'Chinese', ja: 'Japanese', ko: 'Korean', hi: 'Hindi', ro: 'Romanian', sv: 'Swedish' };
const provider = () => String(process.env.TRANSLATE_PROVIDER || 'auto').toLowerCase();
const myMemoryBase = () => String(process.env.MYMEMORY_BASE || 'https://api.mymemory.translated.net').replace(/\/$/, '');
const cache = new Map();

async function viaAI(text, to, from) {
  const sys = `You are a translation engine. Translate the user's message ${from && LANGS[from] ? 'from ' + LANGS[from] + ' ' : ''}into ${LANGS[to]}. Keep the tone, slang, emoji, @mentions, links and line breaks. Reply with the translation only — no quotes, notes or explanations. If it is already in ${LANGS[to]}, return it unchanged.`;
  const out = await ai.complete(sys, text, { maxChars: text.length * 4 + 200 });
  return out ? { text: out, engine: 'ai' } : null;
}
async function viaMyMemory(text, to, from) {
  // MyMemory needs a source language; a light heuristic guesses it when none is given.
  const src = from && LANGS[from] ? from : guess(text, to);
  if (src === to) return { text, engine: 'none', same: true };
  const url = `${myMemoryBase()}/get?q=${encodeURIComponent(text.slice(0, 500))}&langpair=${src}|${to}`;
  const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 8000);
  try {
    const r = await fetch(url, { signal: ac.signal, headers: { 'user-agent': 'Nebulix/3.0 translator' } });
    if (!r.ok) throw new Error('status ' + r.status);
    const j = await r.json(); const tr = j && j.responseData && j.responseData.translatedText;
    if (!tr || /^(MYMEMORY WARNING|INVALID)/i.test(tr)) throw new Error('no translation');
    return { text: decode(tr), engine: 'mymemory', from: src };
  } finally { clearTimeout(tm); }
}
const decode = (s) => String(s).replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n)).replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function guess(text, to) {
  const t = ' ' + text.toLowerCase() + ' ';
  const score = { es: /[ñ¿¡]| (que|de|el|la|los|las|y|es|por|pero|muy|para|con|una?) /g, pt: /[ãõç]| (não|você|que|de|um|uma|com|para|muito) /g, fr: /[àâçèêëîôœù]| (le|la|les|et|est|pas|vous|je|une?|des) /g, de: /[äöüß]| (der|die|das|und|ist|nicht|ich|du|ein|eine) /g, it: / (il|che|di|non|sono|per|una?|gli|della) /g, en: / (the|and|is|you|are|to|of|it|that|what) /g };
  let best = 'en', bestN = 0;
  for (const [l, re] of Object.entries(score)) { const n = (t.match(re) || []).length; if (n > bestN && l !== to) { best = l; bestN = n; } }
  if (bestN === 0) return to === 'en' ? 'es' : 'en';
  return best;
}

module.exports = function register(r) {
  r.get('/api/translate/langs', { auth: true }, async () => ({ langs: LANGS, engine: provider() === 'off' ? 'off' : ai.mode() !== 'local' ? 'ai' : 'mymemory' }));
  r.post('/api/translate', { auth: true, verified: true, limit: [40, 60000, 'user'], bodyLimit: 16 * 1024 }, async (c) => {
    if (provider() === 'off') throw new HttpError(503, 'translate_off', 'Translation is turned off on this server');
    const text = String(c.body.text || '').trim(); const to = String(c.body.to || 'en'); const from = c.body.from ? String(c.body.from) : '';
    if (!text) throw new HttpError(400, 'empty', 'Nothing to translate');
    if (text.length > 2000) throw new HttpError(400, 'too_long', 'Up to 2000 characters at a time');
    if (!LANGS[to]) throw new HttpError(400, 'bad_lang', 'Unknown language');
    const key = `${from}|${to}|${text}`; if (cache.has(key)) return cache.get(key);
    let out = null;
    try { if (provider() !== 'mymemory') out = await viaAI(text, to, from); } catch (e) { out = null; }
    if (!out) { try { out = await viaMyMemory(text, to, from); } catch (e) { throw new HttpError(502, 'translate_failed', 'The translator is not available right now. Try again in a moment.'); } }
    const res = { text: out.text, to, engine: out.engine, from: out.from || from || null };
    cache.set(key, res); if (cache.size > 2000) cache.delete(cache.keys().next().value);
    return res;
  });
};
module.exports.guess = guess;
