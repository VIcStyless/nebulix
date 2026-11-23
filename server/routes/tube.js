'use strict';
// Nebulix Tube: YouTube inside the Nebulix browser. YouTube's own site does not survive the rewriting proxy, so the
// browser shows a native page instead: search results are read server-side from YouTube's public results page and
// videos play in YouTube's official privacy-enhanced embed (youtube-nocookie.com), which the app CSP allows.
const { HttpError, now } = require('../util');

const TTL = 10 * 60000; const cache = new Map();
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const ID = /^[A-Za-z0-9_-]{11}$/;
const txt = (x) => (x ? (x.simpleText || (x.runs || []).map((r) => r.text).join('')) : '');

function parse(html) {
  const i = html.indexOf('var ytInitialData = '); if (i < 0) return [];
  const j = html.indexOf(';</script>', i); if (j < 0) return [];
  let data; try { data = JSON.parse(html.slice(i + 20, j)); } catch { return []; }
  const out = []; const seen = new Set();
  (function walk(o, d) {
    if (!o || typeof o !== 'object' || d > 40 || out.length >= 40) return;
    const v = o.videoRenderer || o.compactVideoRenderer || o.gridVideoRenderer;
    if (v && ID.test(v.videoId || '')) {
      if (!seen.has(v.videoId)) {
        seen.add(v.videoId);
        out.push({ id: v.videoId, title: txt(v.title).slice(0, 200), channel: txt(v.ownerText || v.longBylineText || v.shortBylineText).slice(0, 80),
          duration: txt(v.lengthText), views: txt(v.shortViewCountText || v.viewCountText), ago: txt(v.publishedTimeText), live: !v.lengthText && /live|directo/i.test(JSON.stringify(v.badges || '')) });
      }
      return;
    }
    for (const k in o) walk(o[k], d + 1);
  })(data, 0);
  return out;
}

async function search(q, lang) {
  const key = lang + ':' + q.toLowerCase(); const c = cache.get(key);
  if (c && now() - c.t < TTL) return c.items;
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 9000);
  try {
    const url = 'https://www.youtube.com/results?hl=' + lang + '&search_query=' + encodeURIComponent(q);
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': lang + ',en;q=0.6', Cookie: 'CONSENT=YES+1; SOCS=CAI' }, signal: ctl.signal });
    if (!r.ok) throw new Error('youtube ' + r.status);
    const items = parse(await r.text());
    if (cache.size > 300) cache.clear();
    cache.set(key, { t: now(), items });
    return items;
  } catch (e) {
    if (c) return c.items;
    throw new HttpError(503, 'tube_down', 'YouTube search is not answering right now. Try again in a moment.');
  } finally { clearTimeout(to); }
}

async function info(id) {
  const key = 'v:' + id; const c = cache.get(key); if (c && now() - c.t < TTL * 6) return c.items;
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id), { headers: { 'User-Agent': UA }, signal: ctl.signal });
    if (!r.ok) throw new HttpError(404, 'no_video', 'Video not found');
    const j = await r.json(); const v = { id, title: String(j.title || '').slice(0, 200), channel: String(j.author_name || '').slice(0, 80), duration: '', views: '', ago: '' };
    if (!v.title) { // some videos (live streams) have no oEmbed title: read it from the watch page
      try {
        const w = await fetch('https://www.youtube.com/watch?v=' + id, { headers: { 'User-Agent': UA, Cookie: 'CONSENT=YES+1; SOCS=CAI' }, signal: ctl.signal }); const html = await w.text();
        const dec = (x) => x.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        const m = /<meta name="title" content="([^"]*)"/.exec(html); if (m) v.title = dec(m[1]).slice(0, 200);
        const o = /"ownerChannelName":"((?:[^"\\]|\\.)*)"/.exec(html); if (o) { try { v.channel = JSON.parse('"' + o[1] + '"').slice(0, 80); } catch {} }
      } catch {}
    }
    cache.set(key, { t: now(), items: v }); return v;
  } finally { clearTimeout(to); }
}

module.exports = function register(r) {
  r.get('/api/tube/video/:id', { auth: true, limit: [60, 60000, 'user'] }, async (c) => {
    if (!ID.test(c.params.id)) throw new HttpError(400, 'bad_id', 'Bad video id');
    return { video: await info(c.params.id) };
  });
  r.get('/api/tube/search', { auth: true, limit: [40, 60000, 'user'] }, async (c) => {
    const q = String(c.query.q || '').trim().slice(0, 120);
    if (!q) throw new HttpError(400, 'bad_query', 'Type something to search');
    const lang = /^[a-z]{2}$/.test(c.query.hl || '') ? c.query.hl : 'es';
    return { items: await search(q, lang) };
  });
};
module.exports.parse = parse;
module.exports.search = search;
