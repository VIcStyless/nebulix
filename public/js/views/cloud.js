// Nebulix 13.4 — Cloud gaming: big PC and console games streamed from powerful servers, plus games that run right here.
// Streaming services need their own account and open in a new tab (they stream video over WebRTC, which only works
// directly with them). Everything under "Play now in Nebulix" runs inside Nebulix. #/cloud
import { h, mount } from '../util.js';
import { t, pick2 } from '../i18n.js';
import { icon } from '../icons.js';

const SERVICES = [
  { n: 'Xbox Cloud Gaming', url: 'https://www.xbox.com/play', c: ['#107c10', '#0b3d0b'], d: ['Hundreds of console games in the browser. Needs a Game Pass Ultimate subscription.', 'Cientos de juegos de consola en el navegador. Necesita una suscripción a Game Pass Ultimate.'], free: false },
  { n: 'GeForce NOW', url: 'https://play.geforcenow.com', c: ['#76b900', '#1a2a00'], d: ['Play the PC games you own on Steam, Epic and more. Has a free tier with waiting lines and time limits.', 'Juega a los juegos de PC que tienes en Steam, Epic y más. Tiene un plan gratis con colas y límite de tiempo.'], free: true },
  { n: 'Boosteroid', url: 'https://cloud.boosteroid.com', c: ['#5b2be0', '#1d0d4f'], d: ['Cloud PC gaming with your own game libraries. Paid subscription.', 'Juego en la nube con tus propias bibliotecas de juegos. Suscripción de pago.'], free: false },
  { n: 'Amazon Luna', url: 'https://luna.amazon.com', c: ['#7b3ff2', '#22104a'], d: ['Game channels with Prime and a subscription, where available.', 'Canales de juegos con Prime y suscripción, donde está disponible.'], free: false },
];
const HERE = [
  ['arena', 'Nebulix Arena', 'target', ['Online battle royale, 5 vs 5 and duels.', 'Battle royale online, 5 contra 5 y duelos.']],
  ['retro', 'Retro consoles', 'gamepad', ['NES, SNES, GBA, N64, PlayStation and more.', 'NES, SNES, GBA, N64, PlayStation y más.']],
  ['vm', 'Virtual machines', 'cpu', ['Old PC games on DOS, Windows 98 and Linux.', 'Juegos antiguos de PC en DOS, Windows 98 y Linux.']],
  ['worlds', 'Nebula Worlds', 'cube', ['3D worlds and obbies made by players.', 'Mundos 3D y obbies hechos por jugadores.']],
  ['vault', 'Nebula Vault', 'bag', ['Community games you can buy or play free.', 'Juegos de la comunidad gratis o de pago.']],
  ['games', 'Nebulix Games', 'puzzle', ['Every game in Nebulix in one place.', 'Todos los juegos de Nebulix en un solo sitio.']],
];
export default {
  title: () => t('Cloud gaming'),
  mount(root, ctx) {
    mount(root, h('div.inner.cg',
      h('div.page-title', h('div', h('h2', t('Cloud gaming')), h('p', t('Big games streamed from powerful servers to any device — even a school laptop or a phone. You only need a good connection.')))),
      h('h3', t('Streaming services')),
      h('div.cg-grid', SERVICES.map((s) => h('a.cg-card', { href: s.url, target: '_blank', rel: 'noopener noreferrer', style: { '--a': s.c[0], '--b': s.c[1] } }, h('div.cg-top', icon('monitor', 28), s.free ? h('span.pill', t('Free tier')) : null), h('b', s.n), h('p.small', pick2(s.d)), h('span.cg-open', t('Open'), ' ', icon('external', 13))))),
      h('p.tiny.muted', t('These services are run by other companies and need their own account. They open in a new tab because they stream video directly to your browser. For the best result: wired connection or 5 GHz Wi-Fi, 15+ Mbps, and a gamepad.')),
      h('h3', t('Play now in Nebulix')),
      h('div.cg-grid', HERE.map(([route, n, ic, d]) => h('button.cg-card.here', { onClick: () => ctx.go(route) }, h('div.cg-top', icon(ic, 28)), h('b', t(n)), h('p.small', pick2(d)), h('span.cg-open', t('Play'), ' ', icon('play', 13)))))));
    return () => {};
  },
};
