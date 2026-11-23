// Keyboard shortcuts sheet (press "?" anywhere outside a text field).
import { h } from './util.js';
import { t } from './i18n.js';
import { modal } from './ui.js';

const k = (...keys) => h('span', keys.map((x) => h('kbd', x)));
export function shortcutsSheet() {
  const rows = [
    [t('Search and commands'), k('Ctrl', 'K')], [t('Show this sheet'), k('?')], [t('Collapse sidebar'), k('[')],
    [t('Go to Home'), k('G', 'H')], [t('Go to Browser'), k('G', 'B')], [t('Go to Community'), k('G', 'C')], [t('Go to Messages'), k('G', 'M')],
    [t('Go to Squads'), k('G', 'S')], [t('Go to Events'), k('G', 'E')], [t('Go to Game library'), k('G', 'L')], [t('Go to Notes'), k('G', 'N')],
    [t('Go to Pulse'), k('G', 'P')], [t('Go to Arcade'), k('G', 'A')], [t('Go to Nova AI'), k('G', 'I')], [t('Go to Settings'), k('G', ',')],
    [t('Save note'), k('Ctrl', 'S')], [t('Mute in voice'), k('Ctrl', 'Shift', 'M')], [t('Close dialogs and menus'), k('Esc')],
  ];
  modal({ title: t('Keyboard shortcuts'), cls: 'wide', body: h('div.keys', rows.map(([l, kk]) => h('div', h('span', l), kk))), actions: [{ label: t('Done'), kind: 'primary' }] });
}
