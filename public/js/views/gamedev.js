// Nebulix 3.0 — "Create games": the guide for Hub creators (Game API, permissions, publishing) and a starter template
// that already uses every API (player name, leaderboard, an achievement and a multiplayer room). #/gamedev
import { h, mount } from '../util.js';
import { t, getLang } from '../i18n.js';
import { icon } from '../icons.js';
import { toast, toastErr } from '../ui.js';
import { renderMarkdown } from '../markdown.js';
import { zipFiles } from '../zipwrite.js';
import { api } from '../api.js';
import { gameApi } from '../gameapi.js';
// the template itself is the official Hub game "Starter game" (server/hubapps/starter.html): one copy, always the live one

const TEMPLATE_MANIFEST = JSON.stringify({ name: 'My Nebulix game', permissions: [] }, null, 2) + '\n';
const TEMPLATE_README = `# My Nebulix game

Edit \`index.html\`, then upload this whole folder (or the .zip) in Nebulix Hub → New → Upload a whole folder.

- \`window.Nebulix\` exists only when the game runs inside Nebulix — always check it.
- Ask for device permissions (camera, microphone, geolocation, midi) in \`nebulix.json\`.
- Scores and achievements never pay coins.
`;

const GUIDE = {
  en: `## 1. Make your game
Any HTML5 game works: a single \`.html\` file, a \`.zip\` or a whole folder with an \`index.html\`. Use canvas, WebGL, or any library you bundle with it.

## 2. Use the Game API
Inside Nebulix your pages get \`window.Nebulix\`. Every call returns a Promise.

\`\`\`js
const me = await Nebulix.me();                   // { username, displayName, lang }
await Nebulix.submitScore(1234);                 // leaderboard on your game's page
await Nebulix.unlock('first-win', 'First win', 'Win one match');
await Nebulix.room.join('lobby');                // multiplayer, up to 16 players
Nebulix.room.on('message', ({ from, data }) => {});
Nebulix.room.send({ x: 10, y: 4 });
\`\`\`

## 3. Ask for permissions (optional)
Add \`nebulix.json\` next to \`index.html\`:

\`\`\`json
{ "name": "My game", "permissions": ["camera", "microphone"] }
\`\`\`

Players see the request and the game only gets what they allow.

## 4. Publish
Nebulix Hub → **New** → upload the folder. You can publish new versions any time (Releases), and players who installed your game are told about them.

## Rules
Games run isolated from the player's account. Scores and achievements come from the browser, so they never pay coins. Do not upload games you do not have the rights to.`,
  es: `## 1. Haz tu juego
Sirve cualquier juego HTML5: un solo archivo \`.html\`, un \`.zip\` o una carpeta entera con un \`index.html\`. Usa canvas, WebGL o la librería que quieras incluir.

## 2. Usa la API de juegos
Dentro de Nebulix tus páginas tienen \`window.Nebulix\`. Todas las llamadas devuelven una Promise.

\`\`\`js
const me = await Nebulix.me();                   // { username, displayName, lang }
await Nebulix.submitScore(1234);                 // clasificación en la página de tu juego
await Nebulix.unlock('first-win', 'Primera victoria', 'Gana una partida');
await Nebulix.room.join('lobby');                // multijugador, hasta 16 jugadores
Nebulix.room.on('message', ({ from, data }) => {});
Nebulix.room.send({ x: 10, y: 4 });
\`\`\`

## 3. Pide permisos (opcional)
Añade \`nebulix.json\` junto a \`index.html\`:

\`\`\`json
{ "name": "Mi juego", "permissions": ["camera", "microphone"] }
\`\`\`

Los jugadores ven la petición y el juego solo recibe lo que permitan.

## 4. Publica
Nebulix Hub → **Nueva** → sube la carpeta. Puedes publicar versiones nuevas cuando quieras (Versiones) y a quien lo tenga instalado se le avisa.

## Normas
Los juegos funcionan aislados de la cuenta del jugador. Las puntuaciones y los logros vienen del navegador, así que nunca dan monedas. No subas juegos sobre los que no tengas derechos.`,
};

export default {
  title: () => t('Create games'),
  async mount(root) {
    const dl = async (e) => {
      const b = e.currentTarget; b.disabled = true;
      try { if (!starter) throw new Error(t('The template is not available right now')); const html = (await api.get(`/api/hub/${starter.id}/raw?path=index.html`)).text; const files = [['index.html', html, 'text/html'], ['nebulix.json', TEMPLATE_MANIFEST, 'application/json'], ['README.md', TEMPLATE_README, 'text/markdown']].map(([path, txt, type]) => ({ path: 'my-nebulix-game/' + path, file: new File([txt], path, { type }) }));
        const blob = await zipFiles(files); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'my-nebulix-game.zip'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); toast(t('Template downloaded'), 'good'); } catch (er) { toastErr(er); } finally { b.disabled = false; }
    };
    let starter = null; try { const off = (await api.get('/api/hub?tag=template', { quiet: true })).items.find((x) => x.official === 'starter'); if (off) starter = (await api.get('/api/hub/' + off.id, { quiet: true })).item; } catch { /* no template */ }
    const preview = starter && starter.src ? h('iframe.gd-prev', { title: t('Template preview'), src: starter.src }) : h('div.gd-prev.empty', h('p.muted', t('The template preview is not available right now.')));
    mount(root, h('div.inner.gd', h('div.page-title', h('div', h('h2', icon('gamepad', 22), ' ', t('Create games')), h('p', t('Publish your own games in Nebulix Hub with leaderboards, achievements and multiplayer.')))),
      h('div.gd-hero', h('div.gd-cta', h('h3', t('Start from the template')), h('p.small.muted', t('A small ready-made game that already uses the player name, a leaderboard, an achievement and a multiplayer room. Edit it and upload it.')),
        h('div.row', { style: 'gap:8px;flex-wrap:wrap' }, h('button.btn.primary', { onClick: dl }, icon('download', 15), t('Download template (.zip)')), h('a.btn', { href: starter ? '#/hub/' + starter.id + '/code' : '#/hub' }, icon('terminal', 15), t('See its code')), h('a.btn', { href: '#/hub' }, icon('upload', 15), t('Go to Nebulix Hub')), h('a.btn.ghost', { href: '#/code' }, icon('terminal', 15), 'Nebulix Code'))), preview),
      h('article.card.gd-md.md', renderMarkdown(GUIDE[getLang() === 'es' ? 'es' : 'en']))));
    const off = preview.tagName === 'IFRAME' ? gameApi(preview, starter.id) : () => {};
    return () => off();
  },
};
