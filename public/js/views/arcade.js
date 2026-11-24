// Arcade: Nebula Snake, 2048, Aim Trainer, Typing Test (personal bests + boards) and live 1v1 duels with friends.
import { h, mount, fmt, clamp, ls } from '../util.js';
import { t, getLang } from '../i18n.js';
import { api, ws } from '../api.js';
import { S, bus } from '../state.js';
import { icon } from '../icons.js';
import { avatarEl, nameEl } from '../cosmetics.js';
import { tabsEl, segEl, toast, toastErr, loading, emptyState, confetti, busy } from '../ui.js';
import { sfx } from '../sfx.js';
import { MORE_GAMES, MORE_FNS } from './arcade-more.js';
import { THREE_GAMES, THREE_FNS } from './arcade-3d.js';
import { PLUS_GAMES, PLUS_FNS } from './arcade-plus.js';
import { CHESS_GAMES, CHESS_FNS } from './arcade-chess.js';
import { CARD_GAMES, CARD_FNS } from './arcade-cards.js';

const GAMES = [
  ['snake', 'Nebula Snake', 'snake', 'Eat stars, grow, don\'t crash.', 'pts'], ['2048', '2048', 'grid', 'Slide and merge tiles to reach 2048.', 'pts'],
  ['aim', 'Aim Trainer', 'target', 'Hit as many targets as you can in 30 seconds.', 'hits'], ['typing', 'Typing Test', 'keyboard', 'Type fast and clean for 30 seconds.', 'WPM'],
  ...THREE_GAMES,
  ...MORE_GAMES,
  ...PLUS_GAMES,
  ...CHESS_GAMES,
  ...CARD_GAMES,
];
const DUELS = [['ttt', 'Tic-Tac-Toe', 'x'], ['c4', 'Connect Four', 'grid'], ['rps', 'Rock Paper Scissors', 'scissors']];
const RPS_IC = { r: 'rock', p: 'paper', s: 'scissors' };
const RPS = new Proxy({}, { get: (_, k) => ({ r: t('Rock'), p: t('Paper'), s: t('Scissors') })[k] });
const css = (k, d) => getComputedStyle(document.documentElement).getPropertyValue(k).trim() || d;
const WORDS = {
  en: 'the of and to in is you that it he was for on are as with his they at be this have from or one had by word but not what all were we when your can said there use an each which she do how their if will up other about out many then them these so some her would make like him into time has look two more write go see number no way could people my than first water been call who oil its now find long down day did get come made may part over new sound take only little work know place year live me back give most very after thing our just name good sentence man think say great where help through much before line right too mean old any same tell boy follow came want show also around form three small set put end does another well large must big even such because turn here why ask went men read need land different home us move try kind hand picture again change off play spell air away animal house point page letter mother answer found study still learn should world',
  es: 'de la que el en y a los se del las un por con no una su para es al lo como más pero sus le ya o este sí porque esta entre cuando muy sin sobre también me hasta hay donde quien desde todo nos durante todos uno les ni contra otros ese eso ante ellos e esto mí antes algunos qué unos yo otro otras otra él tanto esa estos mucho quienes nada muchos cual poco ella estar estas algunas algo nosotros mi mis tú te ti tu tus ellas nosotras vosotros vosotras os mío mía míos mías tuyo tuya tuyos tuyas suyo suya suyos suyas nuestro nuestra casa juego mundo tiempo vida día año vez parte forma caso mano lugar hombre cosa',
  pt: 'de a o que e do da em um para é com não uma os no se na por mais as dos como mas foi ao ele das tem à seu sua ou ser quando muito há nos já está eu também só pelo pela até isso ela entre era depois sem mesmo aos ter seus quem nas me esse eles estão você tinha foram essa num nem suas meu às minha têm numa pelos elas havia seja qual será nós tenho lhe deles essas esses pelas este fosse dele tu te vocês vos lhes meus minhas casa jogo mundo tempo vida dia ano vez parte forma caso mão lugar homem coisa',
  fr: 'de la le et les des en un du une que est pour qui dans par plus pas au sur ne se ce il sont avec ou son aux elle nous comme mais on leur bien ses tout été être fait cette entre deux sans peut même aussi dont nos très après tous lui temps faire encore autre donc vous moins avant elles monde vie jour année fois partie forme cas main lieu homme chose maison jeu ville pays enfant femme histoire travail point eau question nuit soir matin terre mer ciel feu porte',
  de: 'der die und in den von zu das mit sich des auf für ist im dem nicht ein eine als auch es an werden aus er hat dass sie nach wird bei einer um am sind noch wie einem über einen so zum war haben nur oder aber vor zur bis mehr durch man sein wurde sei hier jahr zeit welt leben tag mal teil form fall hand ort mann sache haus spiel stadt land kind frau geschichte arbeit punkt wasser frage nacht abend morgen erde meer himmel feuer tür weg kopf auge',
  it: 'di e il la che in a per un è non una con del da le si dei come io lo ma più al ha anche alla nel sono questo ci sua mi gli delle o se della suo era tutto ne quando molto me hanno fare lei solo così cosa poi tempo mondo vita giorno anno volta parte forma caso mano luogo uomo casa gioco città paese bambino donna storia lavoro punto acqua domanda notte sera mattina terra mare cielo fuoco porta strada testa occhio',
};

