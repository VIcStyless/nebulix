// Nebulix Game Maker (3.0 phase 19) — paint a platformer level with tiles, tune its physics, play-test it and publish it
// to Nebulix Hub as a real game (with a leaderboard through the Game API). The play-test and the published game run the
// same engine (public/js/gamemaker-runtime.js). #/gamemaker
import { h, mount } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { toast, toastErr, modal, confirmBox, field } from '../ui.js';
import { runGame } from '../gamemaker-runtime.js';
import { zipFiles } from '../zipwrite.js';

const TILES = [['#', 'Ground', '#16a34a'], ['B', 'Brick', '#b45309'], ['^', 'Spikes', '#94a3b8'], ['o', 'Coin', '#facc15'], ['J', 'Spring', '#ef4444'], ['E', 'Enemy', '#7c3aed'], ['S', 'Start', '#f97316'], ['G', 'Goal', '#22c55e'], ['.', 'Eraser', '#334155']];
const T = 32;
const nid = () => Math.random().toString(36).slice(2, 10);
function blank(w = 60, hh = 15) {
  const rows = Array.from({ length: hh }, (_, y) => (y >= hh - 2 ? '#'.repeat(w) : '.'.repeat(w)).split(''));
  rows[hh - 3][2] = 'S'; rows[hh - 3][w - 3] = 'G'; for (let x = 8; x < 14; x++) rows[hh - 6][x] = 'B'; rows[hh - 7][10] = 'o'; rows[hh - 7][11] = 'o'; rows[hh - 3][20] = 'E'; rows[hh - 3][30] = '^'; rows[hh - 3][31] = '^';
  return { w, h: hh, tiles: rows.map((r) => r.join('')), title: t('My level'), bg: '#7dd3fc', fg: '#16a34a', gravity: 10, jump: 10, speed: 10 };
}
export function buildHtml(level) { // the published game: one HTML file with the level and the same engine as the editor
  const safe = JSON.stringify(level).replace(/</g, '\\u003c');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${String(level.title).replace(/[<&]/g, '')}</title>
<style>html,body{margin:0;height:100%;background:#0f172a;display:grid;place-items:center;font-family:system-ui,sans-serif;overflow:hidden}canvas{max-width:100vw;max-height:100vh;image-rendering:pixelated;background:#000}
.pad{position:fixed;bottom:16px;display:flex;gap:10px}.pad button{width:64px;height:64px;border-radius:50%;border:0;background:rgba(255,255,255,.22);color:#fff;font-size:26px;touch-action:none}#l{left:16px}#r{right:16px}@media(hover:hover){.pad{display:none}}</style></head>
<body><canvas id="c" width="960" height="480"></canvas><div class="pad" id="l"><button data-k="ArrowLeft">◀</button><button data-k="ArrowRight">▶</button></div><div class="pad" id="r"><button data-k=" ">⤒</button></div>
<script>const LEVEL=${safe};
${runGame.toString()}
const game=runGame(document.getElementById('c'),LEVEL,{onWin:function(r){try{if(window.Nebulix&&Nebulix.submitScore)Nebulix.submitScore(r.score,r.coins+'/'+r.total+' · '+r.time.toFixed(1)+' s')}catch(e){}}});
document.querySelectorAll('.pad button').forEach(function(b){var k=b.dataset.k;b.addEventListener('pointerdown',function(e){e.preventDefault();game.press(k,true)});['pointerup','pointercancel','pointerleave'].forEach(function(ev){b.addEventListener(ev,function(){game.press(k,false)})})});
</script></body></html>`;
}

export default {
  full: true,
  title: () => 'Nebulix Game Maker',
  async mount(root, ctx) {
    let lv = blank(); let id = null; let tile = '#'; let painting = false; let lastCell = null; let test = null; const undo = [];
    const canvas = h('canvas.gm-canvas', { 'aria-label': t('Level editor — paint tiles with the mouse, right-click erases') }); const g = canvas.getContext('2d');
    const rows = () => lv.tiles.map((r) => r.split(''));
    function draw() {
      canvas.width = lv.w * T; canvas.height = lv.h * T; g.fillStyle = lv.bg; g.fillRect(0, 0, canvas.width, canvas.height);
      g.strokeStyle = 'rgba(255,255,255,.12)'; g.lineWidth = 1; for (let x = 0; x <= lv.w; x++) { g.beginPath(); g.moveTo(x * T + 0.5, 0); g.lineTo(x * T + 0.5, canvas.height); g.stroke(); } for (let y = 0; y <= lv.h; y++) { g.beginPath(); g.moveTo(0, y * T + 0.5); g.lineTo(canvas.width, y * T + 0.5); g.stroke(); }
      const r = rows(); for (let y = 0; y < lv.h; y++) for (let x = 0; x < lv.w; x++) { const c = r[y][x]; if (c === '.') continue; const def = TILES.find((d) => d[0] === c); g.fillStyle = c === '#' ? lv.fg : def ? def[2] : '#fff';
        if (c === 'o') { g.beginPath(); g.arc(x * T + 16, y * T + 16, 9, 0, Math.PI * 2); g.fill(); } else if (c === '^') { g.beginPath(); g.moveTo(x * T, y * T + T); g.lineTo(x * T + 16, y * T + 8); g.lineTo(x * T + T, y * T + T); g.fill(); } else if (c === 'E') { g.beginPath(); g.ellipse(x * T + 16, y * T + 18, 13, 12, 0, 0, Math.PI * 2); g.fill(); }
        else { g.fillRect(x * T + 1, y * T + 1, T - 2, T - 2); if (c === 'S' || c === 'G' || c === 'J') { g.fillStyle = '#fff'; g.font = 'bold 16px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(c === 'S' ? '▶' : c === 'G' ? '⚑' : '⇡', x * T + 16, y * T + 17); } } }
    }
    const cellAt = (e) => { const r = canvas.getBoundingClientRect(); return [Math.floor((e.clientX - r.left) / r.width * lv.w), Math.floor((e.clientY - r.top) / r.height * lv.h)]; };
    function put(x, y, c) {
      if (x < 0 || y < 0 || x >= lv.w || y >= lv.h) return; const r = rows();
      if (c === 'S' || c === 'G') for (const row of r) for (let i = 0; i < row.length; i++) if (row[i] === c) row[i] = '.'; // only one start and one goal
      if (r[y][x] === c) return; r[y][x] = c; lv.tiles = r.map((row) => row.join('')); draw();
    }
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); undo.push(JSON.stringify(lv)); if (undo.length > 50) undo.shift(); painting = e.button === 2 ? '.' : tile; const [x, y] = cellAt(e); lastCell = [x, y]; put(x, y, painting); });
    canvas.addEventListener('pointermove', (e) => { if (!painting) return; const [x, y] = cellAt(e); const [x0, y0] = lastCell || [x, y]; const n = Math.max(Math.abs(x - x0), Math.abs(y - y0)); // fill the cells between two events so fast strokes have no gaps
      for (let i = 1; i <= n; i++) put(Math.round(x0 + (x - x0) * i / n), Math.round(y0 + (y - y0) * i / n), painting); if (!n) put(x, y, painting); lastCell = [x, y]; });
    canvas.addEventListener('pointerup', () => { painting = false; });
    const pal = h('div.gm-pal');
    function paintPal() { mount(pal, TILES.map(([c, n, col]) => h('button.gm-tile' + (tile === c ? '.on' : ''), { type: 'button', title: t(n), 'aria-pressed': String(tile === c), onClick: () => { tile = c; paintPal(); } }, h('i', { style: 'background:' + col }), h('span', t(n))))); }
    function validate() { const all = lv.tiles.join(''); if (!all.includes('S')) return t('Place a start (▶)'); if (!all.includes('G')) return t('Place a goal (⚑)'); return null; }
    function playTest() {
      const err = validate(); if (err) return toast(err, 'err'); stopTest();
      const c = h('canvas.gm-play', { width: 960, height: 480, tabIndex: 0 }); const res = h('div.gm-res');
      const btn = (k, label) => { const b = h('button.gm-pad', { type: 'button', 'aria-label': label }, label); b.addEventListener('pointerdown', (e) => { e.preventDefault(); test && test.press(k, true); }); for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, () => test && test.press(k, false)); return b; };
      const box = h('div.gm-test', h('div.row', { style: 'gap:8px;align-items:center' }, h('b.grow', t('Play-test') + ': ' + lv.title), h('span.tiny.muted', t('Arrows/A D to move, Space/W to jump')), h('button.btn.sm', { onClick: () => test && test.restart() }, t('Restart')), h('button.btn.sm', { onClick: stopTest }, t('Back to editor'))), c, res,
        h('div.row', { style: 'gap:10px;justify-content:space-between' }, h('div.row', { style: 'gap:8px' }, btn('ArrowLeft', '◀'), btn('ArrowRight', '▶')), btn(' ', '⤒')));
      editor.hidden = true; root.querySelector('.gm').append(box); c.focus();
      test = runGame(c, JSON.parse(JSON.stringify(lv)), { onStep: (n) => { if (window.__nbxGM && window.__nbxGM.onStep) window.__nbxGM.onStep(n); }, onWin: (r) => mount(res, h('p.gm-win', '🏁 ' + t('Level completed: {s} points, {c}/{n} coins, {t} s', { s: r.score, c: r.coins, n: r.total, t: r.time.toFixed(1) }))) });
      window.__nbxGM.test = test;
    }
    function stopTest() { if (test) { test.stop(); test = null; } const b = root.querySelector('.gm-test'); if (b) b.remove(); editor.hidden = false; }
    async function saveLevel() { try { id = id || nid(); await api.put('/api/me/tools/levels/' + id, { data: lv }); toast(t('Level saved'), 'good'); } catch (e) { toastErr(e); } }
    async function openLevel() {
      let items = []; try { items = (await api.get('/api/me/tools/levels')).items; } catch (e) { return toastErr(e); }
      modal({ title: t('Your levels'), body: items.length ? h('div.col', { style: 'gap:6px' }, items.map((x) => h('div.row', { style: 'gap:6px' }, h('button.btn.grow', { type: 'button', onClick: () => { lv = x.data; id = x.id; sync(); draw(); document.querySelector('.modal .actions button').click(); } }, x.data.title, h('span.tiny.muted', ' · ' + x.data.w + '×' + x.data.h)), h('button.btn.sm.ghost', { type: 'button', 'aria-label': t('Delete'), onClick: async (e) => { if (await confirmBox(t('Delete this level?'), { danger: true })) { await api.del('/api/me/tools/levels/' + x.id); e.target.closest('.row').remove(); } } }, icon('trash', 13))))) : h('p.muted', t('No saved levels yet.')), actions: [{ label: t('Close') }] });
    }
    async function publish() {
      const err = validate(); if (err) return toast(err, 'err');
      const desc = h('textarea.input', { rows: 3, placeholder: t('Tell players what to do') });
      modal({ title: t('Publish to Nebulix Hub'), body: h('div.col', { style: 'gap:10px' }, h('p.small.muted', t('Your level becomes a game on Nebulix Hub that anyone can play in the browser, with a leaderboard.')), field(t('Description'), desc)),
        actions: [{ label: t('Cancel'), value: false }, { label: t('Publish'), kind: 'primary', onClick: async () => {
          try {
            const html = buildHtml(lv); const zip = await zipFiles([{ path: 'index.html', file: new File([html], 'index.html', { type: 'text/html' }) }]);
            const up = await api.put('/api/hub/upload?kind=game&name=' + encodeURIComponent((lv.title || 'nivel') + '.zip'), zip, { type: 'application/zip' });
            const th = document.createElement('canvas'); th.width = 640; th.height = 360; const tg = th.getContext('2d'); tg.fillStyle = lv.bg; tg.fillRect(0, 0, 640, 360); tg.drawImage(canvas, 0, 0, Math.min(canvas.width, canvas.height * 16 / 9), canvas.height, 0, 0, 640, 360);
            const thumbBlob = await new Promise((r) => th.toBlob(r, 'image/png')); const tu = await api.put('/api/hub/upload?kind=game&thumb=1&name=thumb.png', thumbBlob, { type: 'image/png' }).catch(() => null); // a missing thumbnail must not block publishing
            const r = await api.post('/api/hub', { upload: up.upload, title: lv.title || t('My level'), desc: desc.value, tags: ['platformer', 'game-maker'], public: true, thumb: tu && tu.upload });
            toast(t('Published!'), 'good'); window.__nbxGM.published = r.item.id; ctx.go('hub/' + r.item.id);
          } catch (e) { toastErr(e); return false; }
        } }] });
    }
    const title = h('input.input', { 'aria-label': t('Level name'), onInput: (e) => { lv.title = e.target.value.slice(0, 80); } });
    const sliders = h('div.gm-sliders');
    function sync() {
      title.value = lv.title;
      const sl = (k, label) => h('label.ph-range', h('span', label), h('input', { type: 'range', min: 4, max: 20, value: lv[k], onInput: (e) => { lv[k] = Number(e.target.value); e.target.nextSibling.textContent = e.target.value; } }), h('b', String(lv[k])));
      mount(sliders, sl('gravity', t('Gravity')), sl('jump', t('Jump')), sl('speed', t('Speed')),
        h('div.row', { style: 'gap:8px;align-items:center' }, h('span.tiny', t('Sky')), h('input', { type: 'color', value: lv.bg, onInput: (e) => { lv.bg = e.target.value; draw(); } }), h('span.tiny', t('Ground')), h('input', { type: 'color', value: lv.fg, onInput: (e) => { lv.fg = e.target.value; draw(); } })),
        h('label.ph-range', h('span', t('Width')), h('input', { type: 'number', min: 20, max: 300, value: lv.w, class: 'input', onChange: (e) => { const w = Math.max(20, Math.min(300, Number(e.target.value) || lv.w)); undo.push(JSON.stringify(lv)); lv.tiles = lv.tiles.map((r, y) => (r.length >= w ? r.slice(0, w) : r + (y >= lv.h - 2 ? '#' : '.').repeat(w - r.length))); lv.w = w; draw(); } }), h('span')));
    }
    const editor = h('div.gm-editor',
      h('div.gm-bar', title, h('button.btn.sm', { onClick: () => { if (undo.length) { lv = JSON.parse(undo.pop()); sync(); draw(); } } }, '↶ ' + t('Undo')), h('button.btn.sm', { onClick: async () => { if (await confirmBox(t('Start a new empty level?'))) { lv = blank(); id = null; sync(); draw(); } } }, icon('plus', 13), t('New')), h('button.btn.sm', { onClick: openLevel }, icon('folder', 13), t('Open')), h('button.btn.sm', { onClick: saveLevel }, t('Save')), h('span.grow'),
        h('button.btn.sm.primary', { onClick: playTest }, icon('play', 13), t('Play-test')), h('button.btn.sm', { onClick: publish }, icon('upload', 13), t('Publish to Hub'))),
      h('div.gm-main', h('aside.gm-side', h('div.eyebrow', t('Tiles')), pal, h('div.eyebrow', t('Physics and colours')), sliders, h('p.tiny.muted', t('Left click paints, right click erases. There is one start and one goal; enemies walk and turn at edges; jump on them to defeat them.'))), h('div.gm-scroll', canvas)));
    mount(root, h('div.gm', editor)); paintPal(); sync(); draw();
    window.__nbxGM = { get level() { return lv; }, set level(v) { lv = v; sync(); draw(); }, playTest, buildHtml };
    return () => { stopTest(); delete window.__nbxGM; };
  },
};
