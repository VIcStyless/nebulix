// Quick-launch sites for Home and the browser start page. They open through the proxy; compatibility varies.
// Each entry: [monogram fallback, display name, url]. Real logos load via /api/favicon (fetched by the server).
import { h } from './util.js';

export const GAMES = [
  ['Po', 'Poki', 'https://poki.com/'], ['CG', 'CrazyGames', 'https://www.crazygames.com/'], ['Cm', 'Coolmath Games', 'https://www.coolmathgames.com/'],
  ['io', 'itch.io', 'https://itch.io/games/html5'], ['Y8', 'Y8', 'https://www.y8.com/'], ['Mc', 'Miniclip', 'https://www.miniclip.com/games/en/'],
  ['Ad', 'Addicting Games', 'https://www.addictinggames.com/'], ['Ar', 'Armor Games', 'https://armorgames.com/'], ['Kr', 'Krunker', 'https://krunker.io/'],
  ['Ss', 'Shell Shockers', 'https://shellshock.io/'], ['Sl', 'Slither.io', 'https://slither.io/'], ['Pa', 'Paper.io', 'https://paper-io.com/'],
  ['Ag', 'Agar.io', 'https://agar.io/'], ['Di', 'Diep.io', 'https://diep.io/'], ['Sk', 'Skribbl', 'https://skribbl.io/'], ['Ga', 'Gartic.io', 'https://gartic.io/'],
  ['Li', 'Lichess', 'https://lichess.org/'], ['Ch', 'Chess.com', 'https://www.chess.com/'], ['Tt', 'TETR.IO', 'https://tetr.io/'], ['Ge', 'GeoGuessr', 'https://www.geoguessr.com/'],
  ['Tw', 'Twitch', 'https://www.twitch.tv/'], ['YT', 'YouTube', 'https://www.youtube.com/'], ['Rd', 'Reddit', 'https://www.reddit.com/'], ['Sp', 'Spotify', 'https://open.spotify.com/'],
];

const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };

// A square logo tile: the site's real favicon, falling back to a coloured monogram if it can't load.
export function siteLogo(url, name, mono, size = 34) {
  const host = hostOf(url);
  const el = h('span.site-logo', { style: `--s:${size}px`, 'data-mono': (mono || name || '?').slice(0, 2) });
  if (host) {
    const img = h('img', { src: '/api/favicon?host=' + encodeURIComponent(host), alt: '', loading: 'lazy', width: size, height: size, onError: () => { el.classList.add('no-logo'); img.remove(); } });
    img.addEventListener('load', () => { if (img.naturalWidth > 1) el.classList.add('has-logo'); else { el.classList.add('no-logo'); img.remove(); } });
    el.appendChild(img);
  } else el.classList.add('no-logo');
  return el;
}

export const ENGINES = {
  nebulix: ['Nebulix Search', 'https://search.nebulix/?q=%s'],
  ddg: ['DuckDuckGo', 'https://duckduckgo.com/?q=%s'], brave: ['Brave Search', 'https://search.brave.com/search?q=%s'],
  bing: ['Bing', 'https://www.bing.com/search?q=%s'], google: ['Google', 'https://www.google.com/search?q=%s'],
};
