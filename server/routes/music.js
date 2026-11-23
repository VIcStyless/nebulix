'use strict';
// Pulse radio: a small relay for internet radio streams.
// Streams come through Nebulix so they are same-origin: the Web Audio visualizers and EQ can analyse them.
// Inline ICY metadata is stripped from the audio and kept as the station's "now playing" title.
const http = require('http');
const https = require('https');
const { HttpError, Limiter } = require('../util');
const { checkUrl, lookup } = require('../proxy/guard');

const STATIONS = [
  { id: 'nightride', name: 'Nightride FM', genre: 'Synthwave', url: 'https://stream.nightride.fm/nightride.mp3', color: '#f472b6', site: 'https://nightride.fm' },
  { id: 'chillsynth', name: 'Nightride · Chillsynth', genre: 'Chillsynth', url: 'https://stream.nightride.fm/chillsynth.mp3', color: '#38bdf8', site: 'https://nightride.fm' },
  { id: 'darksynth', name: 'Nightride · Darksynth', genre: 'Darksynth', url: 'https://stream.nightride.fm/darksynth.mp3', color: '#ef4444', site: 'https://nightride.fm' },
  { id: 'datawave', name: 'Nightride · Datawave', genre: 'Glitchy synthwave', url: 'https://stream.nightride.fm/datawave.mp3', color: '#a3e635', site: 'https://nightride.fm' },
  { id: 'spacesynth', name: 'Nightride · Spacesynth', genre: 'Spacesynth', url: 'https://stream.nightride.fm/spacesynth.mp3', color: '#a78bfa', site: 'https://nightride.fm' },
  { id: 'groovesalad', name: 'SomaFM · Groove Salad', genre: 'Ambient / downtempo', url: 'https://ice1.somafm.com/groovesalad-128-mp3', color: '#34d399', site: 'https://somafm.com' },
  { id: 'defcon', name: 'SomaFM · DEF CON Radio', genre: 'Music for hacking', url: 'https://ice1.somafm.com/defcon-128-mp3', color: '#22c55e', site: 'https://somafm.com' },
  { id: 'deepspaceone', name: 'SomaFM · Deep Space One', genre: 'Deep ambient', url: 'https://ice1.somafm.com/deepspaceone-128-mp3', color: '#6366f1', site: 'https://somafm.com' },
  { id: 'fluid', name: 'SomaFM · Fluid', genre: 'Chill trap / future soul', url: 'https://ice1.somafm.com/fluid-128-mp3', color: '#06b6d4', site: 'https://somafm.com' },
  { id: 'poptron', name: 'SomaFM · PopTron', genre: 'Electropop', url: 'https://ice1.somafm.com/poptron-128-mp3', color: '#fb923c', site: 'https://somafm.com' },
  { id: 'dubstep', name: 'SomaFM · Dub Step Beyond', genre: 'Dubstep', url: 'https://ice1.somafm.com/dubstep-128-mp3', color: '#eab308', site: 'https://somafm.com' },
  { id: 'beatblender', name: 'SomaFM · Beat Blender', genre: 'Deep house', url: 'https://ice1.somafm.com/beatblender-128-mp3', color: '#ec4899', site: 'https://somafm.com' },
];
const BY_ID = new Map(STATIONS.map((s) => [s.id, s]));
const AUDIO_CT = /^(audio\/|application\/ogg|application\/octet-stream|video\/mp2t)/i;

const nowPlaying = new Map(); // station id / custom url -> { title, t }
const perUser = new Map();
let active = 0;
const MAX_PER_USER = 2, MAX_TOTAL = 60;
const openLim = new Limiter(20, 60000);

// Remove ICY metadata blocks (every `metaint` audio bytes: 1 length byte ×16, then that many metadata bytes).
function icyStripper(metaint, onTitle) {
  let left = metaint; let metaLeft = -1; let meta = [];
  return (chunk) => {
    const out = []; let i = 0;
    while (i < chunk.length) {
      if (metaLeft === -1) {
        const n = Math.min(left, chunk.length - i);
        out.push(chunk.subarray(i, i + n)); i += n; left -= n;
        if (left === 0) metaLeft = -2; // next byte is the length
      } else if (metaLeft === -2) {
        metaLeft = chunk[i++] * 16; meta = [];
        if (metaLeft === 0) { metaLeft = -1; left = metaint; }
      } else {
        const n = Math.min(metaLeft, chunk.length - i);
        meta.push(chunk.subarray(i, i + n)); i += n; metaLeft -= n;
        if (metaLeft === 0) {
          const txt = Buffer.concat(meta).toString('utf8').replace(/\0+$/, '');
          const m = /StreamTitle='([^']*)'/.exec(txt); if (m && m[1].trim()) onTitle(m[1].trim().slice(0, 160));
          metaLeft = -1; left = metaint;
        }
      }
    }
    return out.length === 1 ? out[0] : Buffer.concat(out);
  };
}

