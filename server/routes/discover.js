'use strict';
// Nebulix 3.0 — game discovery through official public APIs (no keys needed):
//   FreeToGame (https://www.freetogame.com/api-doc) — free-to-play PC and browser games; attribution required.
//   CheapShark (https://apidocs.cheapshark.com) — current deals on PC games across official stores; links must go
//   through its redirect. The server calls them (with a descriptive User-Agent), caches the answers and passes on only
//   known fields, so browsers never talk to those services directly and they get few requests.
const https = require('https');
const { HttpError } = require('../util');

const UA = 'Nebulix/15.7 (+https://nebulix.fly.dev)';
const cache = new Map(); // url -> { at, data }
function get(url, ttl) {
  const hit = cache.get(url); if (hit && Date.now() - hit.at < ttl) return Promise.resolve(hit.data);
  return new Promise((res, rej) => {
    const req = https.get(url, { headers: { 'user-agent': UA, accept: 'application/json' }, timeout: 10000 }, (r) => {
      const parts = []; let n = 0;
      r.on('data', (c) => { n += c.length; if (n > 4 << 20) { req.destroy(); return; } parts.push(c); });
      r.on('end', () => { if (r.statusCode !== 200) { if (hit) return res(hit.data); return rej(new HttpError(502, 'upstream', 'The game service answered ' + r.statusCode)); } try { const data = JSON.parse(Buffer.concat(parts).toString()); cache.set(url, { at: Date.now(), data }); if (cache.size > 300) cache.delete(cache.keys().next().value); res(data); } catch { rej(new HttpError(502, 'upstream', 'The game service sent something unexpected')); } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => (hit ? res(hit.data) : rej(new HttpError(502, 'upstream', 'The game service is not reachable right now'))));
  });
}
const str = (v, n) => String(v == null ? '' : v).slice(0, n);
const httpsUrl = (v, hosts) => { try { const u = new URL(String(v)); return u.protocol === 'https:' && hosts.some((h) => u.hostname === h || u.hostname.endsWith('.' + h)) ? u.href : null; } catch { return null; } };
const F2G_CATS = ['mmorpg', 'shooter', 'strategy', 'moba', 'racing', 'sports', 'social', 'sandbox', 'open-world', 'survival', 'pvp', 'pve', 'pixel', 'zombie', 'anime', 'fantasy', 'sci-fi', 'fighting', 'action-rpg', 'action', 'battle-royale', 'card', 'mmofps', 'horror', 'tower-defense', 'survival'];

module.exports = function register(r) {
  r.get('/api/discover/free', { auth: true, limit: [60, 60000, 'user'] }, async (c) => {
    const q = new URLSearchParams();
    const platform = ['pc', 'browser', 'all'].includes(c.query.platform) ? c.query.platform : 'all'; q.set('platform', platform);
    if (F2G_CATS.includes(c.query.category)) q.set('category', c.query.category);
    q.set('sort-by', ['popularity', 'release-date', 'alphabetical', 'relevance'].includes(c.query.sort) ? c.query.sort : 'popularity');
    let list = await get('https://www.freetogame.com/api/games?' + q, 6 * 3600 * 1000);
    if (!Array.isArray(list)) list = []; // FreeToGame answers an object when nothing matches
    const s = String(c.query.q || '').toLowerCase().slice(0, 60);
    const games = list.filter((g) => !s || String(g.title).toLowerCase().includes(s) || String(g.genre).toLowerCase().includes(s)).slice(0, 120).map((g) => ({
      id: Number(g.id) || 0, title: str(g.title, 120), thumb: httpsUrl(g.thumbnail, ['freetogame.com']), text: str(g.short_description, 300), genre: str(g.genre, 40),
      platform: str(g.platform, 40), publisher: str(g.publisher, 80), released: str(g.release_date, 10), url: httpsUrl(g.game_url, ['freetogame.com']) || httpsUrl(g.freetogame_profile_url, ['freetogame.com']) }));
    return { games, total: list.length, source: { name: 'FreeToGame', url: 'https://www.freetogame.com' } };
  });
  r.get('/api/discover/deals', { auth: true, limit: [60, 60000, 'user'] }, async (c) => {
    const q = new URLSearchParams({ pageSize: '60', sortBy: ['Deal Rating', 'Savings', 'Price', 'Metacritic', 'Reviews', 'Release', 'recent'].includes(c.query.sort) ? c.query.sort : 'Deal Rating' });
    const up = String(c.query.upper || '').trim(); const upper = Number(up); if (up !== '' && upper >= 0 && upper <= 200) q.set('upperPrice', String(upper)); // an empty value means no limit (Number('') would be 0 = free only)
    if (/^\d{1,3}$/.test(String(c.query.store || ''))) q.set('storeID', String(c.query.store));
    if (c.query.free === '1') q.set('upperPrice', '0');
    const t = String(c.query.q || '').trim().slice(0, 60); if (t) q.set('title', t);
    const [deals, stores] = await Promise.all([get('https://www.cheapshark.com/api/1.0/deals?' + q, 30 * 60000), get('https://www.cheapshark.com/api/1.0/stores', 24 * 3600000)]);
    const storeName = new Map((Array.isArray(stores) ? stores : []).map((s) => [String(s.storeID), str(s.storeName, 40)]));
    const list = (Array.isArray(deals) ? deals : []).map((d) => ({
      id: str(d.dealID, 200), title: str(d.title, 120), thumb: httpsUrl(d.thumb, ['steamstatic.com', 'cheapshark.com']), store: storeName.get(String(d.storeID)) || '?',
      price: Number(d.salePrice) || 0, normal: Number(d.normalPrice) || 0, savings: Math.round(Number(d.savings) || 0), metacritic: Number(d.metacriticScore) || null,
      steam: d.steamRatingText ? str(d.steamRatingText, 40) + (d.steamRatingPercent ? ' (' + d.steamRatingPercent + '%)' : '') : null,
      url: /^[A-Za-z0-9%._-]{4,200}$/.test(String(d.dealID || '')) ? 'https://www.cheapshark.com/redirect?dealID=' + d.dealID : null })).filter((d) => d.url); // dealID comes URL-encoded already
    return { deals: list, stores: [...storeName].filter(([id]) => (Array.isArray(stores) ? stores : []).find((s) => String(s.storeID) === id && s.isActive)).map(([id, name]) => ({ id, name })), source: { name: 'CheapShark', url: 'https://www.cheapshark.com' } };
  });
};
