'use strict';
// Data for the browser's native clients (sites that break inside the proxy or are nicer as an app):
// Hacker News (official Firebase API) and Wikipedia (plain-text articles). Data only, never third-party HTML.
const { HttpError, now } = require('../util');

const cache = new Map();
async function getJson(url, ttl = 120000) {
  const c = cache.get(url); if (c && now() - c.t < ttl) return c.v;
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Nebulix/5 (native reader)', Accept: 'application/json' }, signal: ctl.signal });
    if (!r.ok) throw new Error('status ' + r.status);
    const v = await r.json(); if (cache.size > 2000) cache.clear(); cache.set(url, { t: now(), v }); return v;
  } finally { clearTimeout(to); }
}
const HN = 'https://hacker-news.firebaseio.com/v0/';
const strip = (s) => String(s || '').replace(/<p>/g, '\n\n').replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&#x2F;/g, '/').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&').trim();
const hnItem = (x) => (x ? { id: x.id, title: strip(x.title), url: /^https?:\/\//.test(x.url || '') ? x.url : null, by: x.by, score: x.score || 0, comments: x.descendants || 0, time: (x.time || 0) * 1000, text: strip(x.text).slice(0, 4000), kids: (x.kids || []).slice(0, 40), dead: !!(x.dead || x.deleted) } : null);

module.exports = function register(r) {
  r.get('/api/apps/hn/:list', { auth: true, limit: [60, 60000, 'user'] }, async (c) => {
    const list = { top: 'topstories', new: 'newstories', best: 'beststories', ask: 'askstories', show: 'showstories' }[c.params.list]; if (!list) throw new HttpError(404, 'no_list', 'Unknown list');
    try { const ids = (await getJson(HN + list + '.json', 120000)).slice(0, 30); const items = await Promise.all(ids.map((id) => getJson(HN + 'item/' + id + '.json', 300000).catch(() => null))); return { items: items.map(hnItem).filter((x) => x && !x.dead) }; }
    catch { throw new HttpError(503, 'hn_down', 'Hacker News is not answering right now.'); }
  });
  r.get('/api/apps/hn/item/:id', { auth: true, limit: [60, 60000, 'user'] }, async (c) => {
    const id = parseInt(c.params.id, 10); if (!(id > 0)) throw new HttpError(400, 'bad_id', 'Bad id');
    try {
      const it = hnItem(await getJson(HN + 'item/' + id + '.json', 120000));
      // two levels of comments
      const kids = (await Promise.all(it.kids.slice(0, 25).map((k) => getJson(HN + 'item/' + k + '.json', 300000).catch(() => null)))).map(hnItem).filter((x) => x && !x.dead);
      for (const k of kids) k.replies = (await Promise.all(k.kids.slice(0, 5).map((q) => getJson(HN + 'item/' + q + '.json', 300000).catch(() => null)))).map(hnItem).filter((x) => x && !x.dead);
      return { item: it, comments: kids };
    } catch { throw new HttpError(503, 'hn_down', 'Hacker News is not answering right now.'); }
  });
  r.get('/api/apps/wiki', { auth: true, limit: [60, 60000, 'user'] }, async (c) => {
    const lang = /^[a-z]{2,3}$/.test(c.query.lang || '') ? c.query.lang : 'es';
    const title = String(c.query.title || '').slice(0, 200); const q = String(c.query.q || '').slice(0, 200);
    try {
      if (q && !title) { const s = await getJson(`https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=15&format=json`); return { results: (s.query.search || []).map((x) => ({ title: x.title, snippet: strip(x.snippet) })) }; }
      if (!title) { const f = await getJson(`https://${lang}.wikipedia.org/api/rest_v1/page/random/summary`, 1000).catch(() => null); return { random: f ? f.title : null }; }
      const j = await getJson(`https://${lang}.wikipedia.org/w/api.php?action=query&prop=extracts|pageimages&explaintext=1&exsectionformat=wiki&piprop=thumbnail&pithumbsize=480&redirects=1&titles=${encodeURIComponent(title)}&format=json`, 600000);
      const p = Object.values((j.query && j.query.pages) || {})[0]; if (!p || p.missing !== undefined) throw new HttpError(404, 'no_article', 'Article not found');
      return { title: p.title, text: String(p.extract || '').slice(0, 120000), image: p.thumbnail ? p.thumbnail.source : null, url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}` };
    } catch (e) { if (e.status) throw e; throw new HttpError(503, 'wiki_down', 'Wikipedia is not answering right now.'); }
  });
};