function openUpstream(url, hops = 0) {
  return new Promise((resolve, reject) => {
    let u; try { u = new URL(url); } catch { return reject(new HttpError(400, 'bad_url', 'That stream address does not look right')); }
    try { checkUrl(u); } catch (e) { return reject(e); }
    if (u.username || u.password) return reject(new HttpError(400, 'bad_url', 'Stream addresses cannot contain credentials'));
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({ method: 'GET', hostname: u.hostname.replace(/^\[|\]$/g, ''), port: u.port || undefined, path: u.pathname + u.search, lookup, timeout: 10000, agent: false,
      headers: { 'User-Agent': 'Nebulix-Pulse/1 (+radio relay)', Accept: 'audio/*,*/*;q=0.5', 'Icy-MetaData': '1' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && hops < 3) { res.resume(); return resolve(openUpstream(new URL(res.headers.location, u).href, hops + 1)); }
      if (res.statusCode !== 200) { res.resume(); return reject(new HttpError(502, 'stream_error', `The station answered ${res.statusCode}`)); }
      const ct = String(res.headers['content-type'] || 'audio/mpeg');
      if (!AUDIO_CT.test(ct)) { res.resume(); return reject(new HttpError(415, 'not_audio', 'That address is not an audio stream')); }
      resolve({ res, req, ct });
    });
    req.on('timeout', () => req.destroy(new HttpError(504, 'stream_timeout', 'The station did not answer in time')));
    req.on('error', (e) => reject(e instanceof HttpError ? e : new HttpError(502, 'stream_error', e.code === 'EBLOCKED' ? 'That address is not allowed' : 'Could not reach the station')));
    req.end();
  });
}

