// "What's new" — shown once per version after an update, with shortcuts to try each feature.
import { h, ls } from './util.js';
import { t } from './i18n.js';
import { S } from './state.js';
import { icon } from './icons.js';
import { modal } from './ui.js';
import { startTour } from './tour.js';

const ITEMS = [
  ['image', 'Nebulix Photo and Nebulix Audio', 'A layered image editor for thumbnails and banners, and an audio editor with cut, fades, normalise and WAV export.', 'photo'],
  ['check', 'Productivity tools and Forms', 'Habits, journal, reading list, mind maps, an encrypted password vault, a document scanner and forms with shareable links.', 'ptools'],
  ['tag', 'Discover free games and deals', 'Free-to-play games and the best current deals from official stores, in one place.', 'discover'],
  ['monitor', 'Cloud PC is live', "Create Linux machines that run on Nebulix's own compute server and use them from your browser.", 'cloudpc'],
  ['terminal', 'Python in the Toolbox', 'Write and run real Python 3 in your browser, with input(), tracebacks and a Stop button.', 'devtools'],
  ['users', 'Sheets and Slides: edit together in real time', 'Edit spreadsheets and presentations with others at the same time; see who is where.', 'sheets'],
  ['terminal', 'Toolbox: QR codes, HTTP requests and SQL', 'Make QR codes, test APIs from the server with SSRF protection, and run SQLite in your browser.', 'devtools'],
  ['folder', 'PDF, ZIP archives and startup apps in Nebulix OS', 'Open PDFs in Files, browse and extract ZIP archives, compress folders, and choose apps that open when the desktop starts.', 'changelog'],
  ['monitor', 'Nebulix Cloud PC: Linux in the cloud', 'Full Linux virtual machines on Nebulix compute servers, with snapshots and live CPU and memory usage.', 'cloudpc'],
  ['phone', 'Nebulix Android: real Android devices', 'Create phones and tablets with real Android, install APKs, use them from your browser with touch and keyboard, and save snapshots.', 'android'],
  ['users', 'Docs: write together in real time', 'Edit a document with friends at the same time: you see their changes as they type, where their cursor is, and who is in the document.', 'docs'],
  ['chat', 'Docs: Word export and comments', 'Download your documents as Word (.docx) and comment on any sentence; replies and new comments arrive live.', 'docs'],
  ['calendar', 'Calendar & Tasks', 'Events that repeat, reminders as notifications, tasks with projects and subtasks — and your Study exams.', 'calendar'],
  ['grid', 'Chess, Checkers, Solitaire and more', 'New in the Arcade: Chess, Checkers, Solitaire, Minesweeper, Sudoku, Space Rocks, Gem Match and Reflex.', 'arcade'],
  ['download', 'Install apps', 'Install Hub games and apps into Nebulix OS; you are told when they get a new version.', 'hub'],
  ['terminal', 'Developer Toolbox', 'JSON, regex, encoders, UUIDs, timestamps, cron, colours, diff and more.', 'devtools'],
  ['desktop', 'Nebulix OS, reinvented', 'Glass windows, wobbly drag, magic lamp, 4 desktops with a 3D cube, widgets and a quick settings panel.', ''],
  ['agents', 'Desktop-only apps', 'Files, Text editor, Nova Agents, Command Center, Camera and Widgets — only in Nebulix OS.', ''],
  ['book', 'Official apps in the Hub', 'Pixel Forge, Beat Lab, Flow Board, Sketch Board, Markdown Writer and Palette Lab, plus a new Hub home.', 'hub'],
  ['spark', 'Nebulix 14: a brand-new look', 'Floating glass, a living aurora, glowing markers and springy motion. The old look is one click away in Appearance.', 'look'],
  ['palette', 'Total makeovers', '13 one-click looks that change the design, menu, colours and screen effect at once.', 'look'],
  ['star', '7 new designs', 'Dev, Cyberpunk, Kawaii, Retro desktop, Bento, Holographic and Sketchbook.', 'look'],
  ['sliders', 'A much bigger theme studio', 'Heading fonts, button and card styles, textures, hover effects, page transitions and a palette generator (even from a picture).', 'themes/studio'],
  ['image', 'Screen and cursor effects', 'Snow, sakura, leaves, shooting stars, hearts… plus sparks when you click and a glowing cursor trail.', 'look'],
  ['book', 'Nebulix Hub, redesigned', 'Every upload is now a repository: Play, Code with a file browser and README, Releases, Discussions and more.', 'hub'],
  ['target', 'Better 3D games', 'Damage numbers, shockwaves, camera shake, a smooth casino camera and a brand-new Market Rush.', 'arena'],
  ['book', 'Nebulix Study', 'Notes from students, flashcards with spaced repetition, an AI tutor, live class quizzes, grades and exams.', 'study'],
  ['users', 'Live class quizzes', 'Host a quiz from any deck: everyone joins with a 6-digit PIN and answers against the clock.', 'study/live'],
  ['bell', 'Push notifications', 'Messages, 1v1 challenges and gifts reach you even with Nebulix closed. Turn them on in Settings.', 'settings/privacy'],
  ['target', 'Arena: spectate and quick chat', 'Watch the remaining players after you are out, and send quick phrases with N.', 'arena'],
  ['shield', 'Streak shields', 'Protect your daily streak if you miss a day.', 'home'],
  ['dice', 'Baccarat, Video Poker and Hi-Lo', 'Three new card games in the casino.', 'casino'],
  ['gamepad', 'Retro consoles', 'NES, SNES, GBA, N64, PlayStation and more, with gamepad and save states.', 'retro'],
  ['window', 'Windows in virtual machines', 'Up to 2 GB of RAM, 32 GB disks and templates for Windows 98, 2000, XP and ReactOS.', 'vm'],
  ['lock', 'Nebulix VPN', 'One switch for maximum privacy while you browse inside Nebulix.', 'vpn'],
  ['link', 'More addresses + link generator', 'nebulix-play, nebulix-zone and nebulix-hq: the same Nebulix. Make short links that work on all of them.', 'links'],
  ['cpu', 'Virtual machine manager', 'Create machines, virtual disks and snapshots. New: Damn Small Linux, OpenBSD and Oberon.', 'vm'],
  ['terminal', 'A real terminal', 'Genuine Linux in your browser, plus virtual machines: FreeDOS, KolibriOS or your own ISO.', 'terminal'],
  ['shield', 'Security Lab', 'Password checks, website scans, phishing detector, ciphers, JWT, CVE search and CTF challenges.', 'security'],
  ['bot', 'Nova Agent', 'PRO: Nova works on your repositories, notes, Hub and more — you approve every change.', 'nova'],
  ['activity', 'More free AI models', 'GPT-OSS, Gemma, Codestral, Mistral and more, with automatic fallback and a model checker.', 'nova'],
  ['tag', 'Player Marketplace', 'Sell your cosmetics to other players; the market script suggests fair prices.', 'shop'],
  ['trophy', 'Competitive season', 'Ranked with our own ranks, 1 vs 1 duels with bets, smarter bots and a prettier Nebula Royale.', 'ranked'],
  ['bag', 'Shop & Locker', 'A Shop that changes every day, limited exclusives, a 3D Locker and prices that follow the live economy.', 'shop'],
  ['layers', 'Nebula Vault', 'The game store of Nebulix: sell your Hub games for coins and build your library.', 'vault'],
  ['target', 'Nebulix Arena', 'Online shooters: Nebula Royale with building and Nebula Ops 5 vs 5, with bots.', 'arena'],
  ['spark', 'Nova everywhere', 'Web search, images, voice, a floating Nova on every page and ✨ to rewrite any text.', 'nova'],
  ['spark', 'Nova AI 10', 'A ChatGPT-style Nova with real AI, Code mode for programming and a copilot in Nebulix Studio.', 'nova'],
  ['play', 'Nebulix TV 9.2', 'Hover previews, continue watching, chapters, a new player and thumbnails you choose.', 'tv'],
  ['star', 'Reviews and game clips', 'Rate Hub uploads with stars and record clips of the games you play.', 'hub'],
  ['chat', 'Community 9.1', 'Server bots with commands, levels and giveaways, AutoMod, tickets, and voice with camera and screen sharing.', 'chat'],
  ['cube', 'Nebula Worlds 9', 'Real 360° camera with mouse look, a new smooth hero, polished worlds, sprint, dash, crumbling platforms, spinning lasers and a ghost of your best run.', 'worlds'],
  ['dice', 'Wheel, Keno and Limbo', 'Three new casino games with animations, auto-bet, a free daily spin and no bet limit.', 'casino'],
  ['lock', 'Screen lock', 'Hide Nebulix behind a password: Ctrl+Shift+L, after some idle minutes or every time it opens.', 'settings/security'],
  ['star', 'Casino 3D light show', 'Sweeping spotlights, giant spinning coins and a gold coin shower every minute.', 'casino3d'],
  ['image', 'Animated background', 'Pick a video, GIF or animated page from Nebulix Hub, or upload your own. It plays behind the whole app.', 'hub'],
  ['type', 'Word of the day', 'Daily word game: guess the secret word, keep your streak and win coins.', 'word'],
  ['target', 'Challenges', 'Dare a player to beat your best Arcade score from their profile.', 'games'],
  ['grid', 'Nexus navigation', 'Five big categories, colour app icons, favourites and a panel you can pin.', 'look'],
  ['activity', 'Nebulix Live', 'Every big moment on Nebulix as it happens.', 'live'],
  ['user', 'Player card', 'Your league, clan, bosses, worlds and records on your profile.', 'profile'],
  ['palette', 'Nebulix 7 design', 'A brand-new look: floating glass panels, gradients and smooth motion.', 'look'],
  ['gamepad', 'Nebulix Games', 'Every game in one hub, with what is live right now.', 'games'],
  ['zap', 'Gravity Dash', 'New Arcade game: flip gravity and dodge the spikes.', 'arcade'],
  ['layers', 'Star Stack', 'New Arcade game: stack the floors as high as you can.', 'arcade'],
  ['cube', 'World Builder', 'Build your own 3D world, test it and publish it for everyone.', 'worlds'],
  ['shield', 'Clans', 'Clan bank, wall, levels and a weekly Clan War with prizes.', 'clans'],
  ['medal', 'Leagues', 'Weekly divisions from Bronze to Nebula: move up or down every Monday.', 'leagues'],
  ['zap', 'World Boss', 'Every 2 hours a giant monster appears: fight it with everyone online.', 'boss'],
  ['cube', 'Nebula Worlds', '3D parkour courses and hangouts with everyone online, plus gear to buy.', 'worlds'],
  ['trophy', 'Tournaments', 'Hourly, daily and weekly Arcade tournaments with automatic prizes.', 'tournaments'],
  ['flag', 'Nebulix Quiz', 'Live quizzes with a PIN, like in class: host on a big screen, everyone answers on their own device.', 'quiz'],
  ['star', 'Season pass', 'A free 40-tier reward track every month, plus 6 weekly challenges.', 'season'],
  ['heart', 'Life', 'A life simulator: needs, studies, homes you can rent out and vehicles.', 'life'],
  ['chart', 'Crypto', 'Invest in Bitcoin, Ethereum and more with real prices (virtual coins).', 'invest'],
  ['image', 'Nebulix Lens', 'Our photo network with filters and 24-hour stories.', 'lens'],
  ['chat', 'Nebulix Foros', 'Communities with votes and threaded replies.', 'forum'],
  ['layout', 'Appearance', 'New menu layouts and designs, with live previews.', 'look'],
  ['zap', 'Advantages', 'Boosts, permanent upgrades and a bank that pays interest — all with coins.', 'perks'],
  ['terminal', 'Nebulix Code', 'Branches, pull requests, issues, diffs and ZIP downloads.', 'code'],
  ['activity', 'Nebulix Echo', 'Our own network for short posts, with reposts, hashtags and trends.', 'echo'],
  ['zap', 'Clips', 'Vertical short videos: swipe, double-tap to like and comment.', 'clips'],
  ['play', 'Nebulix TV', 'Channels for long videos with subscriptions and comments.', 'tv'],
  ['search', 'Nebulix Search', 'Our own search engine: web, images, news, videos and Wikipedia. Google searches open here too.', 'browse'],
  ['terminal', 'Nebulix Code + Studio', 'Repositories with commits, stars and forks, and a pro code editor with live preview.', 'code'],
  ['layers', 'Drive, Docs, Sheets and Slides', 'Your files in the cloud, documents, spreadsheets with formulas and presentations.', 'drive'],
  ['upload', 'Nebulix Hub', 'Upload and share videos, browser games and web apps.', 'hub'],
  ['trophy', '3D horse racing', 'Bet on a horse and watch the race in 3D. Every casino game now has 3D animations.', 'casino'],
  ['palette', 'New designs', 'Glass, Brutalist, Retro terminal, Editorial and Neon change the whole look.', 'settings'],
  ['play', 'YouTube, Wikipedia, Hacker News and Twitch', 'Native clients inside the Nebulix browser.', 'browse'],
  ['box3d', '3D Casino and avatars', 'Walk the casino with your own 3D character.', 'casino3d'],
];