export default {
  title: () => t('Arcade'),
  async mount(root, ctx) {
    let tab = ctx.query.get('duel') ? 'duels' : (ctx.query.get('tab') || 'games'); let me = { games: {}, coinsToday: 0, cap: 60 }; let game = null; let openDuel = ctx.query.get('duel') || null; let duelData = { live: [], recent: [] };
    const offs = []; const inner = h('div.inner.arc'); mount(root, inner);
    const tabs = tabsEl([['games', t('Games'), 'gamepad'], ['duels', t('Duels'), 'users'], ['boards', t('Leaderboards'), 'star']], tab, (v) => { tab = v; stopGame(); paint(); });
    const body = h('div'); inner.append(h('div.arc-head', h('div', h('h2', t('Arcade')), h('p.muted', { style: 'margin:0' }, t('Quick games, personal bests and 1v1 duels with friends. Personal bests earn a few coins (max {n}/day).', { n: 60 }))), h('div.grow'), h('span.pill.arc-today')), tabs, body);
    const loadMe = async () => { try { me = await api.get('/api/arcade/me'); const p = inner.querySelector('.arc-today'); if (p) p.textContent = t('Today: {n}/{c}', { n: me.coinsToday, c: me.cap }); } catch {} };
    const loadDuels = async () => { try { duelData = await api.get('/api/duels'); } catch {} };
    await Promise.all([loadMe(), loadDuels()]);
    const setAct = (label, kind = 'arcade') => ws.send(label ? { t: 'act', kind, label: label.slice(0, 78) } : { t: 'act' });
    // Game keys: arrows, or W/A/S/D by physical position (so ZQSD on AZERTY works too). Ignored while typing
    // somewhere, with modifier keys held, or when another desktop-mode window has the focus.
    const dirKey = (e, map) => (e.ctrlKey || e.metaKey || e.altKey ? null : map[e.key.startsWith('Arrow') ? e.key : e.code] || null);
    const keysForMe = (e) => { const tg = e.target; if (tg && tg.closest && tg.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return false; const w = root.closest('.os-win'); return !w || w.classList.contains('focused'); };

    function paint() { ({ games: paintGames, duels: paintDuels, boards: paintBoards }[tab] || paintGames)(); }
    // ---------- games hub ----------
    function paintGames() {
      if (game) return;
      mount(body, h('div.arc-grid', GAMES.map(([id, name, e, desc, unit]) => { const g = me.games[id] || {}; return h('button.arc-card', { dataset: { g: id }, onClick: () => startGame(id) }, h('div.arc-art', icon(e, 30)), h('b', t(name)), h('span.small.muted', t(desc)), h('div.row.between.small', h('span', t('Best: {s}', { s: g.best ? fmt.num(g.best) + ' ' + t(unit) : '—' })), h('span.muted', t('{n} runs', { n: g.runs || 0 })))); })));
    }
    async function submit(id, score, ms) {
      try {
        const r = await api.post('/api/arcade/score', { game: id, score: Math.round(score), ms: Math.round(ms) });
        if (r.pb) { sfx.win(); confetti(innerWidth / 2, innerHeight / 3, 60); toast(t('New personal best: {s}!', { s: fmt.num(r.best) }) + (r.coins ? ` +${r.coins} 🪙` : ''), 'coin'); }
        else if (r.coins) toast(t('+{n} coins', { n: r.coins }), 'coin');
        loadMe();
        return r;
      } catch (e) { if (e.status !== 429) toastErr(e); return null; }
    }
    let stopFn = null;
    function stopGame() { if (stopFn) { try { stopFn(); } catch {} stopFn = null; } game = null; setAct(null); }
    function startGame(id) {
      stopGame(); game = id; const [, name, e] = GAMES.find((g) => g[0] === id);
      const stage = h('div.arc-stage'); const hud = h('div.arc-hud');
      mount(body, h('div.col', h('div.row', h('button.btn.ghost', { onClick: () => { stopGame(); paint(); } }, icon('back', 16), t('Arcade')), h('h3', { style: 'margin:0;display:flex;align-items:center;gap:8px' }, icon(e, 20), t(name)), h('div.grow'), hud), stage));
      setAct(t('Playing {g}', { g: t(name) }));
      const best = (me.games[id] || {}).best || 0;
      const end = (score, ms) => submit(id, score, ms);
      stopFn = ({ snake: snakeGame, 2048: game2048, aim: aimGame, typing: typingGame, ...MORE_FNS, ...THREE_FNS, ...PLUS_FNS, ...CHESS_FNS, ...CARD_FNS })[id](stage, hud, end, best, { root, css, keysForMe });
    }

    // ---------- Snake ----------
    function snakeGame(stage, hud, end, best) {
      const N = 20; const cv = h('canvas.arc-canvas', { width: 520, height: 520, tabindex: 0 }); const ov = h('div.arc-ov'); stage.append(h('div.arc-board', cv, ov));
      const g = cv.getContext('2d'); let snake, dir, queue, food, score, alive, tickMs, timer, t0, parts = [], raf;
      const C1 = css('--accent', '#8b5cf6'), C2 = css('--accent2', '#38bdf8');
      const reset = () => { snake = [{ x: 8, y: 10 }, { x: 7, y: 10 }, { x: 6, y: 10 }]; dir = { x: 1, y: 0 }; queue = []; score = 0; alive = true; tickMs = 130; placeFood(); paintHud(); };
      const placeFood = () => { do { food = { x: Math.floor(Math.random() * N), y: Math.floor(Math.random() * N) }; } while (snake.some((s) => s.x === food.x && s.y === food.y)); };
      const paintHud = () => mount(hud, h('span.pill', t('Score: {s}', { s: score })), h('span.pill', t('Best: {s}', { s: Math.max(best, score) })));
      const step = () => {
        if (queue.length) { const d = queue.shift(); if (d.x !== -dir.x || d.y !== -dir.y) dir = d; }
        const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
        if (head.x < 0 || head.y < 0 || head.x >= N || head.y >= N || snake.some((s, i) => i < snake.length - 1 && s.x === head.x && s.y === head.y)) return die();
        snake.unshift(head);
        if (head.x === food.x && head.y === food.y) { score++; sfx.coin && sfx.coin(); for (let i = 0; i < 14; i++) parts.push({ x: (food.x + 0.5) * 26, y: (food.y + 0.5) * 26, vx: (Math.random() - 0.5) * 240, vy: (Math.random() - 0.5) * 240, l: 1 }); placeFood(); tickMs = Math.max(78, tickMs - 2); paintHud(); }
        else snake.pop();
        timer = setTimeout(step, tickMs);
      };
      const die = () => { alive = false; clearTimeout(timer); sfx.lose && sfx.lose(); const ms = performance.now() - t0; showOver(score, ms); if (score > 0) end(score, ms).then((r) => { if (r) best = r.best; paintHud(); }); };
      const draw = () => {
        raf = requestAnimationFrame(draw); const s = 26; g.clearRect(0, 0, 520, 520);
        g.fillStyle = 'rgba(255,255,255,.025)'; for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) if ((x + y) % 2) g.fillRect(x * s, y * s, s, s);
        const pulse = 0.75 + 0.25 * Math.sin(performance.now() / 160); g.shadowColor = C2; g.shadowBlur = 16 * pulse; g.fillStyle = '#fde68a'; star(g, (food.x + 0.5) * s, (food.y + 0.5) * s, 10 * pulse, 4.5 * pulse); g.shadowBlur = 0;
        snake.forEach((p, i) => { const k = i / snake.length; g.fillStyle = mixHex(C1, C2, k); g.shadowColor = C1; g.shadowBlur = i === 0 ? 14 : 0; rr(g, p.x * s + 2, p.y * s + 2, s - 4, s - 4, 7); g.fill(); });
        g.shadowBlur = 0; const hd = snake[0]; g.fillStyle = '#fff'; const ex = dir.y !== 0 ? 5 : 0, ey = dir.x !== 0 ? 5 : 0; g.beginPath(); g.arc((hd.x + 0.5) * s + dir.x * 4 - ex, (hd.y + 0.5) * s + dir.y * 4 - ey, 3, 0, 7); g.arc((hd.x + 0.5) * s + dir.x * 4 + ex, (hd.y + 0.5) * s + dir.y * 4 + ey, 3, 0, 7); g.fill();
        parts = parts.filter((p) => (p.l -= 0.03) > 0); for (const p of parts) { p.x += p.vx / 60; p.y += p.vy / 60; g.fillStyle = `rgba(253,230,138,${p.l})`; g.fillRect(p.x, p.y, 3, 3); }
      };
      const showOver = (sc) => mount(ov, h('div.arc-ovc', h('h3', alive ? t('Nebula Snake') : t('Game over')), !alive ? h('div.arc-big', String(sc)) : h('p.muted', t('Arrows / WASD or swipe')), h('button.btn.primary', { onClick: begin }, alive ? t('Start') : t('Play again'))));
      const begin = () => { mount(ov); ov.classList.add('hide'); reset(); t0 = performance.now(); clearTimeout(timer); timer = setTimeout(step, tickMs); cv.focus(); };
      const key = (e) => { const m = dirKey(e, { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], KeyW: [0, -1], KeyS: [0, 1], KeyA: [-1, 0], KeyD: [1, 0] }); if (!m || !root.isConnected || !keysForMe(e)) return; if (!alive || ov.classList.contains('hide') === false) { if (e.key.startsWith('Arrow')) { e.preventDefault(); } return; } e.preventDefault(); if (queue.length < 3) queue.push({ x: m[0], y: m[1] }); };
      let sw = null; cv.addEventListener('pointerdown', (e) => { sw = { x: e.clientX, y: e.clientY }; }); cv.addEventListener('pointerup', (e) => { if (!sw) return; const dx = e.clientX - sw.x, dy = e.clientY - sw.y; sw = null; if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return; queue.push(Math.abs(dx) > Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) }); });
      document.addEventListener('keydown', key); reset(); alive = true; ov.classList.remove('hide'); showOver(0); draw();
      return () => { clearTimeout(timer); cancelAnimationFrame(raf); document.removeEventListener('keydown', key); };
    }

    // ---------- 2048 ----------
    function game2048(stage, hud, end, best) {
      const board = h('div.g2048', { tabindex: 0 }); const ov = h('div.arc-ov.hide'); stage.append(h('div.arc-board.g2048wrap', board, ov));
      let tiles = [], score = 0, id = 0, t0 = performance.now(), over = false, won = false;
      for (let i = 0; i < 16; i++) board.appendChild(h('div.g-cell'));
      const els = new Map();
      const paintHud = () => mount(hud, h('span.pill', t('Score: {s}', { s: fmt.num(score) })), h('span.pill', t('Best: {s}', { s: fmt.num(Math.max(best, score)) })), h('button.btn.sm', { onClick: restart }, t('New game')));
      const add = () => { const free = []; for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) if (!tiles.some((x) => x.r === r && x.c === c)) free.push([r, c]); if (!free.length) return; const [r, c] = free[Math.floor(Math.random() * free.length)]; tiles.push({ id: ++id, v: Math.random() < 0.9 ? 2 : 4, r, c, isNew: true }); };
      const render = () => {
        const seen = new Set();
        for (const x of tiles) { seen.add(x.id); let el = els.get(x.id); if (!el) { el = h('div.g-tile'); els.set(x.id, el); board.appendChild(el); } el.textContent = x.v; el.dataset.v = x.v > 2048 ? 'big' : String(x.v); el.style.setProperty('--r', x.r); el.style.setProperty('--c', x.c); el.classList.toggle('pop', !!x.isNew); el.classList.toggle('merge', !!x.merged); x.isNew = false; x.merged = false; }
        for (const [k, el] of els) if (!seen.has(k)) { el.remove(); els.delete(k); }
        paintHud();
      };
      const move = (dr, dc) => {
        if (over) return; let moved = false; const order = [0, 1, 2, 3]; if (dr > 0 || dc > 0) order.reverse(); const grid = {}; for (const x of tiles) grid[x.r + ',' + x.c] = x; const mergedIds = new Set(); const removed = new Set();
        for (const a of order) for (const b of order) {
          const r = dr ? a : b, c = dc ? a : b; const x = grid[r + ',' + c]; if (!x) continue;
          let nr = r, nc = c;
          while (true) { const tr = nr + dr, tc = nc + dc; if (tr < 0 || tr > 3 || tc < 0 || tc > 3) break; const o = grid[tr + ',' + tc]; if (!o) { nr = tr; nc = tc; continue; } if (o.v === x.v && !mergedIds.has(o.id)) { delete grid[r + ',' + c]; o.v *= 2; o.merged = true; mergedIds.add(o.id); removed.add(x.id); x.r = tr; x.c = tc; score += o.v; moved = true; if (o.v === 2048 && !won) { won = true; confetti(innerWidth / 2, innerHeight / 3, 120); toast('2048!', 'good'); } } break; }
          if (!removed.has(x.id) && (nr !== r || nc !== c)) { delete grid[r + ',' + c]; x.r = nr; x.c = nc; grid[nr + ',' + nc] = x; moved = true; }
        }
        if (!moved) return; render(); setTimeout(() => { tiles = tiles.filter((x) => !removed.has(x.id)); add(); render(); if (!canMove()) finish(); }, 110);
      };
      const canMove = () => { if (tiles.length < 16) return true; const g = {}; for (const x of tiles) g[x.r + ',' + x.c] = x.v; for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { if (g[r + ',' + c] === g[r + ',' + (c + 1)] || g[r + ',' + c] === g[(r + 1) + ',' + c]) return true; } return false; };
      const finish = () => { over = true; const ms = performance.now() - t0; mount(ov, h('div.arc-ovc', h('h3', t('No more moves')), h('div.arc-big', fmt.num(score)), h('button.btn.primary', { onClick: restart }, t('Play again')))); ov.classList.remove('hide'); if (score > 0) end(score, ms).then((r) => { if (r) best = r.best; paintHud(); }); };
      function restart() { for (const el of els.values()) el.remove(); els.clear(); tiles = []; score = 0; over = false; won = false; t0 = performance.now(); ov.classList.add('hide'); add(); add(); render(); board.focus(); }
      const key = (e) => { if (!root.isConnected) return; const m = dirKey(e, { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], KeyW: [-1, 0], KeyS: [1, 0], KeyA: [0, -1], KeyD: [0, 1] }); if (!m || !keysForMe(e)) return; e.preventDefault(); move(m[0], m[1]); };
      let sw = null; board.addEventListener('pointerdown', (e) => { sw = { x: e.clientX, y: e.clientY }; }); board.addEventListener('pointerup', (e) => { if (!sw) return; const dx = e.clientX - sw.x, dy = e.clientY - sw.y; sw = null; if (Math.max(Math.abs(dx), Math.abs(dy)) < 20) return; if (Math.abs(dx) > Math.abs(dy)) move(0, Math.sign(dx)); else move(Math.sign(dy), 0); });
      document.addEventListener('keydown', key); restart();
      return () => document.removeEventListener('keydown', key);
    }

    // ---------- Aim trainer ----------
    function aimGame(stage, hud, end) {
      const area = h('div.aim-area'); const ov = h('div.arc-ov'); stage.append(h('div.arc-board.aimwrap', area, ov));
      let hits = 0, shots = 0, t0 = 0, run = false, spawnT = 0, clock = 0; const DUR = 30000;
      const paintHud = () => { const left = run ? Math.max(0, Math.ceil((DUR - (performance.now() - t0)) / 1000)) : 30; mount(hud, h('span.pill', left + 's'), h('span.pill', t('Hits: {n}', { n: hits })), h('span.pill', t('Accuracy: {p}%', { p: shots ? Math.round(hits / shots * 100) : 100 }))); };
      const spawn = () => {
        if (!run) return; const r = area.getBoundingClientRect(); const size = clamp(70 - hits * 0.6, 34, 70);
        const tg = h('button.aim-t', { style: `left:${Math.random() * (r.width - size)}px;top:${Math.random() * (r.height - size)}px;width:${size}px;height:${size}px`, 'aria-label': 'target', onPointerdown: (e) => { e.stopPropagation(); hits++; shots++; sfx.click(); tg.classList.add('hit'); setTimeout(() => tg.remove(), 160); paintHud(); } });
        area.appendChild(tg); setTimeout(() => { if (tg.isConnected && !tg.classList.contains('hit')) { tg.classList.add('gone'); setTimeout(() => tg.remove(), 200); } }, 1300);
        spawnT = setTimeout(spawn, clamp(620 - hits * 6, 330, 620));
      };
      area.addEventListener('pointerdown', () => { if (run) { shots++; paintHud(); } });
      const finish = () => { run = false; clearTimeout(spawnT); clearInterval(clock); area.querySelectorAll('.aim-t').forEach((x) => x.remove()); const ms = performance.now() - t0; mount(ov, h('div.arc-ovc', h('h3', t('Time!')), h('div.arc-big', String(hits)), h('p.muted', t('Accuracy: {p}%', { p: shots ? Math.round(hits / shots * 100) : 0 })), h('button.btn.primary', { onClick: begin }, t('Play again')))); ov.classList.remove('hide'); if (hits > 0) end(hits, ms); };
      const begin = () => { hits = 0; shots = 0; run = true; t0 = performance.now(); ov.classList.add('hide'); spawn(); clock = setInterval(() => { paintHud(); if (performance.now() - t0 >= DUR) finish(); }, 250); paintHud(); };
      mount(ov, h('div.arc-ovc', h('h3', t('Aim Trainer')), h('p.muted', t('Click the targets before they fade. 30 seconds.')), h('button.btn.primary', { onClick: begin }, t('Start')))); paintHud();
      return () => { run = false; clearTimeout(spawnT); clearInterval(clock); };
    }

    // ---------- Typing test ----------
    function typingGame(stage, hud, end) {
      const list = (WORDS[getLang()] || WORDS.en).split(' '); let words = []; let idx = 0, correct = 0, errors = 0, t0 = 0, run = false, clock = 0; const DUR = 30000;
      const view = h('div.type-words'); const inp = h('input.input.type-in', { autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: t('Start typing to begin…'), 'aria-label': t('Type here') }); const ov = h('div.arc-ov.hide');
      stage.append(h('div.arc-board.typewrap', view, inp, ov));
      const gen = () => { words = Array.from({ length: 120 }, () => list[Math.floor(Math.random() * list.length)]); idx = 0; };
      const wpm = () => { const min = Math.max(1, performance.now() - t0) / 60000; return Math.round(correct / 5 / min); };
      const paintHud = () => { const left = run ? Math.max(0, Math.ceil((DUR - (performance.now() - t0)) / 1000)) : 30; mount(hud, h('span.pill', left + 's'), h('span.pill', `${run ? wpm() : 0} WPM`), h('span.pill', t('Errors: {n}', { n: errors }))); };
      const paintWords = () => { mount(view, words.slice(Math.max(0, idx - 8), idx + 40).map((w, i) => { const k = i + Math.max(0, idx - 8); return h('span.tw' + (k < idx ? (words[k].ok ? '.ok' : '.bad') : k === idx ? '.cur' : ''), String(w)); })); };
      inp.addEventListener('input', () => {
        if (!run && inp.value.trim()) { run = true; t0 = performance.now(); clock = setInterval(() => { paintHud(); if (performance.now() - t0 >= DUR) finish(); }, 250); }
        const v = inp.value; const target = String(words[idx]);
        if (v.endsWith(' ')) { const typed = v.trim(); const ok = typed === target; words[idx] = Object.assign(new String(target), { ok }); if (ok) correct += target.length + 1; else errors++; idx++; inp.value = ''; paintWords(); }
        else inp.classList.toggle('bad', !target.startsWith(v));
      });
      const finish = () => { run = false; clearInterval(clock); inp.disabled = true; const ms = performance.now() - t0; const score = wpm(); mount(ov, h('div.arc-ovc', h('h3', t('Time!')), h('div.arc-big', score + ' WPM'), h('p.muted', t('{n} errors', { n: errors })), h('button.btn.primary', { onClick: restart }, t('Play again')))); ov.classList.remove('hide'); if (score > 0) end(score, ms); };
      function restart() { gen(); correct = 0; errors = 0; run = false; clearInterval(clock); inp.disabled = false; inp.value = ''; ov.classList.add('hide'); paintWords(); paintHud(); inp.focus(); }
      restart();
      return () => clearInterval(clock);
    }

    // ---------- duels ----------
    function paintDuels() {
      if (openDuel) return paintDuel(openDuel);
      const fr = (S.friends.friends || []);
      const friendSel = h('select.select', { style: 'width:auto' }, fr.length ? fr.map((f) => h('option', { value: f.id }, (f.displayName || f.username) + (S.online.has(f.id) ? '' : ''))) : h('option', { value: '' }, t('No friends yet')));
      const userIn = h('input.input', { placeholder: t('…or a username'), style: 'max-width:180px' });
      let gameSel = 'ttt'; const wager = h('input.input', { type: 'number', min: 0, max: Math.min(1000, S.me.coins), value: 0, style: 'width:110px' });
      const challenge = (btn) => busy(btn, async () => {
        const body = { game: gameSel, wager: Number(wager.value) || 0 }; if (userIn.value.trim()) body.username = userIn.value.trim().replace(/^@/, ''); else body.to = friendSel.value;
        if (!body.to && !body.username) return toast(t('Pick a friend or type a username'), 'err');
        try { const r = await api.post('/api/duels', body); toast(t('Challenge sent! They have 2 minutes to accept.'), 'good'); await loadDuels(); openDuel = r.duel.id; paint(); } catch (e) { toastErr(e); }
      });
      const live = duelData.live, recent = duelData.recent;
      const item = (d) => { const op = d.me === 0 ? d.b : d.a; const icon2 = (DUELS.find((x) => x[0] === d.game) || [])[2]; const res = d.status === 'done' ? (d.draw ? t('Draw') : d.winner === S.me.id ? t('Won') : t('Lost')) : d.status === 'pending' ? (d.me === 1 ? t('Wants to play!') : t('Waiting…')) : t('Live'); return h('button.duel-item.' + (d.status === 'done' ? (d.draw ? 'draw' : d.winner === S.me.id ? 'won' : 'lost') : d.status), { onClick: () => { openDuel = d.id; paint(); } }, h('span.duel-g', icon2), avatarEl(op, { size: 30, status: true }), h('div.grow', h('div.small', { style: 'font-weight:700' }, (op.displayName || op.username)), h('div.tiny.muted', t(d.name) + (d.wager ? ' · ' + d.wager : ''))), h('span.pill', res)); };
      mount(body, h('div.grid.cols-2',
        h('div.card.col', h('h3', t('Challenge someone')),
          h('div.field', h('label', t('Game')), segEl(DUELS.map(([id, n]) => [id, t(n)]), gameSel, (v) => { gameSel = v; })),
          h('div.field', h('label', t('Opponent')), h('div.row.wrap', friendSel, userIn)),
          h('div.field', h('label', t('Wager (optional, both pay, winner takes all)')), h('div.row', wager, h('span.small.muted', t('You have {n}', { n: fmt.coins(S.me.coins) })))),
          h('button.btn.primary', { onClick: (e) => challenge(e.currentTarget) }, '', t('Send challenge')),
          h('p.tiny.muted', t('Who can challenge you is set in Settings → Privacy. Coins are held safely until the game ends; draws are refunded.'))),
        h('div.col', h('div.card', h('h3', t('Live & pending')), live.length ? h('div.col.gap-s', live.map(item)) : h('p.small.muted', t('No duels right now.'))),
          h('div.card', h('h3', t('Recent')), recent.length ? h('div.col.gap-s', recent.map(item)) : h('p.small.muted', t('Your finished duels show up here.'))))));
    }
    let duelTimer = null;
    async function paintDuel(id) {
      clearInterval(duelTimer);
      let d; try { d = (await api.get('/api/duels/' + id)).duel; } catch (e) { openDuel = null; toastErr(e); return paintDuels(); }
      if (openDuel !== id || tab !== 'duels') return;
      const mi = d.me; const op = mi === 0 ? d.b : d.a; const myTurn = d.status === 'active' && d.state.turn === mi; const st = d.state || {};
      if (d.game !== 'rps' && !st.board) st.board = new Array(d.game === 'c4' ? 42 : 9).fill(null); // pending: empty board preview
      if (d.game === 'rps') { st.score = st.score || [0, 0]; st.history = st.history || []; }
      const act = async (body) => { try { const r = await api.post(`/api/duels/${d.id}/move`, body); renderDuel(r.duel); } catch (e) { toastErr(e); } };
      const header = h('div.duel-head', h('button.btn.ghost', { onClick: () => { openDuel = null; clearInterval(duelTimer); loadDuels().then(paint); setAct(null); } }, icon('back', 16), t('Duels')),
        h('div.duel-vs', h('div.duel-p' + (d.status === 'active' && st.turn === 0 ? '.turn' : ''), avatarEl(d.a, { size: 40 }), h('b.small', d.a.displayName || d.a.username), d.game === 'rps' ? h('span.duel-sc', String(st.score[0])) : h('span.duel-mark.x', d.game === 'c4' ? '🔴' : '✕')),
          h('div.duel-mid', h('b', t(d.name)), d.wager ? h('span.coin.small', String(d.wager * 2)) : null, h('span.tiny.muted.duel-clock')),
          h('div.duel-p' + (d.status === 'active' && st.turn === 1 ? '.turn' : ''), avatarEl(d.b, { size: 40 }), h('b.small', d.b.displayName || d.b.username), d.game === 'rps' ? h('span.duel-sc', String(st.score[1])) : h('span.duel-mark.o', d.game === 'c4' ? '🟡' : '◯'))));
      let boardEl;
      if (d.game === 'ttt') boardEl = h('div.ttt', st.board.map((v, i) => h('button.ttt-c' + (st.line && st.line.includes(i) ? '.win' : ''), { disabled: !myTurn || v !== null, onClick: () => act({ cell: i }) }, v === null ? '' : v === 0 ? '✕' : '◯')));
      else if (d.game === 'c4') boardEl = h('div.c4', Array.from({ length: 7 }, (_, c) => h('button.c4-col', { disabled: !myTurn || st.board[c] !== null, onClick: () => act({ col: c }), 'aria-label': t('Column {n}', { n: c + 1 }) }, Array.from({ length: 6 }, (_, r) => { const v = st.board[r * 7 + c]; return h('span.c4-c' + (v === 0 ? '.p0' : v === 1 ? '.p1' : '') + (st.line && st.line.includes(r * 7 + c) ? '.win' : '')); }))));
      else boardEl = h('div.rps', d.status === 'active' ? (st.myPick ? h('p.center', t('You picked {p}. Waiting for {u}…', { p: RPS[st.myPick], u: op.displayName || op.username })) : h('div.row', { style: 'justify-content:center;gap:14px' }, Object.keys(RPS_IC).map((k) => h('button.rps-b', { title: RPS[k], 'aria-label': RPS[k], onClick: () => act({ pick: k }) }, icon(RPS_IC[k], 30), h('span.tiny', RPS[k]))))) : null,
        st.theyPicked && !st.myPick && d.status === 'active' ? h('p.center.small.muted', t('{u} already picked!', { u: op.displayName || op.username })) : null,
        h('div.rps-hist', (st.history || []).map((x, i) => h('div.row.small', h('span.muted', t('Round {n}', { n: i + 1 })), h('span', RPS[x.picks[0]] + '  vs  ' + RPS[x.picks[1]]), h('b', x.w === null ? t('Tie') : x.w === mi ? t('You') : (op.displayName || op.username))))));
      let footer;
      if (d.status === 'pending') footer = mi === 1 ? h('div.row', { style: 'justify-content:center' }, h('button.btn.primary', { onClick: async () => { try { const r = await api.post(`/api/duels/${d.id}/accept`); renderDuel(r.duel); } catch (e) { toastErr(e); } } }, t('Accept') + (d.wager ? ` (${d.wager} 🪙)` : '')), h('button.btn', { onClick: async () => { await api.post(`/api/duels/${d.id}/decline`).catch(toastErr); openDuel = null; loadDuels().then(paint); } }, t('Decline'))) : h('div.row', { style: 'justify-content:center' }, h('span.muted', t('Waiting for {u} to accept…', { u: op.displayName || op.username })), h('button.btn.ghost', { onClick: async () => { await api.post(`/api/duels/${d.id}/decline`).catch(toastErr); openDuel = null; loadDuels().then(paint); } }, t('Cancel')));
      else if (d.status === 'active') footer = h('div.row', { style: 'justify-content:center' }, h('b', myTurn || (d.game === 'rps' && !st.myPick) ? t('Your move!') : t('{u} is thinking…', { u: op.displayName || op.username })), h('button.btn.ghost.sm', { onClick: async () => { try { const r = await api.post(`/api/duels/${d.id}/resign`); renderDuel(r.duel); } catch (e) { toastErr(e); } } }, '', t('Resign')));
      else { const won = d.winner === S.me.id; footer = h('div.col', { style: 'align-items:center' }, h('div.duel-result.' + (d.draw ? 'draw' : won ? 'won' : 'lost'), d.draw ? t('Draw — stakes refunded') : won ? t('You won!') + (d.wager ? ` +${d.wager * 2} 🪙` : '') : t('You lost')), d.reason && d.reason !== 'win' ? h('span.tiny.muted', { timeout: t('Out of time'), resign: t('Resigned'), restart: t('Server restarted — refunded'), expired: t('Expired') }[d.reason] || '') : null, ['declined', 'canceled', 'expired'].includes(d.status) ? null : h('button.btn', { onClick: async () => { try { const r = await api.post(`/api/duels/${d.id}/rematch`); openDuel = r.duel.id; paint(); } catch (e) { toastErr(e); } } }, '', t('Rematch'))); if (won && !renderDuel.celebrated) { renderDuel.celebrated = d.id; confetti(innerWidth / 2, innerHeight / 3, 90); sfx.win(); } }
      mount(body, h('div.card.duel-card', header, h('div.duel-board', boardEl), footer));
      setAct(d.status === 'active' ? t('{g} vs {u}', { g: t(d.name), u: op.displayName || op.username }) : null, 'duel');
      const clockEl = body.querySelector('.duel-clock'); const tickC = () => { if (!d.deadline || !clockEl) return; const s = Math.max(0, Math.ceil((d.deadline - Date.now()) / 1000)); clockEl.textContent = d.status === 'active' ? s + 's' : d.status === 'pending' ? t('expires in {s}s', { s }) : ''; };
      tickC(); duelTimer = setInterval(tickC, 1000);
    }
    function renderDuel(d) { if (openDuel === d.id) paintDuel(d.id); }

    // ---------- boards ----------
    async function paintBoards() {
      let g = ls('arc.board') || 'snake'; const sel = segEl(GAMES.map(([id, n]) => [id, t(n)]), g, (v) => { ls('arc.board', v); paintBoards(); });
      const list = h('div'); mount(body, h('div.col', sel, list)); mount(list, loading());
      try {
        const r = await api.get('/api/arcade/leaderboard/' + g); const unit = t(GAMES.find((x) => x[0] === g)[4]);
        mount(list, r.top.length ? h('div.card.pr-board', r.top.map((x) => h('button.pr-row' + (x.user.id === S.me.id ? '.me' : ''), { onClick: () => ctx.go('profile', x.user.username) }, h('span.pr-rank', x.rank <= 3 ? ['🥇', '🥈', '🥉'][x.rank - 1] : '#' + x.rank), avatarEl(x.user, { size: 32, status: true }), h('div.grow', nameEl(x.user)), h('b.mono', fmt.num(x.score) + ' ' + unit)))) : emptyState('🏁', t('Nobody here yet'), t('Be the first on this board!')),
          r.me ? h('p.small', t('Your rank: #{r}', { r: r.me.rank })) : null);
      } catch (e) { mount(list, emptyState('⚠️', e.message)); }
    }

    offs.push(bus.on('ws:duel', async (m) => { if (!m.duel) return; if (openDuel === m.duel.id) paintDuel(m.duel.id); else if (tab === 'duels') { await loadDuels(); paint(); } }));
    paint();
    { const pg = ctx.query.get('play'); if (pg && GAMES.some((g) => g[0] === pg)) startGame(pg); }
    return () => { offs.forEach((f) => f()); stopGame(); clearInterval(duelTimer); setAct(null); };
  },
};

function star(g, x, y, R, r) { g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5; const rr2 = i % 2 ? r : R; g.lineTo(x + Math.cos(a) * rr2, y + Math.sin(a) * rr2); } g.closePath(); g.fill(); }
function rr(g, x, y, w, hh, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + hh, r); g.arcTo(x + w, y + hh, x, y + hh, r); g.arcTo(x, y + hh, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function mixHex(a, b, k) { const p = (c) => { const n = parseInt(String(c).replace('#', '').slice(0, 6), 16) || 0; return [n >> 16, (n >> 8) & 255, n & 255]; }; const x = p(a), y = p(b); return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * k)).join(',')})`; }
