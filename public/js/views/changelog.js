// What's New: an animated timeline of every Nebulix update, read from changelog-data.js.
import { h, mount } from '../util.js';
import { t, getLang, locale } from '../i18n.js';
import { icon, logoMark } from '../icons.js';
import { CHANGELOG } from '../changelog-data.js';

const TYPE = {
  new: { icon: 'plus', label: () => t('New') },
  improved: { icon: 'bolt', label: () => t('Improved') },
  fixed: { icon: 'check', label: () => t('Fixed') },
};
const pick = (o) => (o && typeof o === 'object' ? (getLang() === 'es' ? o.es || o.en : o.en || o.es) : o);
const fmtDate = (d) => { try { return new Date(d + 'T12:00:00').toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' }); } catch { return d; } };

export default {
  title: () => t('What’s new'),
  async mount(root, ctx) {
    const reduce = () => document.documentElement.dataset.reduce === '1';
    const latest = CHANGELOG[0];
    const hero = h('header.cl-hero',
      h('div.cl-badge', logoMark(26), h('span', 'v' + (latest ? latest.v : '3.0'))),
      h('h1.cl-title', t('What’s new')),
      h('p.cl-sub', t('Every update to Nebulix, newest first. We ship improvements all the time.')));

    const rel = (r, i) => {
      const changes = (r.changes || []).map((c) => {
        const ty = TYPE[c.type] || TYPE.new;
        return h('li.cl-change',
          h('span.cl-tag', { 'data-type': c.type }, icon(ty.icon, 12), ty.label()),
          h('span.cl-text', pick(c)));
      });
      return h('article.cl-rel', { style: `--i:${i}` },
        h('span.cl-dot'),
        h('div.cl-card',
          h('div.cl-rhead',
            h('span.cl-ver', 'v' + r.v),
            h('div.grow', h('h2.cl-name', pick(r.title)), h('time.cl-date', fmtDate(r.date)))),
          h('ul.cl-changes', changes)));
    };

    const timeline = h('div.cl-timeline', CHANGELOG.map(rel));
    mount(root, h('div.cl-wrap', hero, timeline,
      h('p.cl-foot.center.muted.tiny', t('Made by {c}', { c: 'VicStyles' }))));

    // Staggered reveal on scroll — the spectacular bit, gated by Reduce Motion.
    if (!reduce() && 'IntersectionObserver' in window) {
      const io = new IntersectionObserver((ents) => {
        for (const e of ents) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      }, { threshold: 0.18, rootMargin: '0px 0px -8% 0px' });
      root.querySelectorAll('.cl-rel').forEach((el) => io.observe(el));
      return () => io.disconnect();
    }
    root.querySelectorAll('.cl-rel').forEach((el) => el.classList.add('in'));
    return () => {};
  },
};
