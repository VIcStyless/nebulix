'use strict';
// Nova Brain: Nebulix's own assistant layer. It knows the user's live data (coins, gems, level, staff, stocks,
// booth), remembers facts the user asks it to, has selectable personalities, does maths, looks up stock prices
// and YouTube, and explains every Nebulix feature. With an AI provider configured it feeds that context to the
// model; without one it answers by itself (this file), so Nova always works.
const { S, isPro, hub } = require('./state');
const { now } = require('./util');

const STYLES = {
  friendly: ['Friendly', 'Amigable', 'Warm, upbeat and helpful.'],
  gamer: ['Gamer', 'Gamer', 'Talks like a hyped gamer friend: slang like GG, clutch, OP, but still clear and helpful.'],
  teacher: ['Teacher', 'Profe', 'Patient and structured: explains step by step with short examples.'],
  sarcastic: ['Sarcastic', 'Sarcástico', 'Dry, witty and a little sarcastic, never mean, always ends up helping.'],
  pirate: ['Pirate', 'Pirata', 'Speaks like a cheerful space pirate (arr!), but the information stays accurate.'],
  brief: ['Brief', 'Breve', 'Extremely concise: one or two sentences, bullet points when listing.'],
  // 13.8: "Nebulix AI" — Nova tuned to be the expert of Nebulix itself (a personality and knowledge pack on top of whichever model runs, not a separately trained model)
  nebulix: ['Nebulix AI', 'Nebulix IA', 'You are Nebulix AI, the built-in expert of Nebulix, made by VicStyles. You know every section of Nebulix and always answer with the exact place to go as a link (#/route) and short step-by-step instructions. Proactive: suggest the next useful thing to try in Nebulix. Energetic, clear, never generic.'],
};
const NEBULIX_GUIDE = [
  'Nebulix map (use these links): Home #/home · Study #/study (notes #/study/notes, flashcards #/study/cards, AI tutor #/study/tutor, live class quiz with PIN #/study/live, grades #/study/grades, exams #/study/exams, tools #/study/tools)',
  'Play: Arena #/arena (Royale with building and edits, Ops 5v5, Duels, Realistics 1v1 and Box Fight 1v1; P opens settings, N quick chat), Competitive #/ranked, Retro consoles #/retro, Cloud gaming #/cloud, Worlds #/worlds, World Boss #/boss, Tournaments #/tournaments, Leagues #/leagues, Quiz #/quiz, Word of the day #/word, Casino #/casino (blackjack, baccarat, video poker, hi-lo, crash, mines, plinko, roulette, slots, keno, limbo, wheel, horses, jackpot), 3D Casino #/casino3d',
  'Economy: Wallet #/wallet (bank tab, transfers, pets, chests), Shop & Locker #/shop, Market #/market, Advantages #/perks (boosts and upgrades), Work #/work, Invest #/invest, Plaza #/plaza. Daily reward and streak shields on Home.',
  'Create: Nebulix Code #/code, Studio #/studio, Hub #/hub, Drive #/drive, Docs #/docs, Sheets #/sheets, Slides #/slides, Notes #/notes, Translator #/translate, Themes #/themes, Terminal #/terminal, Virtual machines #/vm (BIOS, keys menu, Android player #/vm/android), Security Lab #/security, VPN #/vpn, Links #/links.',
  'Social: Community servers #/chat, Messages #/dm, Echo #/echo, Clips #/clips, TV #/tv, Lens #/lens, Forums #/forum, Clans #/clans, Squads #/squads, Events #/events. Settings #/settings (push notifications in Privacy, Nova button in Appearance).',
].join('\n');
const styleOf = (u) => (STYLES[u.nova && u.nova.style] ? u.nova.style : 'friendly');
const memOf = (u) => (u.nova && Array.isArray(u.nova.mem) ? u.nova.mem : []);