async function relay(c, url, key) {
  const uid = c.user.id; const mine = perUser.get(uid) || 0;
  if (mine >= MAX_PER_USER) throw new HttpError(429, 'too_many_streams', 'You already have 2 radio streams open');
  if (active >= MAX_TOTAL) throw new HttpError(503, 'busy', 'Radio is busy right now, try again soon');
  if (!openLim.hit(uid)) throw new HttpError(429, 'rate_limited', 'Slow down a little');
  const { res: up, req: upReq, ct } = await openUpstream(url);
  active++; perUser.set(uid, mine + 1);
  let closed = false;
  const done = () => { if (closed) return; closed = true; active--; const n = (perUser.get(uid) || 1) - 1; if (n <= 0) perUser.delete(uid); else perUser.set(uid, n); try { upReq.destroy(); } catch {} };
  const metaint = parseInt(up.headers['icy-metaint'], 10);
  const strip = metaint > 0 ? icyStripper(metaint, (title) => nowPlaying.set(key, { title, t: Date.now() })) : null;
  const icyName = String(up.headers['icy-name'] || '').slice(0, 80);
  c.res.writeHead(200, { 'Content-Type': ct.split(';')[0], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Station': encodeURIComponent(icyName) });
  up.on('data', (chunk) => { if (closed) return; const out = strip ? strip(chunk) : chunk; if (out.length && !c.res.write(out)) { up.pause(); c.res.once('drain', () => up.resume()); } });
  up.on('end', () => { done(); try { c.res.end(); } catch {} });
  up.on('error', () => { done(); try { c.res.end(); } catch {} });
  c.req.on('close', done); c.res.on('close', done);
  // response is written by us (headers already sent → router sends nothing)
}

// open.spotify.com/{intl-xx/}?(track|album|playlist|artist|episode|show)/<22 chars>  or  spotify:track:<id>
function spotifyRef(s) {
  s = s.trim();
  let m = /^spotify:(track|album|playlist|artist|episode|show):([A-Za-z0-9]{22})$/.exec(s);
  if (!m) m = /^https:\/\/open\.spotify\.com\/(?:intl-[a-z]{2}(?:-[a-z]{2})?\/)?(?:embed\/)?(track|album|playlist|artist|episode|show)\/([A-Za-z0-9]{22})(?:[/?#].*)?$/i.exec(s);
  return m ? { type: m[1].toLowerCase(), id: m[2], key: m[1].toLowerCase() + ':' + m[2] } : null;
}
// SoundCloud: any public soundcloud.com / m.soundcloud.com track, set or profile URL (on.soundcloud.com short links too).
// Playback uses SoundCloud's official HTML5 widget (w.soundcloud.com/player); title + artwork come from its oEmbed.
function soundcloudRef(s) {
  s = s.trim();
  const m = /^https:\/\/(?:on\.|m\.|www\.)?soundcloud\.com\/[A-Za-z0-9](?:[A-Za-z0-9._-]{0,120})(?:\/[A-Za-z0-9][A-Za-z0-9._%-]{0,120}){0,3}\/?(?:[?#].*)?$/i.exec(s);
  if (!m) return null;
  const canon = s.split(/[?#]/)[0].replace(/^https:\/\/(?:m\.|www\.)/i, 'https://');
  return { canon, key: 'sc:' + canon.toLowerCase() };
}
// YouTube Music / YouTube: a watch link, youtu.be short link, or a playlist link.
function youtubeRef(s) {
  s = s.trim();
  let v = null, list = null;
  let m = /^https:\/\/(?:www\.|m\.|music\.)?youtube\.com\/(?:watch|embed|v|shorts)(?:\/|\?)/i.exec(s);
  if (m) { try { const u = new URL(s); v = u.searchParams.get('v'); list = u.searchParams.get('list'); const seg = u.pathname.split('/').filter(Boolean); if (!v && (seg[0] === 'embed' || seg[0] === 'v' || seg[0] === 'shorts')) v = seg[1]; } catch { return null; } }
  else if ((m = /^https:\/\/youtu\.be\/([A-Za-z0-9_-]{6,20})(?:[?#].*)?$/i.exec(s))) { v = m[1]; try { list = new URL(s).searchParams.get('list'); } catch {} }
  else if ((m = /^https:\/\/(?:www\.|m\.|music\.)?youtube\.com\/playlist\?/i.exec(s))) { try { list = new URL(s).searchParams.get('list'); } catch { return null; } }
  else return null;
  if (v && !/^[A-Za-z0-9_-]{6,20}$/.test(v)) v = null;
  if (list && !/^[A-Za-z0-9_-]{10,60}$/.test(list)) list = null;
  if (!v && !list) return null;
  return { v, list, key: 'yt:' + (v || '') + ':' + (list || '') };
}

const oembedCache = new Map();
const oembedBase = () => process.env.SPOTIFY_OEMBED_URL || 'https://open.spotify.com/oembed'; // overridable for tests
const scOembedBase = () => process.env.SOUNDCLOUD_OEMBED_URL || 'https://soundcloud.com/oembed';
const ytOembedBase = () => process.env.YOUTUBE_OEMBED_URL || 'https://www.youtube.com/oembed';
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = (url.startsWith('https:') ? https : http).get(url, { timeout: 6000, headers: { 'User-Agent': 'Nebulix-Pulse/1', Accept: 'application/json' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('status ' + res.statusCode)); }
      const chunks = []; let n = 0;
      res.on('data', (d) => { n += d.length; if (n > 65536) req.destroy(); else chunks.push(d); });
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout'))); req.on('error', reject);
  });
}

module.exports = function register(r) {
  r.get('/api/music/stations', { auth: true }, async () => ({ stations: STATIONS.map((s) => ({ id: s.id, name: s.name, genre: s.genre, color: s.color, site: s.site, now: (nowPlaying.get(s.id) || {}).title || null })) }));

  r.get('/api/music/radio/:id', { auth: true, verified: true }, async (c) => {
    const st = BY_ID.get(c.params.id); if (!st) throw new HttpError(404, 'no_station', 'Unknown station');
    return relay(c, st.url, st.id);
  });

  // Your own stream address (Icecast/Shoutcast/any direct audio URL). Same SSRF guard as the proxy.
  r.get('/api/music/relay', { auth: true, verified: true }, async (c) => {
    const url = String(c.query.url || '').trim();
    if (!/^https?:\/\//i.test(url) || url.length > 600) throw new HttpError(400, 'bad_url', 'Use an http(s) stream address');
    return relay(c, url, 'u:' + url);
  });

  // Spotify links: title + cover from Spotify's public oEmbed (playback itself happens in Spotify's official embed).
  r.get('/api/music/spotify', { auth: true, limit: [40, 60000, 'user'] }, async (c) => {
    const ref = spotifyRef(String(c.query.url || ''));
    if (!ref) throw new HttpError(400, 'bad_spotify', 'Paste a Spotify track, album, playlist, artist, episode or show link');
    const hit = oembedCache.get(ref.key);
    if (hit && hit.exp > Date.now()) return hit.v;
    let meta = { title: null, thumb: null };
    try {
      const r2 = await fetchJson(oembedBase() + '?url=' + encodeURIComponent(`https://open.spotify.com/${ref.type}/${ref.id}`));
      meta = { title: typeof r2.title === 'string' ? r2.title.slice(0, 160) : null, thumb: typeof r2.thumbnail_url === 'string' && /^https:\/\/[a-z0-9.-]+\.(scdn\.co|spotifycdn\.com)\//i.test(r2.thumbnail_url) ? r2.thumbnail_url : null };
    } catch { /* offline or blocked: the embed still works in the browser */ }
    const v = { type: ref.type, id: ref.id, embed: `https://open.spotify.com/embed/${ref.type}/${ref.id}`, ...meta };
    oembedCache.set(ref.key, { v, exp: Date.now() + 6 * 3600e3 }); if (oembedCache.size > 500) oembedCache.delete(oembedCache.keys().next().value);
    return v;
  });

  // SoundCloud links: title + artwork from SoundCloud's public oEmbed; playback in SoundCloud's official widget.
  r.get('/api/music/soundcloud', { auth: true, limit: [40, 60000, 'user'] }, async (c) => {
    const ref = soundcloudRef(String(c.query.url || ''));
    if (!ref) throw new HttpError(400, 'bad_soundcloud', 'Paste a SoundCloud track, set or profile link');
    const hit = oembedCache.get(ref.key);
    if (hit && hit.exp > Date.now()) return hit.v;
    let meta = { title: null, thumb: null, author: null };
    try {
      const r2 = await fetchJson(scOembedBase() + '?format=json&url=' + encodeURIComponent(ref.canon));
      meta = {
        title: typeof r2.title === 'string' ? r2.title.slice(0, 160) : null,
        author: typeof r2.author_name === 'string' ? r2.author_name.slice(0, 80) : null,
        thumb: typeof r2.thumbnail_url === 'string' && /^https:\/\/[a-z0-9.-]+\.sndcdn\.com\//i.test(r2.thumbnail_url) ? r2.thumbnail_url : null,
      };
    } catch { /* offline or blocked: the widget still resolves the URL in the browser */ }
    const embed = 'https://w.soundcloud.com/player/?url=' + encodeURIComponent(ref.canon) + '&auto_play=false&hide_related=true&show_comments=false&show_user=true&show_reposts=false&visual=true&color=%23000000';
    const v = { url: ref.canon, embed, ...meta };
    oembedCache.set(ref.key, { v, exp: Date.now() + 6 * 3600e3 }); if (oembedCache.size > 500) oembedCache.delete(oembedCache.keys().next().value);
    return v;
  });

  // YouTube / YouTube Music links: title + thumbnail from YouTube's oEmbed; playback in the privacy-enhanced embed.
  r.get('/api/music/youtube', { auth: true, limit: [40, 60000, 'user'] }, async (c) => {
    const ref = youtubeRef(String(c.query.url || ''));
    if (!ref) throw new HttpError(400, 'bad_youtube', 'Paste a YouTube or YouTube Music video or playlist link');
    const hit = oembedCache.get(ref.key);
    if (hit && hit.exp > Date.now()) return hit.v;
    const embed = ref.v
      ? 'https://www.youtube-nocookie.com/embed/' + ref.v + (ref.list ? '?list=' + encodeURIComponent(ref.list) : '')
      : 'https://www.youtube-nocookie.com/embed/videoseries?list=' + encodeURIComponent(ref.list);
    const canon = ref.v ? 'https://www.youtube.com/watch?v=' + ref.v : 'https://www.youtube.com/playlist?list=' + ref.list;
    let meta = { title: null, thumb: ref.v ? 'https://i.ytimg.com/vi/' + ref.v + '/hqdefault.jpg' : null, author: null };
    try {
      const r2 = await fetchJson(ytOembedBase() + '?format=json&url=' + encodeURIComponent(canon));
      if (typeof r2.title === 'string') meta.title = r2.title.slice(0, 160);
      if (typeof r2.author_name === 'string') meta.author = r2.author_name.slice(0, 80);
    } catch { /* offline or blocked: the embed still works in the browser */ }
    const v = { v: ref.v || null, list: ref.list || null, type: ref.v ? 'video' : 'playlist', embed, ...meta };
    oembedCache.set(ref.key, { v, exp: Date.now() + 6 * 3600e3 }); if (oembedCache.size > 500) oembedCache.delete(oembedCache.keys().next().value);
    return v;
  });

  r.get('/api/music/now', { auth: true, limit: [120, 60000, 'user'] }, async (c) => {
    const key = c.query.id ? String(c.query.id) : c.query.url ? 'u:' + String(c.query.url) : '';
    const np = nowPlaying.get(key); return { title: np ? np.title : null, t: np ? np.t : 0 };
  });
};
module.exports.STATIONS = STATIONS;
module.exports.icyStripper = icyStripper;
module.exports.spotifyRef = spotifyRef;
module.exports.soundcloudRef = soundcloudRef;
module.exports.youtubeRef = youtubeRef;
