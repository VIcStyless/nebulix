// Compact "now playing" control for the top bar / OS taskbar. Follows the Pulse engine wherever you are.
import { h, mount } from '../util.js';
import { t } from '../i18n.js';
import { bus } from '../state.js';
import { icon } from '../icons.js';
import { eqIcon } from './viz.js';
import * as P from './engine.js';

export function miniPlayer(go, { compact = false } = {}) {
  const el = h('div.mini-pl' + (compact ? '.compact' : ''), { role: 'group', 'aria-label': 'Pulse' });
  let key = '';
  const paint = (s = P.snapshot()) => {
    const tr = s.track; const k = [tr ? tr.id : '', s.playing, s.buffering, s.now, !!s.spotify].join('|'); if (k === key) return; key = k;
    el.classList.toggle('hide', !tr); el.classList.toggle('playing', !!s.playing);
    if (!tr) return mount(el);
    const title = s.now || tr.title; const sub = s.now ? tr.title : (tr.artist || '');
    mount(el,
      h('button.mini-open', { title: t('Open Pulse'), onClick: () => go('music') }, s.playing ? eqIcon() : h('span.mini-dot', '♪'),
        compact ? null : h('span.mini-txt', h('span.mini-scroll', { dataset: { text: title } }, title + (sub ? ' · ' + sub : '')))),
      h('button.btn.ghost.icon.sm', { title: s.playing ? t('Pause') : t('Play'), disabled: !!s.spotify, onClick: () => P.toggle() }, s.buffering ? h('span.spinner', { style: 'width:14px;height:14px;border-width:2px' }) : icon(s.playing ? 'pause' : 'play', 15)),
      compact ? null : h('button.btn.ghost.icon.sm', { title: t('Next'), onClick: () => P.next() }, icon('fwd', 15)));
  };
  bus.on('pulse', paint); paint();
  return el;
}
