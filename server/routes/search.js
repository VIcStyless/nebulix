'use strict';
// Nebulix Search: the browser's own search engine. Results are fetched server-side (so they work from any
// network and do not need the proxy): web and news from Bing's RSS feeds, images from Bing Images, an
// encyclopedia card from Wikipedia, videos from Nebulix Tube, plus instant answers (maths, stock prices).
// Plain data only — the client renders it; no third-party HTML ever reaches the page.
const { HttpError, now } = require('../util');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const TTL = 10 * 60000; const cache = new Map();
const dec = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
const okUrl = (u) => /^https?:\/\/[^\s]+$/i.test(u || '') ? u : null;
const tag = (xml, t) => { const m = new RegExp('<' + t + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + t + '>', 'i').exec(xml); return m ? dec(m[1]) : ''; };

async function get(url, { lang = 'es', json = false, timeout = 9000 } = {}) {
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': lang + ',en;q=0.6', Accept: json ? 'application/json' : 'text/html,application/xml;q=0.9,*/*;q=0.8' }, signal: ctl.signal });
    if (!r.ok) throw new Error('status ' + r.status);
    return json ? r.json() : r.text();
  } finally { clearTimeout(to); }
}
async function cached(key, fn) { const c = cache.get(key); if (c && now() - c.t < TTL) return c.v; const v = await fn(); if (cache.size > 500) cache.clear(); cache.set(key, { t: now(), v }); return v; }
const mkt = (lang) => ({ es: 'es-ES', en: 'en-US', pt: 'pt-BR', fr: 'fr-FR', de: 'de-DE', it: 'it-IT' }[lang] || 'es-ES');

function rssItems(xml) { return (xml.match(/<item>[\s\S]*?<\/item>/g) || []).map((it) => ({ title: tag(it, 'title'), url: okUrl(tag(it, 'link')), snippet: tag(it, 'description').slice(0, 320), date: tag(it, 'pubDate'), source: tag(it, 'News:Source'), image: okUrl(tag(it, 'News:Image')) })).filter((x) => x.url && x.title); }
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

async function web(q, lang, page) {
  return cached(`w:${lang}:${page}:${q}`, async () => {
    const first = (page - 1) * 10 + 1;
    let items = rssItems(await get(`https://www.bing.com/search?format=rss&q=${encodeURIComponent(q)}&first=${first}&setmkt=${mkt(lang)}&setlang=${lang}`, { lang }));
    items = items.map((x) => ({ title: x.title, url: x.url, snippet: x.snippet, host: host(x.url) }));
    return items;
  });
}
async function news(q, lang) { return cached(`n:${lang}:${q}`, async () => rssItems(await get(`https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss&setmkt=${mkt(lang)}&setlang=${lang}`, { lang })).slice(0, 20).map((x) => Object.assign(x, { host: host(x.url) }))); }
async function images(q, lang) {
  return cached(`i:${lang}:${q}`, async () => {
    const html = await get(`https://www.bing.com/images/search?q=${encodeURIComponent(q)}&form=HDRSC2&setlang=${lang}`, { lang });
    const out = []; const re = /\sm="(\{[^"]*?\})"/g; let m;
    while ((m = re.exec(html)) && out.length < 40) { try { const j = JSON.parse(dec(m[1].replace(/&quot;/g, '"'))); const img = okUrl(j.murl); const th = okUrl(j.turl); if (img && th) out.push({ thumb: th, full: img, title: String(j.t || '').slice(0, 120), page: okUrl(j.purl), host: host(j.purl) }); } catch {} }
    return out;
  });
}
async function wiki(q, lang) {
  return cached(`k:${lang}:${q}`, async () => {
    const wl = ['es', 'en', 'pt', 'fr', 'de', 'it'].includes(lang) ? lang : 'es';
    const s = await get(`https://${wl}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=1&format=json`, { json: true, lang });
    const hit = s && s.query && s.query.search && s.query.search[0]; if (!hit) return null;
    // only show the card when the article really is about the query
    const norm = (x) => x.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (!norm(hit.title).includes(norm(q).split(' ')[0]) && !norm(q).includes(norm(hit.title).split(' ')[0])) return null;
    const p = await get(`https://${wl}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(hit.title.replace(/ /g, '_'))}`, { json: true, lang });
    if (!p || p.type === 'disambiguation' || !p.extract) return null;
    return { title: p.title, text: p.extract.slice(0, 600), url: okUrl(p.content_urls && p.content_urls.desktop && p.content_urls.desktop.page), image: okUrl(p.thumbnail && p.thumbnail.source), desc: p.description || '' };
  });
}
async function suggest(q, lang) {
  return cached(`s:${lang}:${q}`, async () => { const j = await get(`https://api.bing.com/osjson.aspx?query=${encodeURIComponent(q)}&market=${mkt(lang)}`, { json: true, lang, timeout: 3000 }); return Array.isArray(j && j[1]) ? j[1].slice(0, 8).map(String) : []; });
}
// instant answers that do not need the network
async function instant(q) {
  const brain = require('../nova-brain');
  const m = /^\s*([\d\s.,+\-*/x×÷^%()]+)\s*=?\s*$/.exec(q); if (m && /[+\-*/x×÷^%]/.test(m[1])) { const v = brain.calc(m[1]); if (v !== null) return { kind: 'calc', title: m[1].trim() + ' =', value: String(v) }; }
  const SY = { aapl: 'AAPL', apple: 'AAPL', nvda: 'NVDA', nvidia: 'NVDA', msft: 'MSFT', microsoft: 'MSFT', googl: 'GOOGL', alphabet: 'GOOGL', amzn: 'AMZN', amazon: 'AMZN', tsla: 'TSLA', tesla: 'TSLA', meta: 'META' };
  const k = q.toLowerCase().replace(/\b(acciones?|stock|precio|price|cotizaci[oó]n|de|of)\b/g, '').trim();
  if (SY[k] && /acci|stock|precio|price|cotiz/i.test(q)) { try { const s = await require('./invest').quote(SY[k]); return { kind: 'stock', title: s.name + ' (' + s.sym + ')', value: '$' + s.price, sub: (s.change >= 0 ? '+' : '') + s.change + '%' }; } catch {} }
  if (/^(hora|qu[eé] hora es|time|what time is it)$/i.test(q.trim())) return { kind: 'time', title: 'Madrid', value: new Date().toLocaleTimeString('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' }) };
  return null;
}

