// World Boss: every 2 hours a giant monster appears for 20 minutes and everyone online fights it together. #/boss
import { h, mount, fmt } from '../util.js';
import { t, pick2 } from '../i18n.js';
import { api, ws } from '../api.js';
import { S, bus } from '../state.js';
import { toastErr, loading, emptyState, busy, confetti } from '../ui.js';
import { avatarEl } from '../cosmetics.js';
import { sfx } from '../sfx.js';
import { icon } from '../icons.js';

const clock = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); const hh = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const ss = s % 60; return (hh ? hh + ':' + String(m).padStart(2, '0') : m) + ':' + String(ss).padStart(2, '0'); };
const snd = (k) => { try { sfx[k] && sfx[k](); } catch {} };

export default {
  title: () => t('World Boss'),
  async mount(root) {
    const inner = h('div.inner.bs'); mount(root, inner, loading()); let d; const offs = []; let pending = 0; let flushT = 0; let tickT = 0; let mine = 0;
    let arena = null, hpFill = null, hpTxt = null, mineEl = null, topEl = null, fightersEl = null, timeEl = null, monster = null;
    const load = async () => { d = await api.get('/api/boss'); mine = d.live ? d.live.myDmg : 0; paint(); };
    try { await load(); } catch (e) { mount(inner, emptyState('alert', t('Could not load this'), e.message)); return () => {}; }
    const flush = () => { if (pending > 0) { ws.send({ t: 'boss_hit', n: pending }); pending = 0; } };
    function floater(text, crit) { if (!arena) return; const r = arena.getBoundingClientRect(); const el = h('span.bs-num' + (crit ? '.crit' : ''), text); el.style.left = (r.width * (0.3 + Math.random() * 0.4)) + 'px'; el.style.top = (r.height * (0.25 + Math.random() * 0.3)) + 'px'; arena.append(el); setTimeout(() => el.remove(), 900); }
    function hit(e) {
      if (!d.live) return; pending++; snd('click'); if (monster) { monster.classList.remove('hit'); void monster.offsetWidth; monster.classList.add('hit'); }
      if (e && arena) { const r = arena.getBoundingClientRect(); const s = h('span.bs-spark'); s.style.left = (e.clientX - r.left) + 'px'; s.style.top = (e.clientY - r.top) + 'px'; arena.append(s); setTimeout(() => s.remove(), 400); }
    }
    function paintTop(list) { if (!topEl) return; mount(topEl, list.length ? list.map((x) => h('div.bs-row' + (x.user.id === S.me.id ? '.me' : ''), h('span.bs-rk', ['🥇', '🥈', '🥉'][x.rank - 1] || '#' + x.rank), avatarEl(x.user, { size: 24 }), h('b.grow', x.user.displayName), h('span.mono', fmt.compact(x.dmg)))) : h('p.small.muted', t('Nobody has attacked yet. Strike first!'))); }
    function paintHp(l) { if (!hpFill) return; const p = l.max ? (l.hp / l.max) * 100 : 0; hpFill.style.width = p + '%'; hpFill.classList.toggle('low', p < 30); hpTxt.textContent = fmt.num(l.hp) + ' / ' + fmt.num(l.max); if (fightersEl) fightersEl.textContent = t('{n} fighters', { n: l.fighters }); if (l.top) paintTop(l.top); }
    function paint() {
      arena = hpFill = hpTxt = mineEl = topEl = fightersEl = timeEl = monster = null; const L = d.live;
      const powers = h('div.bs-powers', d.powers.map((p) => h('button.btn.bs-pw', { disabled: !L || S.me.coins < p.price, onClick: (e) => busy(e.currentTarget, async () => { try { const r = await api.post('/api/boss/power', { id: p.id }); mine += r.dealt; if (mineEl) mineEl.textContent = fmt.num(mine); floater('-' + fmt.compact(r.dealt), true); snd('win'); } catch (er) { toastErr(er); } }) },
        h('span.bs-pi', p.icon), h('b', pick2(p.n)), h('span.tiny', '−' + fmt.compact(p.dmg) + ' HP'), h('span.coin.tiny', fmt.coins(p.price)))));
      if (L) {
        monster = h('div.bs-mon', { style: { '--bc': L.boss.color } }, h('span.bs-aura'), h('span.bs-aura.b'), h('span.bs-emoji', L.boss.icon));
        arena = h('div.bs-arena', { style: { '--bc': L.boss.color }, onPointerdown: (e) => { e.preventDefault(); hit(e); } }, h('div.bs-stars'), monster, h('div.bs-tapc', t('Tap the boss to attack!')));
        hpFill = h('i'); hpTxt = h('span.bs-hpt'); mineEl = h('b', fmt.num(mine)); topEl = h('div.bs-top'); fightersEl = h('span'); timeEl = h('b.mono', clock(L.end - Date.now()));
        mount(inner,
          h('div.bs-head', h('div.grow', h('div.tiny.muted', '⚠️ ' + t('World Boss')), h('h2', L.boss.icon + ' ' + pick2(L.boss.n))), h('div.bs-kpi', h('span.tiny.muted', t('Time left')), timeEl), h('div.bs-kpi', h('span.tiny.muted', t('Your damage')), mineEl)),
          h('div.bs-hp', hpFill, hpTxt), h('div.tiny.muted.row', { style: 'justify-content:space-between' }, fightersEl, h('span', t('Every new fighter makes it stronger — and the reward bigger.'))),
          h('div.bs-layout', h('div.grow', arena, powers), h('div.card.bs-side', h('h3', t('Top damage')), topEl, h('p.tiny.muted', t('If it falls, the reward pool is shared by damage. Top 3 get gems and the last hit gets a bonus.')))));
        paintHp(L);
      } else {
        const nb = d.nextBoss; timeEl = h('b.mono.bs-cd', clock(d.next - Date.now())); const last = d.last;
        mount(inner,
          h('div.page-title', h('div', h('h2', icon('zap', 24), ' ', t('World Boss')), h('p', t('Every 2 hours a giant monster appears for 20 minutes. Everyone online fights it together and shares the reward.')))),
          h('div.bs-wait', { style: { '--bc': nb.color } }, h('div.bs-emoji.sm', nb.icon), h('div.grow', h('div.tiny.muted', t('Next boss')), h('h3', { style: 'margin:2px 0' }, pick2(nb.n)), h('div', t('Appears in'), ' ', timeEl)),
            S.me.role === 'owner' ? h('button.btn', { onClick: (e) => busy(e.currentTarget, async () => { try { d = await api.post('/api/boss/summon'); mine = 0; paint(); } catch (er) { toastErr(er); } }) }, '🪄 ', t('Summon now')) : null),
          h('div.grid2', h('div.card', h('h3', t('Your record')), h('p', t('Bosses defeated: {n}', { n: d.kills })), h('p', t('Best damage in one fight: {n}', { n: fmt.num(d.best) }))),
            h('div.card', h('h3', t('Last fight')), last ? [h('p', last.boss.icon + ' ' + pick2(last.boss.n) + ' · ' + (last.won ? '✅ ' + t('Defeated') : '💨 ' + t('Escaped')) + ' · ' + t('{n} fighters', { n: last.fighters })),
              h('div.bs-top', last.top.map((x) => h('div.bs-row', h('span.bs-rk', ['🥇', '🥈', '🥉'][x.rank - 1] || '#' + x.rank), avatarEl(x.user, { size: 24 }), h('b.grow', x.user.displayName), h('span.mono', fmt.compact(x.dmg)), h('span.coin.tiny', '+' + fmt.coins(x.coins))))),
              last.lastHit ? h('p.tiny.muted', t('Last hit: {u}', { u: last.lastHit.displayName })) : null] : h('p.small.muted', t('No fights yet.')))),
          h('h3', t('Power attacks')), h('p.small.muted', t('Spend coins for huge hits while a boss is here.')), powers);
      }
    }
    offs.push(
      bus.on('ws:boss', (m) => {
        if (m.ev === 'hp') { if (!d.live) { load().catch(() => {}); return; } d.live.hp = m.hp; d.live.max = m.max; d.live.fighters = m.fighters; paintHp(m); }
        else if (m.ev === 'spawn') { mine = 0; load().catch(() => {}); }
        else if (m.ev === 'power' && m.by !== S.me.username) floater(m.icon + ' −' + fmt.compact(m.dmg), true);
        else if (m.ev === 'down' || m.ev === 'gone') { if (m.ev === 'down') { snd('win'); confetti(innerWidth / 2, innerHeight / 3, 140); } d.live = null; load().catch(() => {}); }
      }),
      bus.on('ws:boss_dmg', (m) => { mine += m.dmg; if (mineEl) mineEl.textContent = fmt.num(mine); if (m.dmg) floater('−' + fmt.num(m.dmg), m.crits > 0); }),
    );
    flushT = setInterval(flush, 300);
    tickT = setInterval(() => { if (!timeEl) return; const end = d.live ? d.live.end : d.next; const ms = end - Date.now(); timeEl.textContent = clock(ms); if (ms <= 0 && !d.live) load().catch(() => {}); }, 1000);
    return () => { flush(); clearInterval(flushT); clearInterval(tickT); offs.forEach((f) => f()); };
  },
};
