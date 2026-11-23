// Work: pick a profession, work shifts for a virtual salary, earn job XP, climb the career ladder and level up.
import { h, mount, fmt } from '../util.js';
import { t, getLang } from '../i18n.js';
import { api } from '../api.js';
import { S, patchMe } from '../state.js';
import { icon } from '../icons.js';
import { toast, toastErr, loading, emptyState, busy, confetti } from '../ui.js';
import { sfx } from '../sfx.js';

const L = (pair) => (Array.isArray(pair) ? (getLang() === 'es' ? pair[1] : pair[0]) : pair);
const bar = (pct, cls = '') => h('div.wk-bar' + cls, h('i', { style: { width: Math.max(0, Math.min(100, pct)) + '%' } }));

export default {
  title: () => t('Work'),
  async mount(root, ctx) {
    let st = null; let alive = true; let tick = 0; let lastResult = null;
    const inner = h('div.inner'); mount(root, inner); mount(inner, loading(t('Clocking in…')));
    try { st = await api.get('/api/work'); } catch (e) { mount(inner, emptyState('alert', t('Work is unavailable'), e.message)); return () => {}; }
    const cdEl = h('span');

    function paint() {
      const job = st.jobs.find((j) => j.id === st.job);
      const lvlPct = ((st.xp - st.cur) / Math.max(1, st.next - st.cur)) * 100;
      const ready = Date.now() >= st.readyAt;
      const head = h('div.page-title', h('div', h('h2', t('Work')), h('p', t('Pick a profession, work shifts and get promoted. Salaries are paid in virtual coins.'))),
        h('div.wk-lvl', h('div.tiny.muted', t('Work level')), h('b', String(st.level)), bar(lvlPct), h('span.tiny.muted', fmt.num(st.xp - st.cur) + ' / ' + fmt.num(st.next - st.cur) + ' XP')));
      let jobCard;
      if (!job) jobCard = h('div.card.wk-now', h('div.wk-emoji', '🧑‍💼'), h('div.grow', h('h3', t('You are unemployed')), h('p.muted', t('Pick a job below to start earning.'))));
      else {
        const rk = st.ranks[job.rank]; const nx = st.ranks[job.rank + 1];
        const pct = nx ? ((job.xp - rk.xp) / (nx.xp - rk.xp)) * 100 : 100;
        jobCard = h('div.card.wk-now',
          h('div.wk-emoji', job.icon),
          h('div.grow', h('div.row', { style: 'gap:8px;flex-wrap:wrap' }, h('h3', { style: 'margin:0' }, L(job.n)), h('span.pill.wk-rank', L(rk.n))),
            h('div.small.muted', t('Salary per shift: {n} coins', { n: fmt.coins(job.salary) }) + (st.petBonus ? ' · ' + t('pet bonus +{p}%', { p: Math.round(st.petBonus * 100) }) : '')),
            nx ? h('div', { style: 'margin-top:8px' }, h('div.row.tiny.muted', h('span.grow', t('Next promotion: {r}', { r: L(nx.n) })), h('span', fmt.num(job.xp) + ' / ' + fmt.num(nx.xp) + ' XP')), bar(pct, '.gold')) : h('div.small', { style: 'margin-top:8px' }, '🏆 ' + t('Top of the ladder!'))),
          h('div.wk-go', h('button.btn.primary.wk-shift', { disabled: !ready, onClick: (e) => busy(e.currentTarget, shift) }, icon('clip', 18), ready ? t('Work a shift') : cdEl), h('div.tiny.muted', t('One shift every {m} minutes', { m: Math.round(st.cd / 60000) }))));
      }
      const res = lastResult ? h('div.card.wk-result' + (lastResult.event.k === 'slow' ? '.meh' : ''),
        h('div.wk-pay', '+', h('span.coin', fmt.coins(lastResult.pay))), h('div.grow', h('b', L(lastResult.event.text)), h('div.small.muted', t('+{j} job XP · +{w} work XP', { j: lastResult.jobXp, w: lastResult.workXp }))),
        lastResult.promo ? h('div.wk-promo', '🎉 ' + t('Promoted to {r}! +{n} coins', { r: L(lastResult.promo.n), n: fmt.coins(lastResult.promo.bonus) })) : null,
        lastResult.levelUp ? h('div.wk-promo', '⭐ ' + t('Work level {n}!', { n: lastResult.levelUp })) : null) : null;
      const jobs = h('div.wk-jobs', st.jobs.map((j) => h('div.wk-job' + (j.id === st.job ? '.on' : '') + (j.locked ? '.locked' : ''),
        h('div.wk-jicon', j.icon), h('b', L(j.n)), h('div.small.muted', t('{n} coins / shift', { n: fmt.coins(j.salary) })),
        h('div.tiny.muted', j.locked ? '🔒 ' + t('Work level {n}', { n: j.req }) : L(st.ranks[j.rank].n) + (j.xp ? ' · ' + fmt.num(j.xp) + ' XP' : '')),
        j.id === st.job ? h('span.pill', t('Current job')) : h('button.btn.sm', { disabled: j.locked, onClick: (e) => busy(e.currentTarget, () => apply(j.id)) }, j.locked ? t('Locked') : t('Apply')))));
      const ladder = h('div.card', h('h3', t('Career ladder')), h('div.wk-ladder', st.ranks.map((r, i) => h('div.wk-step' + (job && job.rank >= i ? '.done' : ''), h('b', L(r.n)), h('span.tiny.muted', fmt.num(r.xp) + ' XP · ×' + r.mult)))),
        h('p.tiny.muted', t('Each promotion pays a bonus and raises your salary. Higher work levels unlock better jobs and add +2% pay per level.')));
      const log = h('div.card', h('h3', t('Recent shifts')), st.log.length ? h('div.cs-hist', st.log.map((x) => { const j = st.jobs.find((q) => q.id === x.job); return h('div.cs-h', h('span.cs-h-ic', j ? j.icon : '💼'), h('div.grow', h('div', j ? L(j.n) : x.job), h('div.tiny.muted', fmt.rel(x.t) + (x.ev ? ' · ' + x.ev : '') + (x.promo ? ' · 🎉' : ''))), h('b.cs-h-net.pos', '+' + fmt.coins(x.pay))); })) : h('p.small.muted', t('No shifts yet.')),
        h('div.row.small.muted', { style: 'margin-top:10px' }, h('span.grow', t('Total shifts: {n}', { n: fmt.num(st.shifts) })), h('span', t('Total earned: {n}', { n: fmt.coins(st.earned) }))));
      mount(inner, head, jobCard, res, h('h3', { style: 'margin:22px 0 10px' }, t('Jobs')), jobs, h('div.grid.cols-2', { style: 'margin-top:16px' }, ladder, log));
      paintCd();
    }
    function paintCd() { const left = st.readyAt - Date.now(); if (left <= 0) { if (cdEl.textContent) { cdEl.textContent = ''; paint(); } return; } cdEl.textContent = t('Rest {t}', { t: fmt.dur(left / 1000) }); }
    async function shift() {
      try {
        const r = await api.post('/api/work/shift'); st = r.state; lastResult = r; patchMe({ coins: r.coins });
        sfx.win && sfx.win(); if (r.promo || r.levelUp) confetti(innerWidth / 2, innerHeight / 3, 50);
        toast(t('+{n} coins for your shift', { n: fmt.coins(r.pay + (r.promo ? r.promo.bonus : 0)) }), 'coin'); paint();
      } catch (e) { toastErr(e); }
    }
    async function apply(id) { try { st = await api.post('/api/work/apply', { job: id }); lastResult = null; toast(t('You got the job!'), 'good'); paint(); } catch (e) { toastErr(e); } }
    paint(); tick = setInterval(() => alive && paintCd(), 1000);
    return () => { alive = false; clearInterval(tick); };
  },
};
