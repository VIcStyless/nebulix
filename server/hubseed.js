'use strict';
// 14.1: official Nebulix apps published in Nebulix Hub. Each one is a single HTML file in server/hubapps/, run like any
// other Hub app (sandboxed, never with anyone's session). They are owned by the site owner's account, tagged
// "official", and updated in place (a new version) whenever the HTML file changes. Covers are drawn as SVG.
const fs = require('fs');
const path = require('path');
const { S } = require('./state');
const { rid, now } = require('./util');
const blobs = require('./blobs');

const APPS = [
  { slug: 'pixel', title: 'Pixel Forge', tags: ['official', 'art', 'pixel', 'editor'], c: ['#8b7bff', '#3ee6c4'], glyph: 'grid',
    desc: 'A pixel art editor: pencil, eraser, fill, colour picker, lines and boxes, mirror drawing, undo/redo, sizes from 16 to 64 and PNG export. Your drawing is saved automatically.' },
  { slug: 'beats', title: 'Beat Lab', tags: ['official', 'music', 'drums', 'sequencer'], c: ['#ff4d8d', '#22d3ee'], glyph: 'bars',
    desc: 'A 16-step drum machine with 8 synthesized instruments, tempo and swing, 4 patterns, a random beat button and a live visualizer. Space plays and stops.' },
  { slug: 'board', title: 'Flow Board', tags: ['official', 'productivity', 'kanban', 'tasks'], c: ['#4f8cff', '#22c55e'], glyph: 'cols',
    desc: 'A kanban board: drag cards between To do, Doing, Review and Done, colour them, search, and watch your progress bar fill up.' },
  { slug: 'sketch', title: 'Sketch Board', tags: ['official', 'art', 'whiteboard', 'drawing'], c: ['#f59e0b', '#ef4444'], glyph: 'pen',
    desc: 'An infinite-feeling whiteboard: smooth pen, highlighter, lines, arrows, boxes and circles, 8 colours, grid or dotted paper, dark mode and PNG export.' },
  { slug: 'writer', title: 'Markdown Writer', tags: ['official', 'writing', 'markdown', 'notes'], c: ['#f59e0b', '#a855f7'], glyph: 'text',
    desc: 'Write in Markdown with a live preview, several documents, focus mode, light and dark themes, word count and reading time, and .md download.' },
  { slug: 'starter', kind: 'game', title: 'Starter game (template)', tags: ['official', 'template', 'game', 'gamedev'], c: ['#8b7bff', '#ffd166'], glyph: 'dots',
    desc: 'The starter template for Hub creators: a tiny star-catching game that uses the Game API (player name, leaderboard, an achievement and a multiplayer room). Download it from Create games or remix it.' },
  { slug: 'palette', title: 'Palette Lab', tags: ['official', 'design', 'colors', 'palette'], c: ['#22d3ee', '#ff5fa8'], glyph: 'dots',
    desc: 'Generate colour palettes with Space: random, analogous, monochrome, triadic, complementary or pastel. Lock the colours you like, check contrast and copy the CSS.' },
];

const GLYPH = {
  grid: '<g fill="#fff" opacity=".9">' + [0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((j) => ((i + j) % 2 ? '' : `<rect x="${250 + i * 40}" y="${110 + j * 40}" width="34" height="34" rx="6"/>`)).join('')).join('') + '</g>',
  bars: '<g fill="#fff" opacity=".92">' + [70, 120, 90, 150, 60, 130, 100].map((hh, i) => `<rect x="${226 + i * 28}" y="${270 - hh}" width="18" height="${hh}" rx="8"/>`).join('') + '</g>',
  cols: '<g fill="#fff">' + [0, 1, 2].map((i) => `<rect x="${222 + i * 66}" y="100" width="54" height="170" rx="12" opacity=".25"/>` + [0, 1, 2].slice(0, 3 - i).map((j) => `<rect x="${228 + i * 66}" y="${110 + j * 42}" width="42" height="34" rx="8" opacity=".95"/>`).join('')).join('') + '</g>',
  pen: '<g fill="none" stroke="#fff" stroke-width="16" stroke-linecap="round"><path d="M220 250 C260 120 320 300 380 150" opacity=".95"/><path d="M230 280 h150" opacity=".35"/></g>',
  text: '<g fill="#fff"><text x="300" y="215" text-anchor="middle" font-family="system-ui,sans-serif" font-size="120" font-weight="900">M↓</text></g>',
  dots: '<g>' + ['#ff5fa8', '#ffd166', '#06d6a0', '#118ab2', '#8b7bff'].map((c, i) => `<rect x="${215 + i * 36}" y="110" width="32" height="160" rx="10" fill="${c}" stroke="#fff" stroke-width="3"/>`).join('') + '</g>',
};
function coverSvg(a) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="338" viewBox="0 0 600 338"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a.c[0]}"/><stop offset="1" stop-color="${a.c[1]}"/></linearGradient>
<radialGradient id="r" cx=".8" cy=".1" r=".9"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
<rect width="600" height="338" fill="#0b0a18"/><rect width="600" height="338" fill="url(#g)" opacity=".85"/><rect width="600" height="338" fill="url(#r)"/>
<circle cx="90" cy="290" r="140" fill="#fff" opacity=".07"/><circle cx="540" cy="40" r="90" fill="#000" opacity=".12"/>${GLYPH[a.glyph] || ''}
<text x="300" y="318" text-anchor="middle" font-family="system-ui,sans-serif" font-size="28" font-weight="800" fill="#fff">${a.title}</text></svg>`;
}

function ownerId() { const o = Object.values(S.users).find((u) => u.role === 'owner' && !u.deleted); return o ? o.id : null; }
function seed() {
  const owner = ownerId(); if (!owner) return false;
  const items = S.store.table('hubitems'); let changed = false;
  for (const a of APPS) {
    let html; try { html = fs.readFileSync(path.join(__dirname, 'hubapps', a.slug + '.html')); } catch { continue; }
    const sha = blobs.putBuffer(html).sha; const thumb = blobs.putBuffer(Buffer.from(coverSvg(a))).sha;
    let it = Object.values(items).find((x) => x.official === a.slug);
    if (!it) {
      it = { id: rid(8), official: a.slug, owner, kind: a.kind || 'app', title: a.title, desc: a.desc, tags: a.tags, created: now(), views: 0, likes: [], size: html.length, public: true, duration: 0,
        allowDownload: true, allowRemix: true, runMode: 'sandbox', files: { 'index.html': { sha, size: html.length } }, entry: 'index.html', version: 1,
        versions: [{ v: 1, at: now(), note: 'Published by Nebulix', size: html.length, files: 1 }], thumb, thumbType: 'image/svg+xml' };
      items[it.id] = it; changed = true;
    } else if (it.files && it.files['index.html'] && it.files['index.html'].sha !== sha) {
      it.files = { 'index.html': { sha, size: html.length } }; it.size = html.length; it.version = (it.version || 1) + 1; it.updated = now();
      it.versions = (it.versions || []).concat({ v: it.version, at: now(), note: 'Updated by Nebulix', size: html.length, files: 1 }).slice(-30); changed = true;
    }
    if (it.thumb !== thumb) { it.thumb = thumb; it.thumbType = 'image/svg+xml'; changed = true; }
  }
  if (changed) S.store.touch('hubitems');
  return true;
}
function start() { setTimeout(() => { try { if (!seed()) setTimeout(() => { try { seed(); } catch (e) { console.error('[hubseed]', e); } }, 60000); } catch (e) { console.error('[hubseed]', e); } }, 2500); }
module.exports = { start, seed, APPS };
