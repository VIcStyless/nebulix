// Life ("Vida"): a life simulator — needs, daily actions, education, homes (live in one, rent out the rest) and vehicles. #/life
import { h, mount, fmt } from '../util.js';
import { t, pick2 } from '../i18n.js';
import { api } from '../api.js';
import { S, patchMe } from '../state.js';
import { icon } from '../icons.js';
import { toast, toastErr, loading, emptyState, busy, tabsEl, confirmBox } from '../ui.js';
import { avatarEl } from '../cosmetics.js';

const L = pick2;
const NEEDS = [['energy', '⚡', 'Energy'], ['food', '🍔', 'Food'], ['health', '❤️', 'Health'], ['happy', '😊', 'Happiness']];
const left = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); const hh = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); return hh ? `${hh}h ${m}m` : m ? `${m}m` : `${s}s`; };

export default {
  title: () => t('Life'),
  async mount(root) {
    const inner = h('div.inner.lf'); mount(root, inner, loading());
    let d = null; let tab = 'day'; let timer = 0; let top = null;
    const set = (v) => { d = v; if (v.coins !== undefined) patchMe({ coins: v.coins }); paint(); };
    try { set(await api.get('/api/life')); } catch (e) { mount(inner, emptyState('alert', t('Could not load this'), e.message)); return () => {}; }
    async function run(btn, url, body, msg) { await busy(btn, async () => { try { const r = await api.post(url, body); set(r); if (msg) toast(typeof msg === 'function' ? msg(r) : msg, 'good'); } catch (e) { toastErr(e); } }); }
    function needBar([k, e, label]) { const v = d.needs[k]; return h('div.lf-need' + (v < 20 ? '.bad' : v < 45 ? '.warn' : ''), h('div.lf-need-top', h('span', e + ' ' + t(label)), h('b', v + '%')), h('div.lf-bar', h('i', { style: { width: v + '%' } }))); }
    function mood() { const n = d.needs; const avg = (n.energy + n.food + n.health + n.happy) / 4; return avg > 80 ? ['😄', t('Living the dream')] : avg > 60 ? ['🙂', t('Doing fine')] : avg > 40 ? ['😐', t('Could be better')] : avg > 20 ? ['😟', t('Struggling')] : ['😵', t('Exhausted')]; }
    function paint() {
      const home = d.HOMES.find((x) => x.id === d.home) || d.HOMES[0]; const car = d.car ? d.CARS.find((x) => x.id === d.car) : null; const [face, moodTxt] = mood();
      const hero = h('section.lf-hero',
        h('div.lf-me', avatarEl(S.me, { size: 64 }), h('div.lf-face', face), h('div', h('h2', S.me.displayName || S.me.username), h('div.muted.small', moodTxt), h('div.lf-tags', h('span.pill', home.icon + ' ' + L(home.n)), car ? h('span.pill', car.icon + ' ' + L(car.n)) : null, h('span.pill', '🎓 ' + d.edu.length + '/' + d.EDU.length)))),
        h('div.lf-score', h('span.tiny.muted', t('Life score')), h('b', fmt.num(d.score)), h('span.tiny.muted', t('Work pay ×{m}', { m: d.workMult.toFixed(2) }))),
        h('div.lf-needs', NEEDS.map(needBar)));
      const tabs = tabsEl([['day', t('Daily life'), 'sun'], ['study', t('Education'), 'book'], ['homes', t('Homes'), 'home'], ['cars', t('Garage'), 'zap'], ['top', t('Ranking'), 'trophy']], tab, (v) => { tab = v; paint(); });
      const body = h('div.lf-body');
      mount(inner, h('div.page-title', h('div', h('h2', icon('home', 22), ' ', t('Life')), h('p', t('Look after your character: eat, sleep, study, buy a home and a car. A good life raises your salary at Work.')))), hero, tabs, body);
      ({ day, study, homes, cars, topTab })[tab === 'top' ? 'topTab' : tab](body);
    }
    function fxText(fx) { return Object.entries(fx).map(([k, v]) => (v > 0 ? '+' : '') + v + ' ' + (NEEDS.find((n) => n[0] === k) || ['', ''])[1]).join('  '); }
    function day(el) {
      const now = Date.now();
      mount(el, h('div.lf-acts', d.acts.map((a) => { const wait = a.readyAt - now; const can = wait <= 0 && S.me.coins >= a.price;
        const b = h('button.lf-act' + (wait > 0 ? '.cd' : ''), { type: 'button', disabled: !can, onClick: () => run(b, '/api/life/act', { id: a.id }, a.icon + ' ' + L(a.n)) },
          h('span.lf-act-ic', a.icon), h('b', L(a.n)), h('span.tiny.muted', fxText(a.fx)), h('span.lf-act-p', wait > 0 ? h('span.lf-cd', { 'data-until': a.readyAt }, '⏳ ' + left(wait)) : a.price ? h('span.coin', fmt.coins(a.price)) : t('Free')));
        return b; })),
      h('div.grid2.lf-low', h('div.card', h('h3', icon('activity', 17), ' ', t('Skills')), Object.keys(d.SKILLS).map((k) => h('div.lf-need', h('div.lf-need-top', h('span', L(d.SKILLS[k])), h('b', (d.skills[k] || 0) + '/100')), h('div.lf-bar.sk', h('i', { style: { width: (d.skills[k] || 0) + '%' } })))),
          h('p.tiny.muted', t('Fitness keeps you healthy, Knowledge makes studying faster, Charisma and Cooking make daily life better.'))),
        h('div.card', h('h3', icon('clock', 17), ' ', t('Diary')), d.log.length ? h('div.lf-log', d.log.map((x) => h('div', h('span', x.icon), h('span.grow', L(x.m)), h('span.tiny.muted', fmt.rel(x.t))))) : h('p.muted.small', t('Nothing yet. Start your day!')))));
    }
    function study(el) {
      const now = Date.now(); const c = d.course; const cur = c ? d.EDU.find((e) => e.id === c.id) : null;
      mount(el, cur ? h('div.card.lf-course', h('div.row', h('span.lf-big', cur.icon), h('div.grow', h('b', t('Studying: {n}', { n: L(cur.n) })), h('div.lf-bar.sk', h('i', { style: { width: Math.min(100, ((now - c.start) / (c.until - c.start)) * 100) + '%' } })), h('div.tiny.muted', h('span.lf-cd', { 'data-until': c.until }, left(c.until - now)), ' ' + t('left'))))) : null,
        h('div.lf-list', d.EDU.map((e, i) => { const done = d.edu.includes(e.id); const locked = i > 0 && !d.edu.includes(d.EDU[i - 1].id);
          return h('div.card.lf-item' + (done ? '.done' : ''), h('span.lf-big', e.icon), h('div.grow', h('b', L(e.n)), h('div.small.muted', t('{h} h of study · +{p}% on every salary', { h: e.hours, p: Math.round(e.pay * 100) }))),
            done ? h('span.pill', icon('check', 12), t('Done')) : locked ? h('span.pill.muted', icon('lock', 12), t('Locked')) : h('button.btn' + (c ? '' : '.primary'), { disabled: !!c || S.me.coins < e.price, onClick: (ev) => run(ev.currentTarget, '/api/life/study', { id: e.id }, t('Classes started!')) }, t('Enrol'), e.price ? [' · ', h('span.coin', fmt.coins(e.price))] : ' · ' + t('Free'))); })),
        h('p.tiny.muted', t('Education bonus right now: +{p}% pay.', { p: Math.round(d.eduPay * 100) })));
    }
    function homes(el) {
      mount(el, h('div.card.lf-rent', h('div.grow', h('b', t('Rental income')), h('div.small.muted', t('Rent out homes you do not live in. They pay {r}% of their price every day.', { r: (d.rentRate * 100).toFixed(1) })), h('div.small', t('{n} coins a day', { n: fmt.coins(d.rentPerDay) }))),
          h('button.btn.primary', { disabled: d.rentDue < 1, onClick: (e) => run(e.currentTarget, '/api/life/rent/collect', {}, (r) => t('Collected {n} coins', { n: fmt.coins(r.collected) })) }, t('Collect'), ' · ', h('span.coin', fmt.coins(d.rentDue)))),
        h('div.lf-shop', d.HOMES.map((x) => { const own = d.homes.includes(x.id); const live = d.home === x.id; const rented = d.rented.includes(x.id);
          return h('div.card.lf-prop' + (live ? '.live' : ''), h('div.lf-prop-art', x.icon), h('b', L(x.n)), h('div.tiny.muted', t('Comfort {c}', { c: x.comfort }) + (x.price ? ' · ' + t('rent {n}/day', { n: fmt.coins(Math.floor(x.price * d.rentRate)) }) : '')),
            !own ? h('button.btn.sm.primary', { disabled: S.me.coins < x.price, onClick: async (e) => { const btn = e.currentTarget; if (x.price >= 1e6 && !(await confirmBox(t('Buy {n} for {c} coins?', { n: L(x.n), c: fmt.num(x.price) })))) return; run(btn, '/api/life/home/buy', { id: x.id }, x.icon + ' ' + t('It is yours!')); } }, t('Buy'), ' · ', h('span.coin', fmt.coins(x.price)))
              : h('div.row', { style: 'gap:6px;flex-wrap:wrap;justify-content:center' }, live ? h('span.pill', '🏠 ' + t('You live here')) : h('button.btn.sm', { onClick: (e) => run(e.currentTarget, '/api/life/home/move', { id: x.id }, t('Moved in!')) }, t('Move in')),
                !live && x.price ? h('button.btn.sm' + (rented ? '.primary' : ''), { onClick: (e) => run(e.currentTarget, '/api/life/home/rent', { id: x.id }) }, rented ? '✓ ' + t('Rented out') : t('Rent out')) : null)); })));
    }
    function cars(el) {
      mount(el, h('p.small.muted', t('A vehicle gets you to work faster: it adds to every salary. Your best vehicle is used automatically.')),
        h('div.lf-shop', d.CARS.map((x) => { const own = d.cars.includes(x.id); const using = d.car === x.id;
          return h('div.card.lf-prop' + (using ? '.live' : ''), h('div.lf-prop-art', x.icon), h('b', L(x.n)), h('div.tiny.muted', t('+{p}% work pay', { p: Math.round(x.pay * 100) })),
            own ? (using ? h('span.pill', '🔑 ' + t('Driving')) : h('button.btn.sm', { onClick: (e) => run(e.currentTarget, '/api/life/car', { id: x.id }) }, t('Use')))
              : h('button.btn.sm.primary', { disabled: S.me.coins < x.price, onClick: (e) => run(e.currentTarget, '/api/life/car', { id: x.id }, x.icon + ' ' + t('New vehicle!')) }, t('Buy'), ' · ', h('span.coin', fmt.coins(x.price)))); })));
    }
    async function topTab(el) {
      mount(el, loading());
      try { top = top || (await api.get('/api/life/top')); } catch (e) { mount(el, emptyState('alert', t('Could not load this'), e.message)); return; }
      mount(el, h('div.card', h('h3', icon('trophy', 17), ' ', t('Best lives')), h('div.lf-top', top.top.map((r, i) => { const hm = d.HOMES.find((x) => x.id === r.home);
        return h('a.lf-top-r', { href: '#/profile/' + r.username }, h('span.lf-rank', String(i + 1)), h('b.grow', r.displayName), h('span.muted.small', '@' + r.username), hm ? h('span', hm.icon) : null, h('b', fmt.num(r.score))); }))));
    }
    timer = setInterval(() => { const now = Date.now(); let refresh = false; for (const s of inner.querySelectorAll('.lf-cd')) { const u = +s.dataset.until; if (u - now <= 0) refresh = true; else s.textContent = (s.closest('.lf-act') ? '⏳ ' : '') + left(u - now); } if (refresh) api.get('/api/life', { quiet: true }).then(set).catch(() => {}); }, 1000);
    const slow = setInterval(() => { if (document.hidden) return; api.get('/api/life', { quiet: true }).then(set).catch(() => {}); }, 120000);
    return () => { clearInterval(timer); clearInterval(slow); };
  },
};
