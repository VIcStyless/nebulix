// App identity: every app gets its own colour pair and a one-line description, used by the Nexus navigation,
// the app launcher and Home. Colours are fixed per app (not per theme) so each app is recognisable at a glance.
import { h } from './util.js';
import { icon } from './icons.js';

export const APP_META = {
  home: ['#6366f1', '#8b5cf6', 'Your command centre'], live: ['#ef4444', '#f97316', 'Everything happening now'], season: ['#f59e0b', '#ef4444', 'Free monthly reward track'], browse: ['#0ea5e9', '#2563eb', 'Private, unblocked browsing'],
  echo: ['#3b82f6', '#06b6d4', 'Posts and trends'], clips: ['#ec4899', '#f43f5e', 'Short vertical videos'], tv: ['#dc2626', '#7c3aed', 'Videos and channels'], lens: ['#f472b6', '#a855f7', 'Photos, filters and stories'],
  forum: ['#f97316', '#eab308', 'Communities and threads'], chat: ['#8b5cf6', '#6366f1', 'Servers, channels and roles'], dm: ['#22c55e', '#14b8a6', 'Encrypted private messages'], clans: ['#9d174d', '#7c3aed', 'Clan bank and Clan War'],
  squads: ['#0d9488', '#22c55e', 'Find teammates now'], events: ['#2563eb', '#7c3aed', 'Game nights and RSVPs'],
  games: ['#7c3aed', '#ec4899', 'Every game in one hub'], arena: ['#4c1d95', '#0e7490', 'Battle royale, 5 vs 5 and duels'], ranked: ['#b91c1c', '#f59e0b', 'Ranked, seasons and duels'], vault: ['#1e3a8a', '#7c3aed', 'The game store of Nebulix'], shop: ['#be185d', '#7c3aed', 'Daily Shop and your Locker'], worlds: ['#0f766e', '#6d28d9', '3D worlds and the builder'], boss: ['#7f1d1d', '#9333ea', 'Everyone vs one monster'], tournaments: ['#b45309', '#eab308', 'Prizes every hour'],
  leagues: ['#0e7490', '#6366f1', 'Climb a division every week'], quiz: ['#7c3aed', '#ec4899', 'Live quizzes with a PIN'], word: ['#16a34a', '#ca8a04', 'A new secret word every day'], play: ['#334155', '#0ea5e9', 'Hundreds of web games'], music: ['#be185d', '#7c3aed', 'Music, radio and DJ'],
  arcade: ['#4f46e5', '#06b6d4', 'Quick games and duels'], library: ['#57534e', '#a16207', 'Your backlog and hours'], casino: ['#14532d', '#ca8a04', 'Play money only'], casino3d: ['#831843', '#1e1b4b', 'Walk the casino floor'],
  wallet: ['#ca8a04', '#f59e0b', 'Coins, gems and transfers'], life: ['#e11d48', '#f97316', 'Needs, homes and studies'], work: ['#0369a1', '#0ea5e9', 'Jobs and salaries'], invest: ['#15803d', '#22c55e', 'Stocks and crypto'],
  perks: ['#a21caf', '#6366f1', 'Boosts and upgrades'], market: ['#db2777', '#f59e0b', 'Profile cosmetics'], plaza: ['#ea580c', '#db2777', 'Shops, pets and booths'], avatar: ['#1d4ed8', '#9333ea', 'Your 3D look'],
  code: ['#1f2937', '#22c55e', 'Repos, branches and PRs'], studio: ['#1e3a8a', '#3b82f6', 'A full code editor'], hub: ['#0f172a', '#f97316', 'Share files and apps'], drive: ['#0284c7', '#22c55e', 'Your files in the cloud'],
  docs: ['#2563eb', '#60a5fa', 'Documents'], sheets: ['#15803d', '#4ade80', 'Spreadsheets'], slides: ['#c2410c', '#fb923c', 'Presentations'], notes: ['#a16207', '#facc15', 'Your scratchpad'],
  nova: ['#7c3aed', '#22d3ee', 'Ask the AI anything'], translate: ['#0891b2', '#6366f1', '19 languages'], look: ['#6d28d9', '#ec4899', 'Layouts and designs'], themes: ['#9333ea', '#f43f5e', 'Create and share themes'],
  nerd: ['#065f46', '#0ea5e9', 'Benchmarks and Linux'], changelog: ['#475569', '#8b5cf6', 'Every update'],
  ext: ['#475569', '#0ea5e9', 'Add-ons'], pro: ['#b45309', '#fbbf24', 'Nebulix PRO'], admin: ['#7f1d1d', '#1f2937', 'Staff tools'], settings: ['#334155', '#64748b', 'Account and privacy'], progress: ['#ca8a04', '#a855f7', 'Levels and achievements'],
};
export const metaOf = (id) => APP_META[id] || ['#6366f1', '#8b5cf6', ''];
// a rounded gradient tile with the app's icon
export const appTile = (id, ic, size = 34) => { const [a, b] = metaOf(id); return h('span.apx-tile', { style: { background: `linear-gradient(135deg, ${a}, ${b})`, width: size + 'px', height: size + 'px', borderRadius: Math.round(size * 0.3) + 'px' } }, icon(ic, Math.round(size * 0.52))); };
