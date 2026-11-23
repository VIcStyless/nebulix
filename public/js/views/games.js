// Nebulix Games: one hub for everything you can play — a featured carousel, what is live right now, every Arcade
// game with your best score, competitions, 3D experiences and community worlds. #/games
import { h, mount, fmt } from '../util.js';
import { t, pick2 } from '../i18n.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { loading } from '../ui.js';
import { avatarEl } from '../cosmetics.js';

// id, emoji, gradient, name, short description, badge
const ARCADE = [
  ['dash', '⚡', ['#0ea5e9', '#6366f1'], 'Gravity Dash', 'Flip gravity to dodge the spikes.', 'new'],
  ['stack', '🏗️', ['#f59e0b', '#ef4444'], 'Star Stack', 'Drop each floor right on top of the last.', 'new'],
  ['ops', '🎖️', ['#334155', '#f97316'], 'Nebula Ops (3D)', 'First-person tactical shooter.'],
  ['snake', '🐍', ['#22c55e', '#14b8a6'], 'Nebula Snake', 'Eat stars, grow, don\'t crash.'],
  ['blocks', '🧱', ['#a855f7', '#6366f1'], 'Block Drop', 'Clear full lines.'],
  ['flap', '🪽', ['#38bdf8', '#a78bfa'], 'Nebula Flap', 'Fly through the gates.'],
  ['defenders', '👾', ['#4c1d95', '#db2777'], 'Star Defenders', 'Hold the line.'],
  ['bricks', '🧨', ['#ef4444', '#f59e0b'], 'Brick Breaker', 'Smash every brick.'],
  ['2048', '🔢', ['#eab308', '#f97316'], '2048', 'Merge tiles to 2048.'],
  ['stocks', '📈', ['#16a34a', '#0f766e'], 'Market Rush', 'Catch green candles.'],
  ['aim', '🎯', ['#dc2626', '#9333ea'], 'Aim Trainer', '30 seconds of targets.'],
  ['typing', '⌨️', ['#0891b2', '#1d4ed8'], 'Typing Test', 'Type fast and clean.'],
  ['paddle', '🏓', ['#0d9488', '#4f46e5'], 'Paddle Duel', 'Beat the CPU to 5.'],
  ['memory', '🧠', ['#c026d3', '#7c3aed'], 'Memory Sequence', 'Repeat the colours.'],
];
const COMPETE = [
  ['arena/royale', '🌪️', ['#4c1d95', '#0e7490'], 'Nebula Royale', 'Online battle royale with building. Up to 20 players.'],
  ['arena/ops', '🎯', ['#7c2d12', '#1e3a8a'], 'Nebula Ops · Assault', 'Online 5 vs 5: plant or defuse the core.'],
  ['boss', '👹', ['#7f1d1d', '#4c1d95'], 'World Boss', 'Every 2 hours, everyone vs one monster.'],
  ['tournaments', '🏆', ['#b45309', '#eab308'], 'Tournaments', 'Hourly, daily and weekly prizes.'],
  ['leagues', '🏅', ['#0e7490', '#6366f1'], 'Leagues', 'Bronze to Nebula, every week.'],
  ['clans', '🛡️', ['#9d174d', '#7c3aed'], 'Clans', 'Clan bank and Clan War.'],
  ['quiz', '❓', ['#7c3aed', '#ec4899'], 'Nebulix Quiz', 'Live quizzes with a PIN.'],
  ['arcade?tab=duels', '⚔️', ['#1e3a8a', '#0ea5e9'], 'Duels', '1v1 with friends.'],
];
const BIG = [
  ['worlds', '🌍', ['#0f766e', '#6d28d9'], 'Nebula Worlds', '3D parkour, hangouts and the World Builder.'],
  ['casino3d', '🎰', ['#831843', '#1e1b4b'], 'Casino 3D', 'Walk the casino floor (play money).'],
  ['avatar', '🧍', ['#1d4ed8', '#9333ea'], 'My 3D avatar', 'Dress up your avatar.'],
  ['music', '🎵', ['#be185d', '#7c3aed'], 'Pulse', 'Music, radio and DJ.'],
  ['play', '🕹️', ['#334155', '#0ea5e9'], 'Web games', 'Hundreds of browser games.'],
  ['library', '📚', ['#57534e', '#a16207'], 'Game library', 'Your backlog and hours.'],
  ['casino', '🎲', ['#14532d', '#a16207'], 'Casino', 'Play money only.'],
];
const SKY = { night: ['#0b1026', '#4c1d95'], sunset: ['#1e1b4b', '#f97316'], day: ['#38bdf8', '#e0f2fe'], neon: ['#020617', '#be185d'], void: ['#000', '#1e1b4b'], lava: ['#1c0a00', '#ea580c'], candy: ['#f9a8d4', '#c4b5fd'] };

