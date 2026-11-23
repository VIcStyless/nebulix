// Casino: provably-fair games played with virtual coins only (no purchases, no cash-out).
// Coin Flip, Dice, Slots and Roulette + a fairness verifier that re-computes outcomes in the browser, and responsible-play limits.
import { h, mount, fmt, clamp, ls, parseCoins } from '../util.js';
import { t, pick2 } from '../i18n.js';
import { api, ws } from '../api.js';
import { S, bus, patchMe } from '../state.js';
import { icon } from '../icons.js';
import { toast, toastErr, confirmBox, modal, segEl, tabsEl, emptyState, loading, busy, confetti, field, copyBtn } from '../ui.js';
import { sfx } from '../sfx.js';
import { EXTRA, mountExtra } from './casino-more.js';
import { makeFx, fx3dOn } from '../casino-fx3d.js';

const GAMES = [['horses', 'Horse racing', 'trophy'], ['coinflip', 'Coin Flip', 'coins'], ['dice', 'Dice', 'cube'], ['slots', 'Slots', 'star'], ['roulette', 'Roulette', 'dice'], ['blackjack', 'Blackjack', 'layers'], ['baccarat', 'Baccarat', 'layers'], ['videopoker', 'Video Poker', 'grid'], ['hilo', 'Hi-Lo', 'up'], ['crash', 'Crash', 'zap'], ['mines', 'Mines', 'target'], ['plinko', 'Plinko', 'activity'], ['wheel', 'Wheel', 'refresh'], ['keno', 'Keno', 'hash'], ['limbo', 'Limbo', 'zap'], ['jackpot', 'Jackpot', 'trophy']];
const NEW_GAMES = new Set(['wheel', 'keno', 'limbo']);
// games the in-browser verifier can recompute (jackpot shows its own seed in its history)
const VERIFY = ['coinflip', 'dice', 'slots', 'roulette', 'crash', 'plinko', 'mines', 'blackjack'];

// Slot symbols are drawn as small vector marks (the server keeps its own symbol ids for provable fairness).
const SYM_SVG = {
  '🍒': '<circle cx="9" cy="16" r="5" fill="#ef4444"/><circle cx="17" cy="17" r="4.5" fill="#dc2626"/><path d="M9 11c1-4 4-6 8-7M17 12.5c0-3-1-6 0-8.5" stroke="#4ade80" stroke-width="1.6" fill="none" stroke-linecap="round"/>',
  '🍋': '<ellipse cx="12" cy="13" rx="8.5" ry="6.5" fill="#facc15" transform="rotate(-20 12 13)"/><path d="M19 7l2-2" stroke="#a3e635" stroke-width="1.8" stroke-linecap="round"/>',
  '🔔': '<path d="M6 17V12a6 6 0 0 1 12 0v5l1.5 2h-15z" fill="#f5c542"/><circle cx="12" cy="21" r="1.8" fill="#b7861d"/>',
  '🍇': '<g fill="#a78bfa"><circle cx="9" cy="10" r="3"/><circle cx="15" cy="10" r="3"/><circle cx="12" cy="14.5" r="3"/><circle cx="7.5" cy="15" r="2.6"/><circle cx="16.5" cy="15" r="2.6"/><circle cx="12" cy="19.5" r="2.6"/></g><path d="M12 7V3" stroke="#4ade80" stroke-width="1.6" stroke-linecap="round"/>',
  '⭐': '<path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z" fill="var(--accent)"/>',
  '💎': '<path d="M6 4h12l4 6-10 11L2 10z" fill="#5eead4"/><path d="M2 10h20M8 4l4 17 4-17" stroke="#0f766e" stroke-width="1" fill="none" opacity=".6"/>',
  '7️⃣': '<text x="12" y="19.5" text-anchor="middle" font-size="19" font-weight="800" font-family="Segoe UI, system-ui, sans-serif" fill="#f87171">7</text>',
};
function symEl(s) { const el = document.createElement('span'); el.className = 'cs-sym'; el.innerHTML = '<svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">' + (SYM_SVG[s] || '<circle cx="12" cy="12" r="6" fill="currentColor"/>') + '</svg>'; el.title = s; return el; }
const VERB = { coinflip: 'Flip', dice: 'Roll', slots: 'Spin', roulette: 'Spin' };
const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const colorOf = (n) => (n === 0 ? 'green' : REDS.has(n) ? 'red' : 'black');
const mx = (m) => '×' + (Math.round(m * 100) / 100);

