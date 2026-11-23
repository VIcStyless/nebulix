// Nebula Fusion (13.8): an original element-combining game. #/fusion
// Click elements in your list to drop them on the board, then drag one onto another (or tap two) to combine them.
// New results are decided by the AI once and shared by everyone; the first player to find an element gets coins.
import { h, mount, fmt } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { patchMe, S } from '../state.js';
import { icon } from '../icons.js';
import { toast, toastErr, loading, confetti } from '../ui.js';
import { sfx } from '../sfx.js';

const snd = (k) => { try { sfx[k] && sfx[k](); } catch {} };
// a stable colour per element name (no emojis: each element gets its own colour and initial)
const hue = (s) => { let x = 0; for (const c of String(s).toLowerCase()) x = (x * 31 + c.charCodeAt(0)) >>> 0; return x % 360; };
const chipStyle = (n) => ({ '--hc': `hsl(${hue(n)} 70% 55%)` });

export default {
  title: () => 'Nebula Fusion', full: true,
  async mount(root) {
    const wrap = h('div.fu', loading()); mount(root, wrap);
    let st; try { st = await api.get('/api/fusion'); } catch (e) { mount(wrap, h('span.error', e.message)); return () => {}; }
    let found = st.found.slice(); let q = ''; let sel = null; let busy = false; let z = 1;
    const board = h('div.fu-board'); const list = h('div.fu-list'); const stats = h('div.fu-stats'); const search = h('input.input', { placeholder: t('Search your elements…'), onInput: () => { q = search.value.toLowerCase(); paintList(); } });
    mount(wrap, h('div.fu-head', h('div', h('h2', 'Nebula Fusion'), h('p.small.muted', t('Combine elements to discover new ones. Drag one onto another, or tap two. Be the first in Nebulix to find something and earn coins.'))), stats),
      h('div.fu-main', h('div.fu-boardwrap', board, h('div.fu-tools', h('button.btn.sm', { onClick: () => { mount(board); } }, icon('trash', 14), t('Clear board')), h('button.btn.sm', { onClick: showBoard }, icon('trophy', 14), t('Top discoverers')))), h('aside.fu-side', search, list)));
    const paintStats = () => mount(stats, h('span.pill', t('{n} found', { n: found.length })), h('span.pill', t('{n} first discoveries', { n: st.firsts })), h('span.pill', t('{n} in Nebulix', { n: st.worldTotal })));
    function paintList() { const items = found.filter((n) => !q || n.toLowerCase().includes(q)).slice().reverse(); mount(list, items.map((n) => h('button.fu-chip', { style: chipStyle(n), onClick: () => drop(n) }, h('i', n[0]), n))); }
    function place(n, x, y, cls = '') {
      const el = h('div.fu-chip.on-board' + cls, { style: Object.assign(chipStyle(n), { left: x + 'px', top: y + 'px', zIndex: ++z }) }, h('i', n[0]), n); el.dataset.n = n; board.append(el); drag(el); return el;
    }
    function drop(n) { const r = board.getBoundingClientRect(); place(n, 20 + Math.random() * Math.max(40, r.width - 180), 20 + Math.random() * Math.max(40, r.height - 80)); snd('tick'); }
    function drag(el) {
      let sx = 0, sy = 0, ox = 0, oy = 0, moved = false;
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.setPointerCapture(e.pointerId); sx = e.clientX; sy = e.clientY; ox = el.offsetLeft; oy = el.offsetTop; moved = false; el.style.zIndex = ++z; el.classList.add('drag'); });
      el.addEventListener('pointermove', (e) => { if (!el.classList.contains('drag')) return; const dx = e.clientX - sx, dy = e.clientY - sy; if (Math.abs(dx) + Math.abs(dy) > 4) moved = true; el.style.left = ox + dx + 'px'; el.style.top = oy + dy + 'px'; const o = overlap(el); board.querySelectorAll('.fu-chip.target').forEach((x) => x.classList.toggle('target', x === o)); if (o) o.classList.add('target'); });
      el.addEventListener('pointerup', () => { el.classList.remove('drag'); const o = overlap(el); board.querySelectorAll('.fu-chip.target').forEach((x) => x.classList.remove('target')); if (o && moved) return fuse(el, o); if (!moved) tap(el); });
      el.addEventListener('dblclick', () => place(el.dataset.n, el.offsetLeft + 24, el.offsetTop + 24));
    }
    const overlap = (el) => { const a = el.getBoundingClientRect(); return [...board.querySelectorAll('.fu-chip')].find((o) => { if (o === el) return false; const b = o.getBoundingClientRect(); return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top; }); };
    function tap(el) { if (sel && sel !== el && sel.isConnected) { const a = sel; sel.classList.remove('sel'); sel = null; return fuse(a, el); } if (sel) sel.classList.remove('sel'); sel = el; el.classList.add('sel'); }
    async function fuse(a, b) {
      if (busy) return; busy = true; a.classList.add('busy'); b.classList.add('busy');
      try {
        const r = await api.post('/api/fusion/combine', { a: a.dataset.n, b: b.dataset.n });
        if (!r.result) { a.classList.remove('busy'); b.classList.remove('busy'); a.classList.add('nope'); setTimeout(() => a.classList.remove('nope'), 500); toast(r.aiOff ? t('Nothing happened. (The AI is offline, so only the built-in recipes work right now.)') : t('Nothing happened. Try another pair.'), 'info', 2200); busy = false; return; }
        const x = (a.offsetLeft + b.offsetLeft) / 2, y = (a.offsetTop + b.offsetTop) / 2; a.remove(); b.remove();
        const el = place(r.result, x, y, '.pop'); setTimeout(() => el.classList.remove('pop'), 600);
        if (r.isNew) { found.push(r.result); paintList(); }
        if (r.first) { st.firsts++; st.worldTotal++; confetti(); snd('big'); toast(t('First discovery in Nebulix: {e}!', { e: r.result }) + (r.coins ? ' +' + fmt.coins(r.coins) : ''), 'good', 4000); }
        else if (r.isNew) { snd('coin'); toast(t('New: {e}', { e: r.result }) + (r.coins ? ' +' + fmt.coins(r.coins) : ''), 'good', 1800); } else snd('tick');
        if (r.coins && S.me) patchMe({ coins: S.me.coins + r.coins });
        paintStats();
      } catch (e) { a.classList.remove('busy'); b.classList.remove('busy'); toastErr(e); }
      busy = false;
    }
    async function showBoard() { try { const r = await api.get('/api/fusion/board'); toast(r.board.slice(0, 5).map((x, i) => `#${i + 1} @${x.user.username} · ${x.firsts}★ · ${x.found}`).join('\n') || t('Nobody yet'), 'info', 7000); } catch (e) { toastErr(e); } }
    paintStats(); paintList(); st.base.forEach((n, i) => place(n, 30 + i * 130, 30));
    return () => {};
  },
};