const card = (href, emoji, [c1, c2], title, sub, badge) => h('a.gh-card', { href: '#/' + href, style: { '--c1': c1, '--c2': c2 } }, badge ? h('span.gh-badge.' + badge, badge === 'new' ? t('New') : badge === 'live' ? t('Live') : badge) : null,
  h('div.gh-art2', h('span', emoji)), h('div.gh-body', h('b', title), h('span', sub)));

export default {
  title: () => t('Nebulix Games'),
  async mount(root) {
    const inner = h('div.inner.gh'); mount(root, inner, loading()); let slide = 0; let timer = 0;
    const [live, me, ugc, chal] = await Promise.all([api.get('/api/live', { quiet: true }).catch(() => null), api.get('/api/arcade/me', { quiet: true }).catch(() => ({ games: {} })), api.get('/api/worlds/ugc?sort=top', { quiet: true }).catch(() => null), api.get('/api/challenges', { quiet: true }).catch(() => ({ items: [] }))]);
    const best = (id) => (me.games && me.games[id] ? me.games[id].best : 0);
    const slides = [];
    if (live && live.boss && live.boss.live) slides.push({ href: 'boss', art: live.boss.boss.icon, bg: `linear-gradient(135deg, #450a0a, ${live.boss.boss.color})`, title: pick2(live.boss.boss.n), text: t('A World Boss is here right now. {n} fighters — join them!', { n: live.boss.fighters }), cta: t('Fight now') });
    slides.unshift({ href: 'arena', art: '🌪️', bg: 'linear-gradient(135deg, #4c1d95, #0e7490)', title: 'Nebulix Arena', text: t('New: Nebula Royale (battle royale with building) and Nebula Ops online 5 vs 5. Bots fill the empty places.'), cta: t('Play online') });
    slides.push({ href: 'worlds', art: '🧱', bg: 'linear-gradient(135deg, #0f766e, #6d28d9)', title: t('Build your own world'), text: t('Make a 3D parkour course with the World Builder, test it and publish it. You earn coins when others finish it.'), cta: t('Open Nebula Worlds') });
    slides.push({ href: 'arcade?play=dash', art: '⚡', bg: 'linear-gradient(135deg, #0c4a6e, #6366f1)', title: 'Gravity Dash', text: t('New: flip gravity between floor and ceiling and survive as long as you can.'), cta: t('Play now') });
    if (live && live.tour) slides.push({ href: 'tournaments', art: '🏆', bg: 'linear-gradient(135deg, #78350f, #eab308)', title: t('Hourly tournament: {g}', { g: live.tour.gname }), text: t('Prize pool {n} coins. Join for free and play.', { n: fmt.coins(live.tour.pool) }), cta: t('Join') });
    slides.push({ href: 'arcade?play=stack', art: '🏗️', bg: 'linear-gradient(135deg, #7c2d12, #db2777)', title: 'Star Stack', text: t('New: drop each floor right on top of the last one. How high can you go?'), cta: t('Play now') });
    const hero = h('div');
    const paintHero = () => { const s = slides[slide % slides.length]; mount(hero, h('a.gh-hero', { href: '#/' + s.href, style: { '--gh-bg': s.bg } }, h('span.gh-art', s.art), h('span.pill', { style: 'align-self:flex-start;background:rgba(0,0,0,.35);color:#fff' }, '★ ' + t('Featured')), h('h2', s.title), h('p', s.text), h('span.btn.primary', { style: 'align-self:flex-start' }, icon('play', 14), s.cta)),
      h('div.gh-dots', slides.map((_, i) => h('button' + (i === slide % slides.length ? '.on' : ''), { 'aria-label': String(i + 1), onClick: () => { slide = i; paintHero(); } })))); };
    paintHero(); timer = setInterval(() => { slide++; paintHero(); }, 6500);
    const liveRow = [];
    if (live) {
      liveRow.push(card('boss', live.boss.boss.icon, ['#7f1d1d', live.boss.boss.color], live.boss.live ? pick2(live.boss.boss.n) : t('World Boss'), live.boss.live ? t('{n} fighters', { n: live.boss.fighters }) : t('Next one soon'), live.boss.live ? 'live' : null));
      if (live.tour) liveRow.push(card('tournaments', '🏆', ['#b45309', '#eab308'], live.tour.gname, t('Prize pool') + ' ' + fmt.coins(live.tour.pool), 'live'));
      liveRow.push(card('worlds', '🌍', ['#0f766e', '#6d28d9'], t('Nebula Worlds'), t('{n} online', { n: live.worldsOnline }), live.worldsOnline ? 'live' : null));
    }
    const chItems = chal.items.slice(0, 6);
    mount(inner, hero,
      chItems.length ? h('section.gh-sec', h('h3', '⚔️ ', t('Challenges for you')), h('div.ch-list', chItems.map((x) => h('a.ch-row' + (x.beaten ? '.beaten' : ''), { href: '#/arcade?play=' + x.game }, avatarEl(x.from, { size: 30 }),
        h('div.grow', h('b', t('@{u} challenges you in {g}', { u: x.from.username, g: x.gname })), h('div.tiny.muted', t('Score to beat: {s}', { s: fmt.num(x.score) }) + ' · ' + t('Your best: {s}', { s: fmt.num(x.myBest) }))),
        h('span.pill', x.beaten ? '✅ ' + t('Beaten') : t('Play now')))))) : null,
      liveRow.length ? h('section.gh-sec', h('h3', '🔴 ', t('Live now')), h('div.gh-row', liveRow)) : null,
      h('section.gh-sec', h('h3', icon('gamepad', 18), t('Nebulix Arcade'), h('span.tiny.muted', ' · ' + t('coins and personal bests'))), h('div.gh-row', ARCADE.map(([id, e, c, n, d, b]) => card('arcade?play=' + id, e, c, t(n), best(id) ? t('Best: {s}', { s: fmt.num(best(id)) }) : t(d), b)))),
      h('section.gh-sec', h('h3', icon('trophy', 18), t('Compete')), h('div.gh-row', COMPETE.map(([id, e, c, n, d]) => card(id, e, c, t(n), t(d))))),
      ugc && ugc.worlds.length ? h('section.gh-sec', h('h3', '🧱 ', t('Community worlds')), h('div.gh-row', ugc.worlds.slice(0, 8).map((w) => card('worlds', w.kind === 'obby' ? '🧱' : '🎪', SKY[w.sky] || SKY.night, w.name, t('by @{u}', { u: w.owner ? w.owner.username : '?' }) + ' · ❤ ' + w.likes, w.online ? 'live' : null)))) : null,
      h('section.gh-sec', h('h3', icon('cube', 18), t('Worlds, 3D and more')), h('div.gh-row', BIG.map(([id, e, c, n, d]) => card(id, e, c, t(n), t(d))))));
    return () => clearInterval(timer);
  },
};