// ---- provably fair maths, identical to the server (HMAC-SHA256 -> 32-bit floats) ----
const enc = new TextEncoder();
const subtle = () => (window.crypto && window.crypto.subtle) || null;
const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
async function sha256hex(s) { return hex(await subtle().digest('SHA-256', enc.encode(s))); }
async function floatsFrom(server, client, nonce, n) {
  const key = await subtle().importKey('raw', enc.encode(server), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const out = []; let cursor = 0;
  while (out.length < n) {
    const dv = new DataView(await subtle().sign('HMAC', key, enc.encode(`${client}:${nonce}:${cursor++}`)));
    for (let i = 0; i + 4 <= 32 && out.length < n; i += 4) out.push(dv.getUint32(i) / 4294967296);
  }
  return out;
}
function slotSymbol(f, symbols) { let acc = 0; const x = f * 100; for (const [s, w] of symbols) { acc += w; if (x < acc) return s; } return symbols[0][0]; }

let actSent = false;
export default {
  title: () => t('Casino'),
  async mount(root, ctx) {
    let alive = true;
    const timers = new Set();
    const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); if (alive) fn(); }, ms); timers.add(id); return id; };
    const pause = (ms) => new Promise((res) => later(res, ms));

    let game = GAMES.some((g) => g[0] === ctx.params[0]) ? ctx.params[0] : (ls('casino.game') || 'coinflip');
    if (!GAMES.some((g) => g[0] === game)) game = 'coinflip';
    let bet = Math.max(1, Math.trunc(Number(ls('casino.bet')) || 10));
    let playing = false;
    let st = null;            // /api/casino/state
    const hist = [];          // this session's results
    const pick = { coin: 'heads', dice: { target: 50, mode: 'under' }, rl: { type: 'red', value: 0 } };

    // ---------- skeleton ----------
    const balEl = h('span.coin.cs-bal', fmt.coins(S.me.coins)); const dailyHost = h('span'); const ticker = h('div.cs-ticker.hidden');
    const tabsHost = h('div'); const fxHost = h('div.cs-fxhost'); let fx = null; let fxGame = null; const stage = h('div.card.cs-stage'); const betBox = h('div.card'); const histBox = h('div.card');
    const extraSide = h('div.card.hidden'); const fairBox = h('div.card'); const rgBox = h('div.card'); const statBox = h('div.card'); const lbBox = h('div.card');
    mount(root, h('div.inner',
      h('div.page-title', h('div', h('h2', t('Casino')), h('p', t('Twelve provably fair games with play money and no bet limit. Coins can’t be bought or cashed out — it’s just for fun.'))), h('div.row', { style: 'gap:8px;align-items:center' }, dailyHost, balEl)),
      ticker,
      h('div.cs-note', icon('shield', 16), h('span', t('Virtual coins only. Every result is derived from a seed you can verify yourself.'))),
      h('div.cs-layout', h('div.cs-main', h('div.row', { style: 'gap:8px;align-items:center' }, h('div.grow', tabsHost), h('button.btn.sm.cs-3d', { title: t('3D animations'), onClick: (e) => { ls('casino.3d', !fx3dOn()); e.currentTarget.textContent = fx3dOn() ? '3D ✓' : '3D'; fxGame = null; if (fx) { fx.dispose(); fx = null; } paintFx(); } }, fx3dOn() ? '3D ✓' : '3D')), fxHost, stage, betBox, extraSide, histBox), h('aside.cs-side', fairBox, rgBox, statBox, lbBox))));
    mount(stage, loading(t('Opening the casino…')));

    try { st = await api.get('/api/casino/state'); } catch (e) { toastErr(e); mount(stage, emptyState('🎰', t('Casino unavailable'), e.message)); return () => { alive = false; }; }
    if (!alive) return () => {};
    patchMe({ coins: st.coins }); paintDaily();

    const cfg = st.config;
    const paused = () => st.fair.rg.until > Date.now();
    const maxBet = () => Math.max(1, Math.min(cfg.max, S.me.coins));
    let shownBal = S.me.coins; let balRaf = 0;
    // the balance counts up/down to its new value and flashes green or red
    const paintBal = () => { const to = S.me.coins; const from = shownBal; if (to === from) { balEl.textContent = fmt.coins(to); return; } cancelAnimationFrame(balRaf); balEl.classList.remove('up', 'down'); void balEl.offsetWidth; balEl.classList.add(to > from ? 'up' : 'down'); const t0 = performance.now();
      const step = () => { const k = Math.min(1, (performance.now() - t0) / 700); const v = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))); balEl.textContent = fmt.coins(v); shownBal = v; if (k < 1 && alive) balRaf = requestAnimationFrame(step); else shownBal = to; }; step(); };
    // big win celebration: BIG / MEGA / EPIC WIN, the prize counting up and a shower of coins
    function bigWinFx(r) {
      if (!(r.net > 0 && (r.mult >= 10 || r.net >= r.bet * 10))) return;
      const tier = r.mult >= 250 ? ['EPIC WIN', 'epic'] : r.mult >= 50 ? ['MEGA WIN', 'mega'] : ['BIG WIN', 'big'];
      const amt = h('b.cs-bw-n', '0'); const ov = h('div.cs-bigwin.' + tier[1], { onClick: () => ov.remove() }, h('div.cs-bw-rays'), h('div.cs-bw-box', h('div.cs-bw-t', tier[0]), amt, h('div.cs-bw-m', mx(r.mult))),
        Array.from({ length: 36 }, (_, i) => h('i.cs-bw-coin', { style: { left: Math.random() * 100 + '%', animationDelay: Math.random() * 1.2 + 's', animationDuration: 1.6 + Math.random() * 1.4 + 's', fontSize: 16 + Math.random() * 18 + 'px' } }, i % 5 ? '🪙' : '💎')));
      document.body.append(ov); const t0 = performance.now(); const step = () => { const k = Math.min(1, (performance.now() - t0) / 1800); amt.textContent = '+' + fmt.coins(Math.round(r.payout * (1 - Math.pow(1 - k, 3)))); if (k < 1 && ov.isConnected) requestAnimationFrame(step); }; step();
      setTimeout(() => { ov.classList.add('out'); setTimeout(() => ov.remove(), 500); }, 3600);
    }
    // live ticker: big wins by anyone on Nebulix
    let tick = [];
    const paintTicker = () => { if (!tick.length) { ticker.classList.add('hidden'); return; } ticker.classList.remove('hidden'); const items = tick.map((e) => h('span.cs-tk', e.icon + ' ', Array.isArray(e.text) ? (pick2([e.text[0], e.text[1]]) || '') : String(e.text))); mount(ticker, h('span.cs-tk-live', '● ' + t('Live')), h('div.cs-tk-track', h('div.cs-tk-move', items, items.map((x) => x.cloneNode(true))))); };
    api.get('/api/feed?kind=casino&n=12', { quiet: true }).then((x) => { tick = x.items || []; paintTicker(); }).catch(() => {});
    const offFeed = bus.on('ws:feed', (m) => { if (m.e && m.e.kind === 'casino') { tick.unshift(m.e); tick = tick.slice(0, 12); paintTicker(); } });
    // daily free spin
    function paintDaily() { mount(dailyHost, st.daily && !st.daily.used ? h('button.btn.sm.cs-daily', { type: 'button', onClick: dailySpin }, '🎁 ' + t('Free daily spin')) : null); }
    async function dailySpin() {
      const prizes = st.daily.prizes; const n = prizes.length; const SZ = 560; const cv = h('canvas.cs-dw', { width: SZ, height: SZ }); const g = cv.getContext('2d'); let ang = 0;
      const cols = ['#7c3aed', '#0ea5e9', '#f59e0b', '#22c55e', '#ec4899', '#ef4444'];
      const draw = () => { const c = SZ / 2; const a0 = (Math.PI * 2) / n; g.clearRect(0, 0, SZ, SZ); g.save(); g.translate(c, c); g.rotate(ang); for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + i * a0 - a0 / 2; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, c - 12, a, a + a0); g.closePath(); g.fillStyle = cols[i % cols.length]; g.fill(); g.strokeStyle = '#0006'; g.lineWidth = 3; g.stroke(); g.save(); g.rotate(a + a0 / 2); g.fillStyle = '#fff'; g.font = '800 30px system-ui'; g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillText(fmt.compact ? fmt.compact(prizes[i]) : prizes[i], c - 30, 0); g.restore(); } g.restore(); g.beginPath(); g.arc(c, c, c - 6, 0, 7); g.lineWidth = 12; g.strokeStyle = '#f5c542'; g.stroke(); };
      draw(); const out = h('div.cs-result', h('span.muted', t('One free spin every day.')));
      const go = h('button.btn.primary.cs-go', { type: 'button', onClick: async () => {
        go.disabled = true; let r; try { r = await api.post('/api/casino/daily'); } catch (e) { toastErr(e); return; }
        const a0 = (Math.PI * 2) / n; const TAU = Math.PI * 2; const target = -(r.seg * a0); const end = 6 * TAU + ((((target) % TAU) + TAU) % TAU); const t0 = performance.now(); let last = -1; sfx.spin();
        await new Promise((done) => { const step = () => { const k = Math.min(1, (performance.now() - t0) / 4200); ang = end * (1 - Math.pow(1 - k, 4)); const s2 = Math.round(((-ang / a0) % n + n) % n) % n; if (s2 !== last) { last = s2; sfx.tick(); } draw(); if (k < 1) requestAnimationFrame(step); else done(); }; step(); });
        sfx.big(); confetti(); out.className = 'cs-result pop win'; mount(out, h('b', t('You won {n} coins!', { n: fmt.coins(r.prize) })));
        st.daily.used = true; patchMe({ coins: r.balance }); paintBal(); paintDaily();
      } }, '🎁 ' + t('Spin'));
      modal({ title: t('Free daily spin'), cls: 'narrow', body: h('div.cs-dwrap', h('div.cx-wpointer'), cv, out, go), actions: [{ label: t('Close') }] });
    }

    // ---------- stage visuals ----------
    let coinRot = 0; let coinEl, coinWrap, diceMark, diceRoll, diceBar, reels = [], ball, ballLabel, resultEl;
    const resultLine = () => (resultEl = h('div.cs-result', { 'aria-live': 'polite' }, h('span.muted', t('Place your bet and press {a}.', { a: t(VERB[game]) }))));

    function paintStage() {
      if (EXTRA.has(game)) return;
      if (game === 'coinflip') {
        coinEl = h('div.cs-coin', { style: { transform: `rotateY(${coinRot}deg)` } }, h('div.face.f', '★'), h('div.face.b', '☾'));
        coinWrap = h('div.cs-coin-wrap', coinEl);
        mount(stage, coinWrap, h('div.cs-pickrow',
          ['heads', 'tails'].map((s) => h('button.cs-pick' + (pick.coin === s ? '.on' : ''), { type: 'button', disabled: playing, 'data-pick': s, onClick: () => { pick.coin = s; paintStage(); paintBet(); } },
            h('span.cs-pk-ic', s === 'heads' ? '★' : '☾'), t(s === 'heads' ? 'Heads' : 'Tails')))), resultLine());
      } else if (game === 'dice') {
        const d = pick.dice; const zone = d.mode === 'under' ? d.target : 100 - d.target;
        diceMark = h('div.cs-mark', h('span')); diceRoll = h('div.cs-roll', '—');
        diceBar = h('div.cs-bar', { style: { background: d.mode === 'under' ? `linear-gradient(90deg, var(--success) 0 ${d.target}%, #7f1d1d ${d.target}% 100%)` : `linear-gradient(90deg, #7f1d1d 0 ${d.target}%, var(--success) ${d.target}% 100%)` } }, diceMark,
          h('div.cs-ticks', [0, 25, 50, 75, 100].map((n) => h('i', { style: { left: n + '%' } }, String(n)))));
        const slider = h('input', { type: 'range', min: '2', max: '98', step: '1', value: String(d.target), 'aria-label': t('Target'), disabled: playing, onInput: (e) => { d.target = Number(e.target.value); paintStage(); paintBet(); } });
        mount(stage, diceRoll, diceBar, h('div.cs-dice-ctl',
          segEl([['under', t('Roll under')], ['over', t('Roll over')]], d.mode, (v) => { d.mode = v; paintStage(); paintBet(); }),
          h('div.cs-slider', slider, h('b', fmt.num(d.target))),
          h('div.small.muted', t('Win zone: {n}% of the bar', { n: zone }))), resultLine());
        if (playing) [...stage.querySelectorAll('button')].forEach((b) => (b.disabled = true));
      } else if (game === 'slots') {
        reels = [0, 1, 2].map(() => h('div.cs-reel', symEl(cfg.slots.symbols[0][0])));
        const pay = h('div.cs-pay', Object.entries(cfg.slots.pay).sort((a, b) => a[1] - b[1]).map(([s, m]) => h('div', h('span', symEl(s), symEl(s), symEl(s)), h('b', mx(m)))), h('div', h('span', symEl('🍒'), symEl('🍒')), h('b', mx(cfg.slots.twoCherry))));
        mount(stage, h('div.cs-reels', reels), resultLine(), pay);
      } else {
        ball = h('div.cs-ball.green', ballLabel = h('span', '0'));
        const out = [['red', 'Red', 2], ['black', 'Black', 2], ['odd', 'Odd', 2], ['even', 'Even', 2], ['low', '1–18', 2], ['high', '19–36', 2]];
        const cell = (label, type, value, cls, style) => h('button.rl-cell' + (cls ? '.' + cls.split(' ').filter(Boolean).join('.') : '') + (pick.rl.type === type && pick.rl.value === value ? '.on' : ''), { type: 'button', style, disabled: playing, 'data-bet': type + ':' + value, onClick: () => { pick.rl = { type, value }; paintStage(); paintBet(); } }, label);
        const cells = [cell('0', 'number', 0, 'green', 'grid-row: 1 / span 3; grid-column: 1')];
        for (let n = 1; n <= 36; n++) { const col = Math.floor((n - 1) / 3); const row = 3 - ((n - 1) % 3); cells.push(cell(String(n), 'number', n, colorOf(n), `grid-row: ${row}; grid-column: ${col + 2}`)); }
        [1, 2, 3].forEach((c) => cells.push(cell('2:1', 'column', c, 'out', `grid-row: ${4 - c}; grid-column: 14`)));
        [1, 2, 3].forEach((d) => cells.push(cell(['1st 12', '2nd 12', '3rd 12'][d - 1], 'dozen', d, 'out', `grid-row: 4; grid-column: ${2 + (d - 1) * 4} / span 4`)));
        out.forEach(([type, label], i) => cells.push(cell(label, type, 0, 'out ' + (type === 'red' ? 'red' : type === 'black' ? 'black' : ''), `grid-row: 5; grid-column: ${2 + i * 2} / span 2`)));
        mount(stage, ball, resultLine(), h('div.rl-board', cells));
      }
    }

    // ---------- bet panel ----------
    function odds() {
      if (game === 'coinflip') return { chance: 50, mult: cfg.coin };
      if (game === 'dice') { const d = pick.dice; const c = d.mode === 'under' ? d.target : 100 - d.target; return { chance: c, mult: Math.floor((98 / c) * 100) / 100 }; }
      if (game === 'slots') return { chance: null, mult: Math.max(...Object.values(cfg.slots.pay)) };
      const b = pick.rl; const m = b.type === 'number' ? 36 : (b.type === 'dozen' || b.type === 'column') ? 3 : 2;
      return { chance: Math.round(((b.type === 'number' ? 1 : m === 3 ? 12 : 18) / 37) * 1000) / 10, mult: m };
    }
    const betName = () => {
      if (game === 'coinflip') return t(pick.coin === 'heads' ? 'Heads' : 'Tails');
      if (game === 'dice') return (pick.dice.mode === 'under' ? t('Under') : t('Over')) + ' ' + pick.dice.target;
      if (game === 'slots') return t('3 reels');
      const b = pick.rl; return b.type === 'number' ? t('Number {n}', { n: b.value }) : b.type === 'dozen' ? t('Dozen {n}', { n: b.value }) : b.type === 'column' ? t('Column {n}', { n: b.value }) : t({ red: 'Red', black: 'Black', odd: 'Odd', even: 'Even', low: '1–18', high: '19–36' }[b.type]);
    };
    let betInput, goBtn, sumEl;
    function setBet(v) { bet = clamp(parseCoins(v) || 1, 1, maxBet()); if (betInput) betInput.value = String(bet); ls('casino.bet', bet); paintSummary(); }
    function paintSummary() {
      if (!sumEl) return; const o = odds();
      mount(sumEl, h('div', h('span.muted', t('Bet on')), h('b', betName())),
        o.chance !== null ? h('div', h('span.muted', t('Win chance')), h('b', o.chance + '%')) : h('div', h('span.muted', t('Top prize')), h('b', mx(o.mult))),
        o.chance !== null ? h('div', h('span.muted', t('Multiplier')), h('b', mx(o.mult))) : h('div', h('span.muted', t('Two')), h('b', mx(cfg.slots.twoCherry))),
        h('div', h('span.muted', t('Payout if you win')), h('span.coin', o.chance !== null ? fmt.coins(Math.floor(bet * o.mult)) : '—')));
    }
    function paintBet() {
      if (EXTRA.has(game)) return;
      betInput = h('input.input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '100, 10k, 1m', value: String(bet), 'aria-label': t('Bet'), disabled: playing, onInput: (e) => { bet = clamp(parseCoins(e.target.value) || 1, 1, cfg.max); paintSummary(); }, onChange: () => setBet(bet), onKeydown: (e) => { if (e.key === 'Enter') play(); } });
      sumEl = h('div.cs-sum');
      goBtn = h('button.btn.primary.cs-go', { type: 'button', disabled: playing || paused() || S.me.coins < 1, onClick: play }, icon('play', 17), t(VERB[game]) + ' · ', h('span.coin', fmt.coins(bet)));
      mount(betBox,
        h('div.row', { style: 'gap:8px;flex-wrap:wrap' }, h('div.grow', { style: 'min-width:120px' }, field(t('Bet'), betInput)),
          h('div.row', { style: 'gap:6px;align-self:flex-end;margin-bottom:2px' },
            h('button.btn.sm', { type: 'button', disabled: playing, onClick: () => setBet(bet / 2) }, '½'), h('button.btn.sm', { type: 'button', disabled: playing, onClick: () => setBet(bet * 2) }, '2×'),
            h('button.btn.sm', { type: 'button', disabled: playing, onClick: () => setBet(1) }, t('Min')), h('button.btn.sm', { type: 'button', disabled: playing, onClick: () => setBet(maxBet()) }, t('Max')))),
        h('div.cs-chips', [5, 10, 50, 100, 500, 1000].map((n) => h('button.cs-chip', { type: 'button', disabled: playing, onClick: () => setBet(bet + n) }, '+' + n))),
        sumEl, paused() ? h('div.cs-paused', icon('clock', 16), t('Casino play is paused until {d}. Take a break — you earned it.', { d: fmt.dt(st.fair.rg.until) })) : null, goBtn);
      paintSummary();
    }

    // ---------- animations ----------
    async function animate(r) {
      let desc = '';
      const say = (kind, text) => { desc = text; };
      if (r.game === 'coinflip') {
        const want = r.result.side === 'heads' ? 0 : 180;
        coinRot += 360 * 5 + ((want - (coinRot % 360)) + 360) % 360;
        coinWrap.classList.remove('fly'); void coinWrap.offsetWidth; coinWrap.classList.add('fly'); sfx.spin();
        coinEl.style.transform = `rotateY(${coinRot}deg)`;
        await pause(1650);
        say(r.payout > 0 ? 'win' : 'lose', t('It landed on {s}.', { s: t(r.result.side === 'heads' ? 'Heads' : 'Tails') }));
      } else if (r.game === 'dice') {
        sfx.spin(); diceMark.style.left = r.result.roll + '%'; diceMark.classList.add('on');
        const t0 = performance.now();
        await new Promise((res) => { const step = () => { if (!alive) return res(); const k = clamp((performance.now() - t0) / 1100, 0, 1); diceRoll.textContent = (k < 1 ? Math.random() * 100 : r.result.roll).toFixed(2); if (k < 1) requestAnimationFrame(step); else res(); }; step(); });
        diceRoll.textContent = r.result.roll.toFixed(2); diceRoll.className = 'cs-roll ' + (r.payout > 0 ? 'win' : 'lose');
        say(r.payout > 0 ? 'win' : 'lose', t('Rolled {n} — you needed {m} {t}.', { n: r.result.roll.toFixed(2), m: r.result.mode === 'under' ? t('under') : t('over'), t: r.result.target }));
      } else if (r.game === 'slots') {
        sfx.spin();
        const all = cfg.slots.symbols.map((s) => s[0]);
        const iv = reels.map((el) => { el.classList.add('spin'); return setInterval(() => { el.replaceChildren(symEl(all[Math.floor(Math.random() * all.length)])); }, 70); });
        for (let i = 0; i < 3; i++) { await pause(i === 0 ? 800 : 480); clearInterval(iv[i]); reels[i].classList.remove('spin'); reels[i].replaceChildren(symEl(r.result.reels[i])); reels[i].classList.add('stop'); sfx.tick(); later(() => reels[i] && reels[i].classList.remove('stop'), 300); }
        iv.forEach(clearInterval);
        say(r.payout > 0 ? 'win' : 'lose', r.payout > 0 ? t('Winning line! {m}', { m: mx(r.mult) }) : t('No match this time.'));
      } else {
        sfx.spin(); ball.className = 'cs-ball spinning';
        const t0 = performance.now(); const dur = 1900;
        await new Promise((res) => { let last = 0; const step = () => { if (!alive) return res(); const k = (performance.now() - t0) / dur; if (k >= 1) return res(); const gap = 40 + k * k * 260; if (performance.now() - last > gap) { last = performance.now(); const n = Math.floor(Math.random() * 37); ballLabel.textContent = String(n); ball.className = 'cs-ball spinning ' + colorOf(n); sfx.tick(); } requestAnimationFrame(step); }; step(); });
        ballLabel.textContent = String(r.result.n); ball.className = 'cs-ball landed ' + r.result.color;
        say(r.payout > 0 ? 'win' : 'lose', t('The ball landed on {n} ({c}).', { n: r.result.n, c: t(r.result.color === 'red' ? 'red' : r.result.color === 'black' ? 'black' : 'green') }));
      }
      return desc;
    }

    function describe(r) {
      if (r.desc) return r.desc;
      if (r.game === 'coinflip') return t('Coin Flip') + ' · ' + t(r.result.side === 'heads' ? 'Heads' : 'Tails') + (r.result.side === r.result.pick ? '' : ' (' + t('you picked {s}', { s: t(r.result.pick === 'heads' ? 'Heads' : 'Tails') }) + ')');
      if (r.game === 'dice') return t('Dice') + ' · ' + r.result.roll.toFixed(2) + ' (' + (r.result.mode === 'under' ? '<' : '>') + ' ' + r.result.target + ')';
      if (r.game === 'slots') return t('Slots') + ' · ' + r.result.reels.join(' ');
      return t('Roulette') + ' · ' + r.result.n + ' ' + r.result.color;
    }

    async function play() {
      if (playing || !alive) return;
      if (paused()) return toast(t('Casino play is paused.'), 'err');
      if (bet > S.me.coins) return toast(t('Not enough coins'), 'err');
      const body = { bet };
      if (game === 'coinflip') body.pick = pick.coin; else if (game === 'dice') { body.target = pick.dice.target; body.mode = pick.dice.mode; } else if (game === 'roulette') { body.type = pick.rl.type; body.value = pick.rl.value; }
      playing = true; S.coinHold = true; S.coinPending = null; paintBet(); stage.querySelectorAll('button, input').forEach((e) => (e.disabled = true));
      let r;
      try { r = await api.post('/api/casino/play/' + game, body); if (!actSent) { actSent = true; ws.send({ t: 'act', kind: 'casino', label: t('Playing in the casino') }); } }
      catch (e) {
        S.coinHold = false; playing = false; if (!alive) return;
        if (e.code === 'too_fast') toast(t('Slow down a little'), 'info'); else toastErr(e);
        if (e.code === 'excluded' || e.code === 'limit') { try { st = await api.get('/api/casino/state'); paintAll(); } catch {} }
        paintStage(); paintBet(); return;
      }
      let desc = '';
      try { desc = (await Promise.all([animate(r), fx ? fx.play(r) : null]))[0]; } finally { S.coinHold = false; S.coinPending = null; playing = false; }
      patchMe({ coins: r.balance }); paintBal(); bigWinFx(r);
      st.fair.nonce = r.nonce + 1; st.coins = r.balance;
      st.stats = Object.assign({}, st.stats, { bets: (st.stats.bets || 0) + 1, wagered: (st.stats.wagered || 0) + r.bet, won: (st.stats.won || 0) + r.payout, biggest: Math.max(st.stats.biggest || 0, r.net) });
      const rg = st.fair.rg; rg.lost = r.net < 0 ? rg.lost - r.net : Math.max(0, rg.lost - r.net);
      hist.unshift(r); if (hist.length > 14) hist.pop();
      if (r.net > 0) { (r.mult >= 10 ? sfx.big : sfx.win)(); if (r.mult >= 10) confetti(); else if (r.net >= r.bet * 1.5) confetti(innerWidth / 2, innerHeight / 3, 24); } else sfx.lose();
      if (alive) {
        if (bet > S.me.coins) bet = Math.max(1, S.me.coins);
        if (resultEl) { resultEl.className = 'cs-result ' + (r.payout > 0 ? 'win' : 'lose'); mount(resultEl, h('div', desc), h('b', r.payout > 0 ? t('You won {n} coins!', { n: fmt.coins(r.payout) }) : t('You lost {n} coins.', { n: fmt.coins(r.bet) }) + ' ' + t('Better luck next time!'))); }
        stage.querySelectorAll('button, input').forEach((e) => (e.disabled = false));
        paintBet(); paintHist(); paintFair(); paintRg(); paintStats();
        if (Date.now() - lbAt > 4000) paintLb();
      }
    }

    // ---------- history ----------
    function paintHist() {
      mount(histBox, h('h3', t('Your recent bets')), hist.length ? h('div.cs-hist', hist.map((r) => h('div.cs-h' + (r.net > 0 ? '.win' : ''),
        h('span.cs-h-ic', icon(GAMES.find((g) => g[0] === r.game)[2], 16)), h('div.grow', h('div', describe(r)), h('div.tiny.muted', t('Bet {n} · nonce {x}', { n: fmt.coins(r.bet), x: r.nonce }))),
        h('b.cs-h-net' + (r.net > 0 ? '.pos' : '.neg'), (r.net > 0 ? '+' : '') + fmt.coins(r.net))))) : h('div.small.muted', t('Nothing yet — your results will show up here.')));
    }

    // ---------- fairness ----------
    function paintFair() {
      const f = st.fair; const seedIn = h('input.input', { value: f.client, maxlength: '32', 'aria-label': t('Client seed') });
      mount(fairBox, h('h3', icon('shield', 18), ' ' + t('Fairness')),
        h('p.small.muted', t('Before each bet we commit to a secret server seed by showing its SHA-256 hash. Results come from HMAC(server seed, client seed : nonce). Rotate to reveal the old seed and verify every bet yourself.')),
        h('div.field', h('label', t('Server seed hash (committed)')), h('div.row', { style: 'gap:6px' }, h('code.cs-hash.grow', f.hash), copyBtn(f.hash, t('Copy')))),
        h('div.field', h('label', t('Client seed')), h('div.row', { style: 'gap:6px' }, h('div.grow', seedIn), h('button.btn.sm', { type: 'button', onClick: async (e) => busy(e.currentTarget, async () => { try { const r = await api.post('/api/casino/fair/seed', { seed: seedIn.value.trim() }); st.fair = r.fair; toast(t('Client seed updated. Nonce reset to 0.'), 'good'); paintFair(); } catch (er) { toastErr(er); } }) }, t('Set')))),
        h('div.row', h('span.muted.grow', t('Next nonce')), h('b', fmt.num(f.nonce))),
        h('div.row', { style: 'gap:8px;margin-top:10px;flex-wrap:wrap' },
          h('button.btn.sm', { type: 'button', onClick: rotate }, icon('refresh', 15), t('Rotate & reveal')), h('button.btn.sm', { type: 'button', onClick: () => verifier() }, icon('check', 15), t('Verify a bet'))));
    }
    async function rotate() {
      if (!subtle()) return toast(t('Verification needs a secure connection (https or localhost).'), 'err');
      if (!(await confirmBox(t('Reveal your current server seed and start a fresh one? Your nonce restarts at 0.'), { ok: t('Rotate') }))) return;
      const before = st.fair.hash;
      try {
        const r = await api.post('/api/casino/fair/rotate'); st.fair = r.fair;
        const ok = (await sha256hex(r.revealed.server)) === before;
        paintFair();
        const go = await modal({ title: t('Server seed revealed'), cls: 'wide', body: h('div.col', { style: 'gap:10px' },
          h('div.cs-verdict' + (ok ? '.ok' : '.bad'), icon(ok ? 'check' : 'alert', 18), h('span', ok ? t('Its SHA-256 matches the hash we showed you before the bets.') : t('Hash mismatch!'))),
          h('div.field', h('label', t('Server seed')), h('code.cs-hash', r.revealed.server)),
          h('div.field', h('label', t('Committed hash')), h('code.cs-hash', before)),
          h('div.row', h('span.muted.grow', t('Client seed')), h('b', r.revealed.client)), h('div.row', h('span.muted.grow', t('Bets with this seed')), h('b', fmt.num(r.revealed.lastNonce))),
          h('p.small.muted', t('Use “Verify a bet” with this seed and any nonce from 0 to {n} to reproduce each result.', { n: Math.max(0, r.revealed.lastNonce - 1) }))),
          actions: [{ label: t('Close'), value: false }, { label: t('Verify a bet'), kind: 'primary', value: true }] });
        if (go) verifier({ server: r.revealed.server, client: r.revealed.client, nonce: 0 });
      } catch (e) { toastErr(e); }
    }
    function verifier(pre = {}) {
      if (!subtle()) return toast(t('Verification needs a secure connection (https or localhost).'), 'err');
      const sel = h('select.select', { 'aria-label': t('Game') }, GAMES.filter(([id]) => VERIFY.includes(id)).map(([id, n]) => h('option', { value: id, selected: id === game }, t(n))));
      const srv = h('input.input', { value: pre.server || '', placeholder: '64 hex characters', spellcheck: 'false', 'aria-label': t('Server seed') });
      const cli = h('input.input', { value: pre.client || st.fair.client, 'aria-label': t('Client seed') });
      const non = h('input.input', { type: 'number', min: '0', value: String(pre.nonce || 0), 'aria-label': t('Nonce') });
      const out = h('div.cs-vout');
      const run = async () => {
        mount(out);
        const server = srv.value.trim(); if (!/^[0-9a-f]{64}$/i.test(server)) return mount(out, h('div.error', t('Paste the revealed server seed (64 hex characters).')));
        const nonce = Math.max(0, Math.trunc(Number(non.value) || 0)); const client = cli.value.trim(); const g = sel.value;
        const fl = await floatsFrom(server, client, nonce, g === 'mines' || g === 'plinko' ? 24 : g === 'blackjack' ? 8 : 3); const hash = await sha256hex(server);
        let res;
        if (g === 'coinflip') res = fl[0] < 0.5 ? t('Heads') : t('Tails');
        else if (g === 'dice') res = (Math.floor(fl[0] * 10000) / 100).toFixed(2);
        else if (g === 'slots') res = fl.map((f) => slotSymbol(f, cfg.slots.symbols)).join(' ');
        else if (g === 'crash') res = mx(Math.min(cfg.crashMax, Math.max(1, Math.floor((0.98 / (1 - fl[0])) * 100) / 100)));
        else if (g === 'plinko') res = [8, 12, 16].map((rows) => t('{r} rows → slot {s}', { r: rows, s: fl.slice(0, rows).filter((f) => f >= 0.5).length })).join(' · ');
        else if (g === 'mines') { const cells = [...Array(25).keys()]; for (let i = 24; i > 0; i--) { const j = Math.floor(fl[24 - i] * (i + 1)); [cells[i], cells[j]] = [cells[j], cells[i]]; } res = t('Mine order (tiles 1-25): {l}', { l: cells.slice(0, 24).map((c) => c + 1).join(', ') }); }
        else if (g === 'blackjack') { const R = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']; const Su = ['♠', '♥', '♦', '♣']; res = t('Cards in order (you, dealer, you, dealer, then hits): {l}', { l: fl.map((f) => { const n = Math.floor(f * 52); return R[n % 13] + Su[Math.floor(n / 13)]; }).join(' ') }); }
        else { const n = Math.floor(fl[0] * 37); res = n + ' (' + t(colorOf(n) === 'red' ? 'red' : colorOf(n) === 'black' ? 'black' : 'green') + ')'; }
        mount(out, h('div.row', h('span.muted.grow', 'SHA-256(server seed)'), h('code.cs-hash', hash)), h('div.row', h('span.muted.grow', t('Random numbers')), h('code', { style: 'white-space:normal;word-break:break-all' }, fl.slice(0, 8).map((f) => f.toFixed(8)).join('  ') + (fl.length > 8 ? ' …' : ''))),
          h('div.cs-verdict.ok', icon('check', 18), h('span', t('Outcome') + ': '), h('b', res)));
      };
      modal({ title: t('Verify a bet'), cls: 'wide', body: h('div.col', { style: 'gap:10px' }, field(t('Game'), sel), field(t('Server seed'), srv), h('div.grid', { style: 'grid-template-columns:1fr 1fr;gap:10px' }, field(t('Client seed'), cli), field(t('Nonce'), non)), out),
        actions: [{ label: t('Close'), value: false }, { label: t('Calculate'), kind: 'primary', onClick: async () => { await run(); return false; } }] });
      if (pre.server) run();
    }

    // ---------- responsible play ----------
    function paintRg() {
      const rg = st.fair.rg; const limIn = h('input.input', { type: 'text', inputmode: 'decimal', placeholder: '0, 50k, 1m', value: String(rg.limit || 0), 'aria-label': t('Daily loss limit') });
      const pct = rg.limit > 0 ? clamp((rg.lost / rg.limit) * 100, 0, 100) : 0;
      mount(rgBox, h('h3', icon('heart', 18), ' ' + t('Play responsibly')),
        h('p.small.muted', t('Set a daily loss limit or take a break. Lowering a limit is instant; raising or removing it takes 24 hours.')),
        rg.limit > 0 ? h('div.cs-meter', h('div.row', h('span.small.muted.grow', t('Lost today')), h('b.small', fmt.coins(rg.lost) + ' / ' + fmt.coins(rg.limit))), h('div.cs-mbar' + (pct >= 80 ? '.hot' : ''), h('i', { style: { width: pct + '%' } }))) : null,
        h('div.field', h('label', t('Daily loss limit (0 = none)')), h('div.row', { style: 'gap:6px' }, h('div.grow', limIn), h('button.btn.sm', { type: 'button', onClick: async (e) => busy(e.currentTarget, async () => { try { const r = await api.post('/api/casino/limits', { limit: Math.max(0, Math.trunc((parseCoins(limIn.value) || 0) || 0)) }); st.fair = r.fair; toast(r.fair.rg.pending ? t('Saved. The higher limit applies in 24 hours.') : t('Limit saved.'), 'good'); paintRg(); paintBet(); } catch (er) { toastErr(er); } }) }, t('Save')))),
        rg.pending ? h('div.small.muted', t('Pending: {n} from {d}', { n: rg.pending.limit === 0 ? t('no limit') : fmt.coins(rg.pending.limit), d: fmt.dt(rg.pending.at) })) : null,
        h('div.field', h('label', t('Take a break')), h('div.row', { style: 'gap:6px;flex-wrap:wrap' }, [[1, t('1 hour')], [24, t('24 hours')], [168, t('7 days')]].map(([hrs, label]) =>
          h('button.btn.sm', { type: 'button', onClick: async () => { if (!(await confirmBox(t('Pause casino play for {l}? You won’t be able to undo this.', { l: label }), { danger: true, ok: t('Pause') }))) return; try { const r = await api.post('/api/casino/limits', { pauseHours: hrs }); st.fair = r.fair; paintAll(); } catch (er) { toastErr(er); } } }, label)))),
        paused() ? h('div.cs-paused', icon('clock', 16), t('Paused until {d}', { d: fmt.dt(rg.until) })) : null);
    }

    function paintStats() {
      const s = st.stats || {};
      mount(statBox, h('h3', t('Your stats')), h('div.cs-stats', [[t('Bets'), fmt.num(s.bets || 0)], [t('Wagered'), fmt.coins(s.wagered || 0)], [t('Won'), fmt.coins(s.won || 0)], [t('Biggest win'), fmt.coins(s.biggest || 0)]].map(([k, v]) => h('div', h('div.tiny.muted', k), h('b', v)))));
    }

    let lbTab = 'rich'; let lbAt = 0;
    async function paintLb() {
      lbAt = Date.now();
      let lb; try { lb = await api.get('/api/casino/leaderboard'); } catch { lb = { rich: [], big: [] }; }
      if (!alive) return;
      const list = lbTab === 'rich' ? lb.rich : lb.big;
      mount(lbBox, h('h3', icon('trophy', 18), ' ' + t('Leaderboard')),
        tabsEl([['rich', t('Richest')], ['big', t('Biggest win')]], lbTab, (id) => { lbTab = id; paintLb(); }),
        list.length ? h('ol.cs-lb', list.map((u, i) => h('li' + (u.id === S.me.id ? '.me' : ''), h('span.rk', String(i + 1)), h('span.grow', u.name), h('span.coin', fmt.coins(lbTab === 'rich' ? u.coins : u.win))))) : h('div.small.muted', { style: 'margin-top:10px' }, t('No winners yet — be the first!')));
    }

    // ---------- crash / plinko / mines / blackjack / jackpot (views/casino-more.js) ----------
    let extraOff = null;
    const env = {
      stage, betBox, cfg, alive: () => alive, pause, bet: () => bet, setBet: (v, store = true) => { bet = v; if (store) ls('casino.bet', bet); },
      paused, rounds: () => st.rounds || {}, paintBal, hold: (on) => { playing = on; S.coinHold = on; if (!on) S.coinPending = null; },
      pausedBox: () => (paused() ? h('div.cs-paused', icon('clock', 16), t('Casino play is paused until {d}. Take a break — you earned it.', { d: fmt.dt(st.fair.rg.until) })) : null),
      err: async (e) => { if (e.code === 'too_fast') toast(t('Slow down a little'), 'info'); else toastErr(e); if (e.code === 'excluded' || e.code === 'limit') { try { st = await api.get('/api/casino/state'); paintRg(); } catch {} } },
      sideSlot: (el) => { if (el) { mount(extraSide, el); extraSide.classList.remove('hidden'); } else { mount(extraSide); extraSide.classList.add('hidden'); } },
      done: (r) => { if (fx) fx.play(r); extraResult(r); bigWinFx(r); },
    };
    function extraResult(r) {
      if (!alive) return;
      if (typeof r.balance === 'number') patchMe({ coins: r.balance }); paintBal();
      if (typeof r.nonce === 'number' && r.game !== 'jackpot') st.fair.nonce = Math.max(st.fair.nonce, r.nonce + 1);
      if (st.rounds) { if (r.game === 'mines') st.rounds.mines = null; if (r.game === 'blackjack') st.rounds.bj = null; }
      st.stats = Object.assign({}, st.stats, { bets: (st.stats.bets || 0) + 1, wagered: (st.stats.wagered || 0) + r.bet, won: (st.stats.won || 0) + r.payout, biggest: Math.max(st.stats.biggest || 0, r.net) });
      const rg = st.fair.rg; rg.lost = r.net < 0 ? rg.lost - r.net : Math.max(0, rg.lost - r.net);
      hist.unshift(r); if (hist.length > 14) hist.pop();
      if (r.net > 0) { (r.mult >= 10 ? sfx.big : sfx.win)(); if (r.mult >= 10) confetti(); else if (r.net >= r.bet * 1.5) confetti(innerWidth / 2, innerHeight / 3, 24); } else if (r.net < 0 && r.game !== 'mines') sfx.lose();
      if (!actSent) { actSent = true; ws.send({ t: 'act', kind: 'casino', label: t('Playing in the casino') }); }
      paintHist(); paintFair(); paintRg(); paintStats(); if (Date.now() - lbAt > 4000) paintLb();
    }
    // 3D scene above the table (WebGL), plays the real result of each bet
    async function paintFx() {
      if (fxGame === game) return;
      if (fx) { fx.dispose(); fx = null; } fxGame = game;
      if (game === 'horses' || NEW_GAMES.has(game) || !fx3dOn()) return;
      const want = game; const f = await makeFx(game, fxHost); if (!alive || want !== game) { if (f) f.dispose(); return; } fx = f;
    }
    function paintGame() {
      paintFx();
      if (extraOff) { try { extraOff(); } catch {} extraOff = null; }
      if (EXTRA.has(game)) { env.sideSlot(null); extraOff = mountExtra(game, env); }
      else { env.sideSlot(null); paintStage(); paintBet(); }
    }
    function paintAll() { paintGame(); paintHist(); paintFair(); paintRg(); paintStats(); }

    mount(tabsHost, tabsEl(GAMES.map(([id, n, ic]) => [id, t(n), ic]), game, (id) => { if (playing) { tabs.set(game); return; } game = id; ls('casino.game', id); history.replaceState(null, '', '#/casino/' + id); paintGame(); }));
    const tabs = tabsHost.firstChild;
    paintAll(); paintLb();
    const offMe = bus.on('me', () => { paintBal(); });

    return () => { alive = false; S.coinHold = false; S.coinPending = null; timers.forEach(clearTimeout); offMe(); offFeed(); if (extraOff) { try { extraOff(); } catch {} } if (fx) fx.dispose(); };
  },
};
