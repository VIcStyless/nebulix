// Investments: real stock quotes (fetched by the server), simulated buying/selling with virtual coins, charts, portfolio and history.
import { h, mount, fmt, clamp, ls } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { S, patchMe } from '../state.js';
import { icon } from '../icons.js';
import { toast, toastErr, loading, emptyState, busy, segEl, field } from '../ui.js';

const RANGES = [['1d', '1D'], ['5d', '5D'], ['1mo', '1M'], ['6mo', '6M'], ['1y', '1Y']];
const usd = (n) => (n === null || n === undefined ? '—' : new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: Math.abs(n) < 10 ? 5 : 2 }).format(n));
const pct = (n) => (n > 0 ? '+' : '') + (Math.round(n * 100) / 100).toFixed(2) + '%';
const css = (k, d) => getComputedStyle(document.documentElement).getPropertyValue(k).trim() || d;
const LOGO = { AAPL: '', NVDA: '', MSFT: '', GOOGL: '', AMZN: '', TSLA: '', META: '' };
const tint = { AAPL: '#a3a3a3', NVDA: '#76b900', MSFT: '#00a4ef', GOOGL: '#4285f4', AMZN: '#ff9900', TSLA: '#e82127', META: '#0866ff', 'BTC-USD': '#f7931a', 'ETH-USD': '#627eea', 'SOL-USD': '#9945ff', 'BNB-USD': '#f3ba2f', 'XRP-USD': '#23292f', 'ADA-USD': '#0033ad', 'DOGE-USD': '#c2a633', 'LTC-USD': '#345d9d', 'AVAX-USD': '#e84142', 'DOT-USD': '#e6007a' };
const CSYM = { 'BTC-USD': '₿', 'ETH-USD': 'Ξ', 'DOGE-USD': 'Ð', 'LTC-USD': 'Ł' };
const short = (s) => s.replace('-USD', '');