function setStyle(u, style) { if (!STYLES[style]) return false; u.nova = Object.assign({}, u.nova, { style }); S.store.touch('users'); return true; }
function remember(u, fact) {
  fact = String(fact || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 140); if (fact.length < 2) return false;
  const mem = memOf(u).filter((m) => m.toLowerCase() !== fact.toLowerCase()); mem.unshift(fact);
  u.nova = Object.assign({}, u.nova, { mem: mem.slice(0, 12) }); S.store.touch('users'); return true;
}
function forget(u, what) {
  const all = memOf(u); const w = String(what || '').toLowerCase().trim();
  const keep = w && !/^(todo|everything|all|todas?)$/.test(w) ? all.filter((m) => !m.toLowerCase().includes(w)) : [];
  u.nova = Object.assign({}, u.nova, { mem: keep }); S.store.touch('users'); return all.length - keep.length;
}

// --- live context, shared with LLM providers ---
function context(u) {
  const lvl = u.prog ? require('./progress').levelOf(u.prog.xp || 0) : 1;
  let staff = ''; try { const p = require('./routes/plaza').pending(u); staff = p.coins ? `${p.coins} coins waiting from their staff` : ''; } catch {}
  const booth = S.meta.booths && S.meta.booths[u.id];
  const st = STYLES[styleOf(u)];
  return [
    `Personality: ${st[0]} — ${st[2]}`,
    styleOf(u) === 'nebulix' ? NEBULIX_GUIDE : '',
    `User data (live, private to them): username @${u.username}, level ${lvl}, ${u.infinite ? 'unlimited' : u.coins} coins, ${u.gems || 0} gems, ${isPro(u) ? 'PRO member' : 'free plan'}${staff ? ', ' + staff : ''}${booth ? `, donation booth "${booth.title}" raised ${booth.raised}/${booth.goal}` : ''}.`,
    memOf(u).length ? 'Things the user asked you to remember: ' + memOf(u).map((m) => '"' + m + '"').join('; ') + '.' : '',
    `Nebulix features you can point to with links like [3D Casino](#/casino3d): Plaza (#/plaza: donation booths, player market, staff that earn coins, gems), 3D avatar (#/avatar), 3D Casino (#/casino3d), Arcade (#/arcade: Nebula Ops 3D shooter, Market Rush), Invest (#/invest), Wallet (#/wallet), Work (#/work), Casino (#/casino), Browser (#/browse, YouTube opens as Nebulix Tube), Themes (#/themes, incl. 3D themes), Settings → Appearance (menu layouts, app logos), account menu (switch between alt accounts).`,
    'Coins and gems are virtual; never suggest real-money gambling.',
  ].filter(Boolean).join('\n');
}

// --- safe arithmetic: + - * / ^ % ( ) and decimals ---
function calc(expr) {
  const s = expr.replace(/,/g, '.').replace(/[x×]/g, '*').replace(/÷/g, '/').replace(/\s+/g, '');
  if (!/^[\d.+\-*/^%()]+$/.test(s) || !/\d/.test(s) || s.length > 120) return null;
  let i = 0;
  const num = () => { let m = /^\d+(\.\d+)?/.exec(s.slice(i)); if (!m) throw new Error('num'); i += m[0].length; return parseFloat(m[0]); };
  const atom = () => { if (s[i] === '(') { i++; const v = add(); if (s[i] !== ')') throw new Error(')'); i++; return v; } if (s[i] === '-') { i++; return -atom(); } if (s[i] === '+') { i++; return atom(); } return num(); };
  const pow = () => { let v = atom(); while (s[i] === '^') { i++; v = Math.pow(v, atom()); } if (s[i] === '%') { i++; v = v / 100; } return v; };
  const mul = () => { let v = pow(); while (s[i] === '*' || s[i] === '/') { const o = s[i++]; const r = pow(); v = o === '*' ? v * r : v / r; } return v; };
  const add = () => { let v = mul(); while (s[i] === '+' || s[i] === '-') { const o = s[i++]; const r = mul(); v = o === '+' ? v + r : v - r; } return v; };
  try { const v = add(); if (i !== s.length || !Number.isFinite(v)) return null; return Math.round(v * 1e10) / 1e10; } catch { return null; }
}