export function maybeShowWhatsNew(go) {
  const v = (S.cfg && S.cfg.version) || '3.0.0'; const major = v.split('.').slice(0, 2).join('.');
  if (ls('seenVersion') === major) return;
  ls('seenVersion', major);
  showWhatsNew(go, v);
}
export function showWhatsNew(go, v = (S.cfg && S.cfg.version) || '3.0.0') {
  let p;
  const list = h('div.wn-list', ITEMS.map(([ic, title, desc, route]) => h('div.wn-item', h('span.wn-ic', icon(ic, 17)), h('div.grow', h('b', t(title)), h('div.small.muted', t(desc))),
    route ? h('button.btn.sm', { onClick: () => { p.close(); go(route); } }, t('Try it')) : null)));
  p = modal({ title: t('What\'s new in Nebulix {v}', { v: v.split('.').slice(0, 2).join('.') }), cls: 'wn', body: h('div.col', h('p.small.muted', t('Press ? any time to see keyboard shortcuts, or Ctrl K to jump anywhere.')), list), actions: [{ label: t('Full changelog'), onClick: () => { go('changelog'); } }, { label: t('Take the tour'), onClick: () => { setTimeout(() => startTour('welcome', go), 150); } }, { label: t('Got it'), kind: 'primary' }] });
  // the dialog focuses its button, which scrolls a long dialog to the bottom; start at the top instead
  setTimeout(() => { const m = document.querySelector('.modal.wn'); if (m) m.scrollTop = 0; }, 50);
}