export default {
  title: () => t('Invest'),
  async mount(root) {
    let alive = true; let market = null; let pf = null; let sel = ls('inv.sym') || 'AAPL'; let range = ls('inv.range') || '1mo'; let side = 'buy'; let kind = ls('inv.kind') || 'stock'; let chart = null; let hover = null;
    const inner = h('div.inner'); mount(root, inner); mount(inner, loading(t('Opening the market…')));
    const mkEl = h('div.iv-market'); const chartCard = h('div.card.iv-chartcard'); const tradeCard = h('div.card'); const pfCard = h('div.card'); const histCard = h('div.card');
    try { [market, pf] = await Promise.all([api.get('/api/invest/market'), api.get('/api/invest/portfolio')]); } catch (e) { mount(inner, emptyState('alert', t('The market is closed right now'), e.message)); return () => {}; }
    if (!market.stocks.some((s) => s.sym === sel)) sel = 'AAPL';
    { const cur = market.stocks.find((s) => s.sym === sel); if (cur && (cur.kind || 'stock') !== kind) kind = cur.kind || 'stock'; }
    const kindSeg = h('div.iv-kind');
    mount(inner, h('div.page-title', h('div', h('h2', t('Invest')), h('p', t('Real market prices for stocks and crypto, simulated trading. 1 coin = 1 USD. Virtual coins have no real value.')))),
      h('div.cs-note', icon('info', 16), h('span', t('Quotes refresh every minute from public market data and may be delayed. This is a game, not financial advice.'))),
      kindSeg, mkEl, h('div.iv-layout', h('div.col', chartCard, pfCard), h('div.col', tradeCard, histCard)));

    const stock = () => market.stocks.find((s) => s.sym === sel);
    const holding = () => (pf.rows.find((r) => r.sym === sel) || { q: 0 });
    function paintMarket() {
      mount(kindSeg, segEl([['stock', t('Stocks')], ['crypto', t('Crypto')]], kind, (v) => { kind = v; ls('inv.kind', v); const first = market.stocks.find((s) => (s.kind || 'stock') === v); if (first && (stock().kind || 'stock') !== v) { sel = first.sym; ls('inv.sym', sel); loadChart(); paintTrade(); } paintMarket(); }));
      mount(mkEl, market.stocks.filter((s) => (s.kind || 'stock') === kind).map((s) => h('button.iv-tick' + (s.sym === sel ? '.on' : ''), { type: 'button', onClick: () => { sel = s.sym; ls('inv.sym', sel); paintMarket(); loadChart(); paintTrade(); } },
        h('span.iv-logo', { style: { background: tint[s.sym] } }, CSYM[s.sym] || short(s.sym)[0]), h('div.grow', h('b', short(s.sym)), h('div.tiny.muted.ellipsis', s.name)),
        h('div.iv-px', h('b', usd(s.price)), h('span.tiny' + (s.change >= 0 ? '.up' : '.down'), pct(s.change || 0))))));
    }
    // ---------- chart ----------
    const cv = h('canvas.iv-canvas'); const tip = h('div.iv-tip.hidden');
    function paintChartShell() {
      const s = stock();
      mount(chartCard, h('div.row', { style: 'gap:10px;flex-wrap:wrap;align-items:flex-end' },
        h('div.grow', h('div.small.muted', s.name + ' · ' + short(s.sym)), h('div.iv-big', usd(s.price), ' ', h('span.small' + (s.change >= 0 ? '.up' : '.down'), pct(s.change || 0) + ' ' + t('today'))), !s.live && s.price ? h('div.tiny.muted', t('Showing the last known price')) : null),
        segEl(RANGES.map(([v, l]) => [v, l]), range, (v) => { range = v; ls('inv.range', v); loadChart(); })),
        h('div.iv-chartwrap', cv, tip));
    }
    async function loadChart() {
      paintChartShell(); chart = null; drawChart();
      try { const c = await api.get(`/api/invest/chart/${sel}?range=${range}`); if (!alive || c.sym !== sel) return; chart = c; drawChart(); } catch (e) { toastErr(e); }
    }
    function drawChart() {
      const dpr = devicePixelRatio || 1; const W = Math.max(280, cv.clientWidth || 600), H = 260; cv.width = W * dpr; cv.height = H * dpr; const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
      if (!chart || chart.pts.length < 2) { g.fillStyle = 'rgba(255,255,255,.4)'; g.font = '13px system-ui'; g.fillText(chart ? t('Not enough data') : t('Loading chart…'), 16, 30); return; }
      const P = chart.pts; const vals = P.map((p) => p[1]); let lo = Math.min(...vals), hi = Math.max(...vals); const pad = (hi - lo) * 0.1 || 1; lo -= pad; hi += pad;
      const L = 8, R = 62, T = 10, B = 24; const x = (i) => L + (i / (P.length - 1)) * (W - L - R); const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
      const up = P[P.length - 1][1] >= P[0][1]; const col = up ? css('--success', '#22c55e') : '#ef4444';
      g.strokeStyle = 'rgba(255,255,255,.06)'; g.fillStyle = 'rgba(255,255,255,.45)'; g.font = '11px system-ui';
      for (let i = 0; i <= 4; i++) { const v = lo + ((hi - lo) * i) / 4; const yy = y(v); g.beginPath(); g.moveTo(L, yy); g.lineTo(W - R, yy); g.stroke(); g.fillText(usd(v), W - R + 6, yy + 4); }
      const fmtX = (ms) => (range === '1d' ? new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' }));
      [0, Math.floor(P.length / 2), P.length - 1].forEach((i, k) => { g.textAlign = k === 0 ? 'left' : k === 2 ? 'right' : 'center'; g.fillText(fmtX(P[i][0]), x(i), H - 6); }); g.textAlign = 'left';
      const grad = g.createLinearGradient(0, T, 0, H - B); grad.addColorStop(0, col + '55'); grad.addColorStop(1, col + '00');
      g.beginPath(); P.forEach((p, i) => (i ? g.lineTo(x(i), y(p[1])) : g.moveTo(x(i), y(p[1])))); g.lineTo(x(P.length - 1), H - B); g.lineTo(x(0), H - B); g.closePath(); g.fillStyle = grad; g.fill();
      g.beginPath(); P.forEach((p, i) => (i ? g.lineTo(x(i), y(p[1])) : g.moveTo(x(i), y(p[1])))); g.strokeStyle = col; g.lineWidth = 2; g.stroke();
      const hd = holding(); if (hd.q > 0 && hd.avg >= lo && hd.avg <= hi) { g.setLineDash([4, 5]); g.strokeStyle = 'rgba(250,204,21,.7)'; g.beginPath(); g.moveTo(L, y(hd.avg)); g.lineTo(W - R, y(hd.avg)); g.stroke(); g.setLineDash([]); g.fillStyle = 'rgba(250,204,21,.9)'; g.fillText(t('your avg'), L + 4, y(hd.avg) - 5); }
      if (hover !== null && P[hover]) { const xx = x(hover), yy = y(P[hover][1]); g.strokeStyle = 'rgba(255,255,255,.3)'; g.beginPath(); g.moveTo(xx, T); g.lineTo(xx, H - B); g.stroke(); g.fillStyle = col; g.beginPath(); g.arc(xx, yy, 4.5, 0, 7); g.fill();
        tip.classList.remove('hidden'); tip.style.left = clamp(xx - 60, 0, W - 130) + 'px'; tip.style.top = Math.max(0, yy - 52) + 'px'; mount(tip, h('b', usd(P[hover][1])), h('div.tiny.muted', new Date(P[hover][0]).toLocaleString())); } else tip.classList.add('hidden');
      cv._map = (cx) => Math.round(clamp((cx - L) / (W - L - R), 0, 1) * (P.length - 1));
    }
    cv.addEventListener('pointermove', (e) => { if (!cv._map) return; const r = cv.getBoundingClientRect(); hover = cv._map(e.clientX - r.left); drawChart(); });
    cv.addEventListener('pointerleave', () => { hover = null; drawChart(); });
    const ro = new ResizeObserver(() => drawChart()); ro.observe(cv);
    // ---------- trade ----------
    function paintTrade() {
      const s = stock(); const hd = holding(); let qty = Number(ls('inv.qty') || 1);
      const qIn = h('input.input', { type: 'number', min: '0.0001', step: '0.0001', value: String(qty), 'aria-label': t('Shares') });
      const est = h('div.cs-sum');
      const paintEst = () => { qty = Math.max(0, Math.round(Number(qIn.value) * 10000) / 10000); const coins = s.price ? (side === 'buy' ? Math.ceil(qty * s.price) : Math.floor(qty * s.price)) : 0;
        mount(est, h('div', h('span.muted', t('Price')), h('b', usd(s.price))), h('div', h('span.muted', side === 'buy' ? t('Cost') : t('You receive')), h('span.coin', fmt.coins(coins))), h('div', h('span.muted', t('You own')), h('b', String(hd.q || 0))), h('div', h('span.muted', t('Coins')), h('span.coin', (S.me.infinite ? '∞' : fmt.coins(S.me.coins))))); };
      qIn.addEventListener('input', paintEst);
      const maxBtn = h('button.btn.sm', { type: 'button', onClick: () => { qIn.value = String(side === 'buy' ? Math.floor((S.me.coins / s.price) * 10000) / 10000 : hd.q || 0); paintEst(); } }, t('Max'));
      mount(tradeCard, h('h3', icon('chart', 18), ' ' + t('Trade {s}', { s: short(s.sym) })),
        segEl([['buy', t('Buy')], ['sell', t('Sell')]], side, (v) => { side = v; paintTrade(); }),
        h('div.row', { style: 'gap:8px;align-items:flex-end;margin-top:10px' }, h('div.grow', field(t(kind === 'crypto' ? 'Quantity (fractions allowed)' : 'Shares (fractions allowed)'), qIn)), h('div', { style: 'margin-bottom:2px' }, maxBtn)),
        h('div.row', { style: 'gap:6px;flex-wrap:wrap' }, [0.1, 1, 5, 10].map((n) => h('button.cs-chip', { type: 'button', onClick: () => { qIn.value = String(n); paintEst(); } }, String(n)))),
        est,
        h('button.btn.primary.cs-go' + (side === 'sell' ? '.iv-sell' : ''), { type: 'button', disabled: !s.price, onClick: (e) => busy(e.currentTarget, async () => {
          const q = Math.round(Number(qIn.value) * 10000) / 10000; if (!(q > 0)) return toast(t('Enter how many shares'), 'err');
          try { const r = await api.post('/api/invest/trade', { sym: s.sym, side, qty: q }); ls('inv.qty', q); pf = r; patchMe({ coins: r.coins }); toast(side === 'buy' ? t('Bought {q} {s} for {n} coins', { q, s: short(s.sym), n: fmt.coins(r.coinsMoved) }) : t('Sold {q} {s} for {n} coins', { q, s: short(s.sym), n: fmt.coins(r.coinsMoved) }), 'coin'); paintTrade(); paintPf(); paintHist(); drawChart(); } catch (er) { toastErr(er); }
        }) }, icon(side === 'buy' ? 'plus' : 'swap', 17), side === 'buy' ? t('Buy {s}', { s: short(s.sym) }) : t('Sell {s}', { s: short(s.sym) })));
      paintEst();
    }
    function paintPf() {
      const plc = pf.pl >= 0 ? '.up' : '.down';
      mount(pfCard, h('h3', icon('layers', 18), ' ' + t('Your portfolio')),
        h('div.cs-sum', h('div', h('span.muted', t('Value')), h('span.coin', fmt.coins(pf.value))), h('div', h('span.muted', t('Invested')), h('span.coin', fmt.coins(pf.cost))), h('div', h('span.muted', t('Unrealized P/L')), h('b' + plc, (pf.pl >= 0 ? '+' : '') + fmt.coins(pf.pl))), h('div', h('span.muted', t('Realized P/L')), h('b' + (pf.realized >= 0 ? '.up' : '.down'), (pf.realized >= 0 ? '+' : '') + fmt.coins(pf.realized)))),
        pf.rows.length ? h('div.iv-table', h('div.iv-tr.head', h('span', t('Asset')), h('span', t('Shares')), h('span', t('Avg')), h('span', t('Price')), h('span', t('Value')), h('span', 'P/L')),
          pf.rows.map((r) => h('button.iv-tr', { type: 'button', onClick: () => { sel = r.sym; ls('inv.sym', sel); paintMarket(); loadChart(); paintTrade(); } }, h('b', short(r.sym)), h('span', String(r.q)), h('span', usd(r.avg)), h('span', usd(r.price)), h('span.coin', fmt.coins(r.value || 0)), h('b' + ((r.pl || 0) >= 0 ? '.up' : '.down'), ((r.pl || 0) >= 0 ? '+' : '') + fmt.coins(r.pl || 0)))))
          : h('p.small.muted', t('You do not own any shares yet. Pick a stock and buy your first one!')));
    }
    function paintHist() {
      mount(histCard, h('h3', icon('clock', 18), ' ' + t('Trade history')), pf.hist.length ? h('div.cs-hist', pf.hist.slice(0, 15).map((x) => h('div.cs-h' + (x.side === 'sell' ? '.win' : ''), h('span.cs-h-ic', h('b', x.side === 'buy' ? 'B' : 'S')), h('div.grow', h('div', (x.side === 'buy' ? t('Bought') : t('Sold')) + ' ' + x.q + ' ' + x.sym + ' @ ' + usd(x.price)), h('div.tiny.muted', fmt.rel(x.t))), h('b.cs-h-net' + (x.side === 'buy' ? '.neg' : '.pos'), (x.side === 'buy' ? '−' : '+') + fmt.coins(x.coins))))) : h('p.small.muted', t('No trades yet.')));
    }
    paintMarket(); loadChart(); paintTrade(); paintPf(); paintHist();
    const iv = setInterval(async () => { try { market = await api.get('/api/invest/market', { quiet: true }); pf = await api.get('/api/invest/portfolio', { quiet: true }); if (!alive) return; paintMarket(); paintPf(); const s = stock(); const big = chartCard.querySelector('.iv-big'); if (big && s) { paintChartShell(); drawChart(); } } catch {} }, 60000);
    return () => { alive = false; clearInterval(iv); ro.disconnect(); };
  },
};