const fmtN = (n, es) => Number(n).toLocaleString(es ? 'es-ES' : 'en-US');
const SYMS = { aapl: 'AAPL', apple: 'AAPL', nvda: 'NVDA', nvidia: 'NVDA', msft: 'MSFT', microsoft: 'MSFT', googl: 'GOOGL', google: 'GOOGL', alphabet: 'GOOGL', amzn: 'AMZN', amazon: 'AMZN', tsla: 'TSLA', tesla: 'TSLA', meta: 'META', facebook: 'META' };
const JOKES = [['Why did the gamer bring a ladder? To reach the next level.', '¿Por qué el gamer llevó una escalera? Para subir de nivel.'], ['My PC and I have a lot in common: we both overheat under pressure.', 'Mi PC y yo tenemos mucho en común: los dos nos sobrecalentamos bajo presión.'], ['I told my GPU a joke. It didn\'t render.', 'Le conté un chiste a mi GPU. No lo renderizó.'], ['Respawning is just a second chance with worse spawn points.', 'Reaparecer es una segunda oportunidad con peor punto de aparición.']];

// Memory and personality commands — handled by Nova itself even when an AI provider is configured.
function commands(u, text, lang) {
  const raw = String(text || '').trim(); const t = raw.toLowerCase();
  const es = lang === 'es' || /[¿¡ñáéíóú]/.test(t) || /\b(hola|cuánt|cuant|tengo|mis?|recuerda|olvida|precio|busca|llévame|llevame|quién|quien|qué|que)\b/.test(t);
  const L = (en, e) => (es ? e : en);
  const has = (...w) => w.some((x) => t.includes(x));
  const flavor = (s) => { const st = styleOf(u); if (st === 'pirate') return L('Arr! ', '¡Arr! ') + s; if (st === 'gamer') return s + ' GG 🎮'; if (st === 'sarcastic') return L('Oh, wonderful question. ', 'Oh, qué pregunta tan original. ') + s; return s; };

  // memory
  let m = /^(?:nova[, ]+)?(?:recuerda|acuérdate de|acuerdate de|remember)(?: que| that)?[:\s]+(.{2,140})$/i.exec(raw);
  if (m) { remember(u, m[1]); return flavor(L(`Got it, I'll remember: “${m[1].trim()}”. Say “what do you remember” to see everything, or “forget …” to delete it.`, `Hecho, lo recordaré: «${m[1].trim()}». Di «qué recuerdas» para verlo todo u «olvida …» para borrarlo.`)); }
  m = /^(?:nova[, ]+)?(?:olvida|forget)(?: que| that)?\s*(.*)$/i.exec(raw);
  if (m) { const n = forget(u, m[1]); return L(`Done — I forgot ${n} thing${n === 1 ? '' : 's'}.`, `Listo, he olvidado ${n} cosa${n === 1 ? '' : 's'}.`); }
  if (/(qué|que) (recuerdas|sabes de mí|sabes de mi)|what do you (remember|know about me)/i.test(t)) { const mem = memOf(u); return mem.length ? L('Here is what I remember about you:\n', 'Esto es lo que recuerdo de ti:\n') + mem.map((x) => '- ' + x).join('\n') : L('Nothing yet. Tell me “remember that …”.', 'Nada todavía. Dime «recuerda que …».'); }
  // personality
  m = /(?:personalidad|modo|style|personality)\s+(amigable|friendly|gamer|profe|teacher|sarc[aá]stic[oa]?|sarcastic|pirata|pirate|breve|brief)/i.exec(t);
  if (m) { const map = { nebulix: 'nebulix', amigable: 'friendly', friendly: 'friendly', gamer: 'gamer', profe: 'teacher', teacher: 'teacher', pirata: 'pirate', pirate: 'pirate', breve: 'brief', brief: 'brief' }; const k = map[m[1]] || (m[1].startsWith('sarc') ? 'sarcastic' : 'friendly'); setStyle(u, k); return flavor(L(`Personality switched to **${STYLES[k][0]}**.`, `Personalidad cambiada a **${STYLES[k][1]}**.`)); }

  return null;
}
async function answer(u, text, lang) {
  const c = commands(u, text, lang); if (c) return c;
  const raw = String(text || '').trim(); const t = raw.toLowerCase();
  const es = lang === 'es' || /[¿¡ñáéíóú]/.test(t) || /\b(hola|cuánt|cuant|tengo|mis?|recuerda|olvida|precio|busca|llévame|llevame|quién|quien|qué|que)\b/.test(t);
  const L = (en, e) => (es ? e : en);
  const has = (...w) => w.some((x) => t.includes(x));
  const flavor = (s) => { const st = styleOf(u); if (st === 'pirate') return L('Arr! ', '¡Arr! ') + s; if (st === 'gamer') return s + ' GG 🎮'; if (st === 'sarcastic') return L('Oh, wonderful question. ', 'Oh, qué pregunta tan original. ') + s; return s; };
  let m;
  // live data
  if (has('cuántas monedas', 'cuantas monedas', 'mi saldo', 'mis monedas', 'how many coins', 'my balance', 'my coins')) return flavor(L(`You have **${u.infinite ? '∞' : fmtN(u.coins)} coins** and **${fmtN(u.gems || 0)} gems**. [Open wallet](#/wallet)`, `Tienes **${u.infinite ? '∞' : fmtN(u.coins, 1)} monedas** y **${fmtN(u.gems || 0, 1)} gemas**. [Abrir cartera](#/wallet)`));
  if (has('gemas', 'gems') && has('cuánt', 'cuant', 'how many', 'tengo', 'my ')) return flavor(L(`You have **${fmtN(u.gems || 0)} gems**. Earn more with the daily reward, levels and achievements, or exchange coins in the [Plaza](#/plaza?tab=gems).`, `Tienes **${fmtN(u.gems || 0, 1)} gemas**. Consigue más con la recompensa diaria, los niveles y los logros, o cambia monedas en la [Plaza](#/plaza?tab=gems).`));
  if (has('mi nivel', 'qué nivel', 'que nivel', 'my level', 'what level')) { const lv = u.prog ? require('./progress').levelOf(u.prog.xp || 0) : 1; return flavor(L(`You're **level ${lv}**. [See achievements](#/progress)`, `Eres **nivel ${lv}**. [Ver logros](#/progress)`)); }
  if (has('empleados', 'staff', 'trabajadores', 'workers')) { try { const p = require('./routes/plaza').pending(u); return flavor(L(`Your staff have **${fmtN(p.coins)} coins** waiting${p.full ? ' (full — collect them!)' : ''}. [Open staff](#/plaza?tab=staff)`, `Tus empleados tienen **${fmtN(p.coins, 1)} monedas** esperando${p.full ? ' (¡lleno, recógelas!)' : ''}. [Abrir empleados](#/plaza?tab=staff)`)); } catch {} }
  if (has('quién está', 'quien esta', 'cuánta gente', 'cuanta gente', 'who is online', 'how many online', 'conectados')) return L(`Right now **${hub.count()}** people are online in Nebulix.`, `Ahora mismo hay **${hub.count()}** personas conectadas en Nebulix.`);
  // stocks
  const stock = Object.keys(SYMS).find((k) => new RegExp('\\b' + k + '\\b').test(t));
  if (stock && has('precio', 'price', 'cotiza', 'vale', 'acción', 'accion', 'stock', 'cuánto', 'cuanto', 'how much')) {
    try { const q = await require('./routes/invest').quote(SYMS[stock]); return L(`**${q.sym}** (${q.name}) is at **$${q.price}** (${q.change >= 0 ? '+' : ''}${q.change}% today). [Trade in Invest](#/invest)`, `**${q.sym}** (${q.name}) está a **${q.price} $** (${q.change >= 0 ? '+' : ''}${q.change}% hoy). [Operar en Inversiones](#/invest)`); } catch { return L('Stock prices are not answering right now.', 'Las cotizaciones no responden ahora mismo.'); }
  }
  // youtube
  m = /(?:busca(?:me)?|pon(?:me)?|search|play)\s+(?:en\s+)?(?:youtube\s+)?(.{2,80}?)(?:\s+en youtube|\s+on youtube)?$/i.exec(raw);
  if (m && (has('youtube', 'vídeo', 'video', 'canción', 'cancion', 'song', 'música', 'musica'))) {
    try { const items = (await require('./routes/tube').search(m[1].replace(/\b(en|on)?\s*youtube\b/gi, '').trim(), es ? 'es' : 'en')).slice(0, 4); if (items.length) return L('Here you go — they open in the Nebulix browser:\n', 'Aquí tienes, se abren en el navegador de Nebulix:\n') + items.map((v) => `- [${v.title.replace(/[[\]]/g, '')}](https://www.youtube.com/watch?v=${v.id}) · ${v.channel}${v.duration ? ' · ' + v.duration : ''}`).join('\n'); } catch {}
  }
  // maths
  const mexp = /^(?:cu[aá]nto es|calcula|calculate|what is|what's|=)?\s*([\d\s.,+\-*/x×÷^%()]+)\??$/i.exec(raw);
  if (mexp) { const v = calc(mexp[1]); if (v !== null) return flavor(`**${mexp[1].trim()} = ${fmtN(v, es)}**`); }
  m = /(\d+(?:[.,]\d+)?)\s*%\s*(?:de|of)\s*(\d+(?:[.,]\d+)?)/i.exec(t);
  if (m) { const v = (parseFloat(m[1].replace(',', '.')) / 100) * parseFloat(m[2].replace(',', '.')); return flavor(`**${m[1]}% ${L('of', 'de')} ${m[2]} = ${fmtN(Math.round(v * 100) / 100, es)}**`); }
  // time & small talk
  if (has('qué hora', 'que hora', 'what time', 'qué día', 'que dia', 'what day', 'fecha', 'date today')) return L(`It's ${new Date().toUTCString()} (UTC).`, `Es ${new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'full', timeStyle: 'short' })} (hora de España).`);
  if (has('chiste', 'joke', 'hazme reír', 'hazme reir', 'make me laugh')) { const j = JOKES[Math.floor(Math.random() * JOKES.length)]; return flavor(L(j[0], j[1])); }
  if (has('quién eres', 'quien eres', 'who are you', 'qué eres', 'que eres', 'quién te creó', 'quien te creo', 'who made you', 'who created you')) return flavor(L('I\'m **Nova**, the assistant built into Nebulix (created by VicStyles). I know your Nebulix account, remember what you ask me to, do maths, check stock prices, find YouTube videos and explain every feature. Change my personality with “personality gamer/teacher/pirate/sarcastic/brief”.', 'Soy **Nova**, la asistente integrada en Nebulix (creada por VicStyles). Conozco tu cuenta de Nebulix, recuerdo lo que me pidas, hago cálculos, miro cotizaciones, busco vídeos de YouTube y explico todas las funciones. Cambia mi personalidad con «personalidad gamer/profe/pirata/sarcástico/breve».'));
  // feature help
  const F = [
    [['plaza', 'donar', 'donate', 'puesto', 'booth', 'pls donate'], 'The **Plaza** has donation booths (open yours, others donate coins, pay coins to appear first), a player market and staff. [Open Plaza](#/plaza)', 'En la **Plaza** hay puestos de donación (abre el tuyo, otros te donan monedas y puedes pagar para salir primero), un mercado entre jugadores y empleados. [Abrir Plaza](#/plaza)'],
    [['gema', 'gem'], '**Gems** are the second currency: earned from the daily reward (+1, +5 on 7-day streaks), levels (+3) and achievements (+2), or exchanged from coins (2,500 → 1). Use them for premium 3D avatar parts and robot/AI staff.', 'Las **gemas** son la segunda moneda: se ganan con la recompensa diaria (+1, +5 cada 7 días de racha), subiendo de nivel (+3) y con logros (+2), o cambiando monedas (2.500 → 1). Sirven para piezas premium del avatar 3D y empleados robot/IA.'],
    [['empleado', 'contratar', 'hire', 'pasivo', 'passive'], 'Hire **staff** in the Plaza: they earn coins every hour even when you are offline (up to 12 h, 24 h with PRO). [Hire staff](#/plaza?tab=staff)', 'Contrata **empleados** en la Plaza: ganan monedas cada hora aunque no estés conectado (hasta 12 h, 24 h con PRO). [Contratar](#/plaza?tab=staff)'],
    [['casino 3d', '3d casino', 'metaverso', 'metaverse'], 'The **3D Casino** is a hall you walk with your avatar: see who is playing, chat with bubbles and press E at a table to play. [Enter](#/casino3d)', 'El **Casino 3D** es una sala por la que caminas con tu avatar: ves quién juega, chateas con bocadillos y pulsas E en una mesa para jugar. [Entrar](#/casino3d)'],
    [['avatar'], 'Design your **3D avatar** (hair, outfits, hats, auras). It shows on your profile and in the 3D casino. [Edit avatar](#/avatar)', 'Diseña tu **avatar 3D** (pelo, ropa, sombreros, auras). Sale en tu perfil y en el casino 3D. [Editar avatar](#/avatar)'],
    [['shooter', 'ops', 'counter', 'disparos', 'fps game', 'juego 3d'], '**Nebula Ops** is the 3D tactical shooter in the Arcade: clear rounds of bots, headshots score double. [Play](#/arcade)', '**Nebula Ops** es el shooter táctico 3D del Arcade: limpia rondas de bots, los disparos a la cabeza puntúan doble. [Jugar](#/arcade)'],
    [['mercado', 'market', 'vender', 'sell'], 'In the **player market** you sell cosmetics you own to other players (5% fee) and can boost your listing. [Open market](#/plaza?tab=market)', 'En el **mercado de jugadores** vendes los cosméticos que tienes a otros jugadores (5% de comisión) y puedes destacar tu anuncio. [Abrir mercado](#/plaza?tab=market)'],
    [['cuenta alt', 'alt account', 'cambiar de cuenta', 'switch account'], 'Open the account menu (your avatar, bottom left) → **Add account (alt)**. Then switch between them in one click. The browser also has **profiles** with separate cookies for alt accounts on websites.', 'Abre el menú de cuenta (tu avatar, abajo a la izquierda) → **Añadir cuenta (alt)**. Luego cambias entre ellas con un clic. El navegador también tiene **perfiles** con cookies separadas para cuentas alt en webs.'],
    [['distribución', 'distribucion', 'layout', 'menú', 'menu', 'logo'], 'Change the **menu layout** (left, right, top bar, dock, compact) and the **app logo** in Settings → Appearance or from the account menu.', 'Cambia la **distribución del menú** (izquierda, derecha, barra superior, dock, compacta) y el **logo** en Ajustes → Apariencia o desde el menú de cuenta.'],
    [['youtube'], 'YouTube opens inside the Nebulix browser as **Nebulix Tube**: search and watch in YouTube\'s official player.', 'YouTube se abre dentro del navegador de Nebulix como **Nebulix Tube**: buscas y ves los vídeos en el reproductor oficial de YouTube.'],
  ];
  for (const [ks, en, e] of F) if (ks.some((k) => t.includes(k))) return flavor(L(en, e));
  return null;
}

module.exports = { answer, commands, context, STYLES, styleOf, setStyle, memOf, remember, forget, calc };
