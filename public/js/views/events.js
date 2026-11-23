// Events: community tournaments, game nights and watch parties with RSVPs, live countdowns and calendar export.
import { h, mount } from '../util.js';
import { t, locale } from '../i18n.js';
import { api } from '../api.js';
import { bus } from '../state.js';
import { icon } from '../icons.js';
import { avatarEl } from '../cosmetics.js';
import { toast, toastErr, modal, field, emptyState, loading, confirmBox } from '../ui.js';
import { sendToFriend } from '../share.js';

const pad = (n) => String(n).padStart(2, '0');
function until(ms) {
  if (ms <= 0) return null; const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), hh = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return d > 0 ? `${d}d ${pad(hh)}h ${pad(m)}m` : `${pad(hh)}:${pad(m)}:${pad(ss)}`;
}
function ics(e) {
  const f = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (s) => String(s || '').replace(/[\\;,]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
  const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Nebulix//Events//EN', 'BEGIN:VEVENT', `UID:${e.id}@nebulix`, `DTSTAMP:${f(Date.now())}`, `DTSTART:${f(e.at)}`, `DTEND:${f(e.at + e.dur * 60000)}`, `SUMMARY:${esc(e.title)}`, `DESCRIPTION:${esc(e.desc + (e.link ? '\n' + e.link : ''))}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const a = h('a', { href: URL.createObjectURL(new Blob([body], { type: 'text/calendar' })), download: e.title.replace(/[^\w-]+/g, '_').slice(0, 40) + '.ics' }); document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

export default {
  title: () => t('Events'),
  async mount(root, ctx) {
    let list = []; let tab = 'all';
    const box = h('div.ev-list', loading());
    const tabs = h('div.filters', [['all', t('Upcoming')], ['going', t('Going')], ['mine', t('Hosting')]].map(([k, l]) => h('button.chip', { dataset: { k }, onClick: () => { tab = k; paint(); } }, l)));
    mount(root, h('div.inner.narrow',
      h('div.page-title', h('div', h('h2', t('Events')), h('p', t('Tournaments, game nights and watch parties. RSVP and get a reminder.'))), h('button.btn.primary', { onClick: create }, icon('plus', 16), t('New event'))),
      h('div.toolbar', tabs), box));

    async function load() { try { list = (await api.get('/api/events')).events; } catch (e) { toastErr(e); } paint(); }
    function paint() {
      [...tabs.children].forEach((b) => b.classList.toggle('on', b.dataset.k === tab));
      const rows = list.filter((e) => tab === 'all' || (tab === 'going' && e.me) || (tab === 'mine' && e.mine));
      if (!rows.length) return mount(box, emptyState('calendar', tab === 'all' ? t('Nothing scheduled yet') : t('No events here'), t('Host a tournament or a chill game night. People can RSVP and add it to their calendar.'), h('button.btn.primary', { onClick: create }, t('New event'))));
      mount(box, rows.map(row));
    }
    function row(e) {
      const d = new Date(e.at); const live = Date.now() >= e.at && Date.now() < e.at + e.dur * 60000;
      const cd = h('span.countdown', { dataset: { at: e.at } });
      return h('article.card.ev' + (e.me ? '.going' : ''),
        h('div.ev-date', h('span', d.toLocaleDateString(locale(), { month: 'short' })), h('b', String(d.getDate())), h('span', d.toLocaleDateString(locale(), { weekday: 'short' }))),
        h('div', { style: 'min-width:0' },
          h('div.row', { style: 'gap:6px;margin-bottom:4px;flex-wrap:wrap' }, live ? h('span.tag.live', t('Live now')) : null, e.game ? h('span.tag', e.game) : null, e.full ? h('span.tag', t('Full')) : null),
          h('h3', e.title),
          h('div.meta', h('span', icon('clock', 13), d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) + ' · ' + t('{n} min', { n: e.dur })), h('span', icon('users', 13), e.cap ? t('{a} of {b} going', { a: e.going, b: e.cap }) : t('{n} going', { n: e.going })), live ? null : cd),
          e.desc ? h('p.small.muted', { style: 'margin:8px 0 0;white-space:pre-wrap' }, e.desc) : null,
          h('div.row', { style: 'margin-top:10px;gap:8px' }, h('div.avstack', e.attendees.slice(0, 8).map((u) => avatarEl(u, { size: 22 }))), h('span.tiny.muted', t('hosted by {n}', { n: e.by ? e.by.displayName || e.by.username : '?' })))),
        h('div.col', { style: 'gap:6px;align-items:stretch' },
          e.mine ? h('button.btn.sm.danger', { onClick: async () => { if (await confirmBox(t('Cancel this event? Everyone who RSVPd will be told.'), { danger: true, ok: t('Cancel event') })) { try { await api.del('/api/events/' + e.id); load(); } catch (er) { toastErr(er); } } } }, t('Cancel event'))
            : h('button.btn.sm' + (e.me ? '' : '.primary'), { disabled: !e.me && e.full, onClick: () => rsvp(e, !e.me) }, e.me ? icon('check', 14) : null, e.me ? t('Going') : t('RSVP')),
          h('button.btn.sm.ghost', { onClick: () => ics(e) }, icon('calendar', 14), t('Add to calendar')),
          h('button.btn.sm.ghost', { onClick: () => sendToFriend(t('Event in Nebulix: {e} — {d}', { e: e.title, d: d.toLocaleString(locale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) })) }, icon('send', 14), t('Invite a friend')),
          e.link ? h('a.btn.sm.ghost', { href: e.link, target: '_blank', rel: 'noopener noreferrer' }, icon('external', 14), t('Link')) : null));
    }
    async function rsvp(e, going) { try { await api.post(`/api/events/${e.id}/rsvp`, { going }); if (going) toast(t('You are going. We will remind you 10 minutes before.'), 'good'); load(); } catch (er) { toastErr(er); } }
    function create() {
      const title = h('input.input', { maxlength: 80, placeholder: t('Friday night 1v1 tournament') });
      const game = h('input.input', { maxlength: 40, placeholder: t('Game (optional)') });
      const soon = new Date(Date.now() + 3600000); soon.setMinutes(0, 0, 0);
      const local = new Date(soon.getTime() - soon.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      const when = h('input.input', { type: 'datetime-local', value: local });
      const dur = h('input.input', { type: 'number', min: 15, max: 720, step: 15, value: 60 });
      const cap = h('input.input', { type: 'number', min: 0, max: 500, value: 0 });
      const link = h('input.input', { maxlength: 200, placeholder: 'https://… (optional)' });
      const desc = h('textarea.input', { maxlength: 600, rows: 3, placeholder: t('Format, rules, prizes…') });
      modal({ title: t('New event'), body: h('div.col', field(t('Title'), title), field(t('Game'), game), h('div.grid.cols-2', field(t('Starts'), when), field(t('Duration (minutes)'), dur)), h('div.grid.cols-2', field(t('Spots (0 = unlimited)'), cap), field(t('Link'), link)), field(t('Description'), desc)),
        actions: [{ label: t('Cancel') }, { label: t('Create event'), kind: 'primary', onClick: async () => { try { await api.post('/api/events', { title: title.value, game: game.value, at: new Date(when.value).getTime(), dur: +dur.value, cap: +cap.value, link: link.value.trim(), desc: desc.value }); toast(t('Event created'), 'good'); load(); } catch (e) { toastErr(e); return false; } } }] });
    }
    const tick = setInterval(() => {
      for (const el of root.querySelectorAll('.countdown')) { const left = until(+el.dataset.at - Date.now()); el.textContent = left ? t('starts in {t}', { t: left }) : t('starting'); }    }, 1000);
    const off = bus.on('ws:events', () => load());
    await load();
    return () => { clearInterval(tick); off(); };
  },
};