module.exports = function register(r) {
  r.get('/api/search', { auth: true, limit: [60, 60000, 'user'] }, async (c) => {
    const q = String(c.query.q || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200);
    if (!q) throw new HttpError(400, 'bad_query', 'Type something to search');
    const type = ['web', 'images', 'news', 'videos'].includes(c.query.type) ? c.query.type : 'web';
    const lang = /^[a-z]{2}$/.test(c.query.hl || '') ? c.query.hl : (c.user.lang || 'es');
    const page = Math.max(1, Math.min(10, parseInt(c.query.p, 10) || 1));
    const safe = (p) => p.catch(() => null);
    try {
      if (type === 'images') return { q, type, images: await images(q, lang) };
      if (type === 'news') return { q, type, news: await news(q, lang) };
      if (type === 'videos') return { q, type, videos: (await require('./tube').search(q, lang)).slice(0, 30) };
      const [results, card, vids, ans, imgs] = await Promise.all([web(q, lang, page), page === 1 ? safe(wiki(q, lang)) : null, page === 1 ? safe(require('./tube').search(q, lang)) : null, page === 1 ? safe(instant(q)) : null, page === 1 ? safe(images(q, lang)) : null]);
      return { q, type, page, results, card, answer: ans, videos: vids ? vids.slice(0, 4) : [], images: imgs ? imgs.slice(0, 8) : [] };
    } catch (e) { throw new HttpError(503, 'search_down', 'The search sources are not answering right now. Try again in a moment.'); }
  });
  r.get('/api/search/suggest', { auth: true, limit: [240, 60000, 'user'] }, async (c) => {
    const q = String(c.query.q || '').trim().slice(0, 100); if (q.length < 2) return { list: [] };
    try { return { list: await suggest(q, c.user.lang || 'es') }; } catch { return { list: [] }; }
  });
};
module.exports.web = web;
