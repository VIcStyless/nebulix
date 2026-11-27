// Nebulix 3.0 phase 21 — Reference & utilities. #/ref/<tool>
//  table:   periodic table (118 elements, IUPAC standard atomic weights; [n] = mass number of the most stable isotope).
//  clock:   world clock with your own list of time zones (Intl time-zone database).
//  timer:   stopwatch with laps, countdown timer and a break reminder (public/js/timers.js keeps them running across pages).
//  weather: current weather and 7-day forecast from Open-Meteo through the server (CC BY 4.0).
//  fx:      currency converter with European Central Bank reference rates (Frankfurter), updated on working days.
//  physics: formula solver — pick a formula, fill in all but one value.
//  scan:    barcode / QR reader with the browser's BarcodeDetector (camera or image file) where the browser has it.
import { h, mount, ls, copyText } from '../util.js';
import { t, getLang, locale } from '../i18n.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { toast, toastErr, loading, emptyState, field, tabsEl, modal, segEl } from '../ui.js';
import * as TM from '../timers.js';

const TOOLS = [['table', 'Periodic table', 'flask'], ['clock', 'World clock', 'clock'], ['timer', 'Timers', 'bell'], ['weather', 'Weather', 'sun'], ['fx', 'Currency', 'coins'], ['physics', 'Physics', 'zap'], ['scan', 'Barcode reader', 'camera']];
const curLang = () => getLang() || 'es';

export default {
  title: () => t('Reference'),
  async mount(root, ctx) {
    let tool = TOOLS.some((x) => x[0] === ctx.params[0]) ? ctx.params[0] : ls('ref.tool') || 'table';
    const body = h('section.gt-body'); let cleanup = null;
    const show = async () => {
      ls('ref.tool', tool); history.replaceState(null, '', '#/ref/' + tool);
      if (cleanup) { try { cleanup(); } catch {} cleanup = null; }
      mount(body, loading());
      try { cleanup = (await FN[tool](body)) || null; } catch (e) { mount(body, emptyState('alert', t('Something went wrong'), e.message)); }
    };
    mount(root, h('div.inner.gt', h('div.page-title', h('div', h('h2', icon('book', 22), ' ', t('Reference')), h('p', t('Periodic table, world clock, timers, weather, currency rates, physics formulas and a barcode reader.')))),
      tabsEl(TOOLS.map(([k, l, ic]) => [k, t(l), ic]), tool, (v) => { tool = v; show(); }), body));
    show();
    return () => { if (cleanup) try { cleanup(); } catch {} };
  },
};

// ---------------- Periodic table ----------------
const EL = `H|Hydrogen|Hidrógeno|1.008 He|Helium|Helio|4.0026 Li|Lithium|Litio|6.94 Be|Beryllium|Berilio|9.0122 B|Boron|Boro|10.81 C|Carbon|Carbono|12.011 N|Nitrogen|Nitrógeno|14.007 O|Oxygen|Oxígeno|15.999 F|Fluorine|Flúor|18.998 Ne|Neon|Neón|20.180
Na|Sodium|Sodio|22.990 Mg|Magnesium|Magnesio|24.305 Al|Aluminium|Aluminio|26.982 Si|Silicon|Silicio|28.085 P|Phosphorus|Fósforo|30.974 S|Sulfur|Azufre|32.06 Cl|Chlorine|Cloro|35.45 Ar|Argon|Argón|39.948 K|Potassium|Potasio|39.098 Ca|Calcium|Calcio|40.078
Sc|Scandium|Escandio|44.956 Ti|Titanium|Titanio|47.867 V|Vanadium|Vanadio|50.942 Cr|Chromium|Cromo|51.996 Mn|Manganese|Manganeso|54.938 Fe|Iron|Hierro|55.845 Co|Cobalt|Cobalto|58.933 Ni|Nickel|Níquel|58.693 Cu|Copper|Cobre|63.546 Zn|Zinc|Zinc|65.38
Ga|Gallium|Galio|69.723 Ge|Germanium|Germanio|72.630 As|Arsenic|Arsénico|74.922 Se|Selenium|Selenio|78.971 Br|Bromine|Bromo|79.904 Kr|Krypton|Kriptón|83.798 Rb|Rubidium|Rubidio|85.468 Sr|Strontium|Estroncio|87.62 Y|Yttrium|Itrio|88.906 Zr|Zirconium|Circonio|91.224
Nb|Niobium|Niobio|92.906 Mo|Molybdenum|Molibdeno|95.95 Tc|Technetium|Tecnecio|[98] Ru|Ruthenium|Rutenio|101.07 Rh|Rhodium|Rodio|102.91 Pd|Palladium|Paladio|106.42 Ag|Silver|Plata|107.87 Cd|Cadmium|Cadmio|112.41 In|Indium|Indio|114.82 Sn|Tin|Estaño|118.71
Sb|Antimony|Antimonio|121.76 Te|Tellurium|Telurio|127.60 I|Iodine|Yodo|126.90 Xe|Xenon|Xenón|131.29 Cs|Caesium|Cesio|132.91 Ba|Barium|Bario|137.33 La|Lanthanum|Lantano|138.91 Ce|Cerium|Cerio|140.12 Pr|Praseodymium|Praseodimio|140.91 Nd|Neodymium|Neodimio|144.24
Pm|Promethium|Prometio|[145] Sm|Samarium|Samario|150.36 Eu|Europium|Europio|151.96 Gd|Gadolinium|Gadolinio|157.25 Tb|Terbium|Terbio|158.93 Dy|Dysprosium|Disprosio|162.50 Ho|Holmium|Holmio|164.93 Er|Erbium|Erbio|167.26 Tm|Thulium|Tulio|168.93 Yb|Ytterbium|Iterbio|173.05
Lu|Lutetium|Lutecio|174.97 Hf|Hafnium|Hafnio|178.49 Ta|Tantalum|Tantalio|180.95 W|Tungsten|Wolframio|183.84 Re|Rhenium|Renio|186.21 Os|Osmium|Osmio|190.23 Ir|Iridium|Iridio|192.22 Pt|Platinum|Platino|195.08 Au|Gold|Oro|196.97 Hg|Mercury|Mercurio|200.59
Tl|Thallium|Talio|204.38 Pb|Lead|Plomo|207.2 Bi|Bismuth|Bismuto|208.98 Po|Polonium|Polonio|[209] At|Astatine|Astato|[210] Rn|Radon|Radón|[222] Fr|Francium|Francio|[223] Ra|Radium|Radio|[226] Ac|Actinium|Actinio|[227] Th|Thorium|Torio|232.04
Pa|Protactinium|Protactinio|231.04 U|Uranium|Uranio|238.03 Np|Neptunium|Neptunio|[237] Pu|Plutonium|Plutonio|[244] Am|Americium|Americio|[243] Cm|Curium|Curio|[247] Bk|Berkelium|Berkelio|[247] Cf|Californium|Californio|[251] Es|Einsteinium|Einstenio|[252] Fm|Fermium|Fermio|[257]
Md|Mendelevium|Mendelevio|[258] No|Nobelium|Nobelio|[259] Lr|Lawrencium|Lawrencio|[266] Rf|Rutherfordium|Rutherfordio|[267] Db|Dubnium|Dubnio|[268] Sg|Seaborgium|Seaborgio|[269] Bh|Bohrium|Bohrio|[270] Hs|Hassium|Hasio|[269] Mt|Meitnerium|Meitnerio|[278] Ds|Darmstadtium|Darmstatio|[281]
Rg|Roentgenium|Roentgenio|[282] Cn|Copernicium|Copernicio|[285] Nh|Nihonium|Nihonio|[286] Fl|Flerovium|Flerovio|[289] Mc|Moscovium|Moscovio|[290] Lv|Livermorium|Livermorio|[293] Ts|Tennessine|Teneso|[294] Og|Oganesson|Oganesón|[294]`.split(/\s+/).map((s, i) => { const [sym, en, es, mass] = s.split('|'); return { z: i + 1, sym, en, es, mass }; });
const setOf = (s) => new Set(s.split(' ').map(Number));
const CATS = [['alkali', 'Alkali metal', setOf('3 11 19 37 55 87')], ['alkaline', 'Alkaline earth metal', setOf('4 12 20 38 56 88')], ['noble', 'Noble gas', setOf('2 10 18 36 54 86 118')], ['halogen', 'Halogen', setOf('9 17 35 53 85 117')],
  ['nonmetal', 'Nonmetal', setOf('1 6 7 8 15 16 34')], ['metalloid', 'Metalloid', setOf('5 14 32 33 51 52')], ['post', 'Post-transition metal', setOf('13 31 49 50 81 82 83 84 113 114 115 116')]];
const catOf = (z) => (z >= 57 && z <= 71 ? 'lanth' : z >= 89 && z <= 103 ? 'actin' : (CATS.find((c) => c[2].has(z)) || ['transition'])[0]);
const CAT_NAMES = { alkali: 'Alkali metal', alkaline: 'Alkaline earth metal', transition: 'Transition metal', post: 'Post-transition metal', metalloid: 'Metalloid', nonmetal: 'Nonmetal', halogen: 'Halogen', noble: 'Noble gas', lanth: 'Lanthanide', actin: 'Actinide' };
const GAS = setOf('1 2 7 8 9 10 17 18 36 54 86'), LIQ = setOf('35 80');
function place(z) { // [row, column] in the 18-column layout; f-block on rows 9 and 10
  const P = [[1, 2], [3, 10], [11, 18], [19, 36], [37, 54], [55, 86], [87, 118]]; const p = P.findIndex(([a, b]) => z >= a && z <= b) + 1; const first = P[p - 1][0]; const k = z - first;
  if (p === 1) return [1, z === 1 ? 1 : 18];
  if (p <= 3) return [p, k < 2 ? k + 1 : k + 11];
  if (p <= 5) return [p, k + 1];
  if (k < 2) return [p, k + 1];
  if (k <= 16) return [p + 3, k + 1]; // La..Lu / Ac..Lr → f-block row, columns 3..17
  return [p, k - 13];
}
function table(box) {
  const es = curLang() === 'es'; let q = ''; let cat = '';
  const info = h('div.ref-elinfo');
  const showEl = (e) => {
    const [row, col] = place(e.z); const period = row > 7 ? row - 3 : row; const group = row > 7 ? '—' : col;
    const state = e.z > 103 ? t('Unknown') : GAS.has(e.z) ? t('Gas') : LIQ.has(e.z) ? t('Liquid') : t('Solid');
    mount(info, h('div.ref-elbig.c-' + catOf(e.z), h('span', e.z), h('b', e.sym), h('i', e.mass)), h('div', h('h3', es ? e.es : e.en), h('p.small.muted', (es ? e.en : e.es)),
      h('table.gt-tbl', h('tr', h('th', t('Atomic number')), h('td', e.z)), h('tr', h('th', t('Atomic mass')), h('td', e.mass + ' u')), h('tr', h('th', t('Group')), h('td', group)), h('tr', h('th', t('Period')), h('td', period)), h('tr', h('th', t('Category')), h('td', t(CAT_NAMES[catOf(e.z)]))), h('tr', h('th', t('State at 25 °C')), h('td', state)))));
  };
  const grid = h('div.ref-pt');
  const paint = () => {
    const ql = q.toLowerCase();
    mount(grid, EL.map((e) => { const [r, c] = place(e.z); const hit = (!ql || e.sym.toLowerCase() === ql || e.en.toLowerCase().includes(ql) || e.es.toLowerCase().includes(ql) || String(e.z) === ql) && (!cat || catOf(e.z) === cat);
      return h('button.ref-el.c-' + catOf(e.z) + (hit ? '' : '.dim'), { style: `grid-row:${r};grid-column:${c}`, title: (es ? e.es : e.en), onClick: () => showEl(e) }, h('span', e.z), h('b', e.sym)); }),
      h('div.ref-elmark', { style: 'grid-row:6;grid-column:3' }, '57–71'), h('div.ref-elmark', { style: 'grid-row:7;grid-column:3' }, '89–103'), h('div.ref-gap', { style: 'grid-row:8;grid-column:1/-1' }));
  };
  const search = h('input.input', { type: 'search', placeholder: t('Symbol, name or number'), onInput: (e) => { q = e.target.value.trim(); paint(); const m = EL.find((x) => x.sym.toLowerCase() === q.toLowerCase() || String(x.z) === q); if (m) showEl(m); } });
  const legend = h('div.ref-legend', Object.entries(CAT_NAMES).map(([k, n]) => h('button.chip.c-' + k, { onClick: (ev) => { cat = cat === k ? '' : k; [...legend.children].forEach((b) => b.classList.remove('on')); if (cat) ev.currentTarget.classList.add('on'); paint(); } }, t(n))));
  mount(box, h('div', h('div.toolbar', search), legend, h('div.ref-ptwrap', grid, h('section.card.gt-card', info))));
  paint(); showEl(EL[ls('ref.el') || 0] || EL[0]);
}

// ---------------- World clock ----------------
function clock(box) {
  const all = Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : ['UTC', 'Europe/Madrid', 'America/New_York'];
  const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let zones = ls('ref.zones') || ['Europe/Madrid', 'America/Mexico_City', 'America/New_York', 'Asia/Tokyo'];
  const list = h('div.ref-clocks'); const loc = locale();
  const sel = h('input.input', { list: 'ref-tz', placeholder: t('Add a city or time zone (e.g. Europe/London)') });
  const dl = h('datalist', { id: 'ref-tz' }, all.map((z) => h('option', { value: z })));
  const add = () => { const z = sel.value.trim(); const m = all.find((x) => x.toLowerCase() === z.toLowerCase()) || all.find((x) => x.toLowerCase().endsWith('/' + z.toLowerCase().replace(/ /g, '_'))); if (!m) return toast(t('Unknown time zone'), 'error'); if (!zones.includes(m)) zones.push(m); ls('ref.zones', zones); sel.value = ''; paint(); };
  sel.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  const offset = (z, d) => { const p = new Intl.DateTimeFormat('en', { timeZone: z, timeZoneName: 'shortOffset' }).formatToParts(d).find((x) => x.type === 'timeZoneName'); return p ? p.value.replace('GMT', 'UTC') : ''; };
  const paint = () => {
    const d = new Date(); const hereDay = new Intl.DateTimeFormat('en-CA', { timeZone: here }).format(d);
    mount(list, [here, ...zones.filter((z) => z !== here)].map((z) => {
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: z }).format(d); const hr = Number(new Intl.DateTimeFormat('en', { timeZone: z, hour: 'numeric', hour12: false }).format(d)) % 24;
      return h('div.ref-clock' + (hr >= 7 && hr < 20 ? '.day' : '.night'), h('div.grow', h('b', z.split('/').pop().replace(/_/g, ' ')), h('div.tiny.muted', z + ' · ' + offset(z, d) + (z === here ? ' · ' + t('You') : ''))),
        h('div.ref-time', new Intl.DateTimeFormat(loc, { timeZone: z, hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(d), h('div.tiny.muted', day === hereDay ? t('Today') : day > hereDay ? t('Tomorrow') : t('Yesterday'))),
        z !== here ? h('button.btn.sm.ghost', { 'aria-label': t('Remove'), onClick: () => { zones = zones.filter((x) => x !== z); ls('ref.zones', zones); paint(); } }, icon('x', 13)) : null);
    }));
  };
  mount(box, h('div', h('div.toolbar', sel, dl, h('button.btn.primary', { onClick: add }, icon('plus', 14), t('Add'))), list));
  paint(); const timer = setInterval(paint, 1000);
  return () => clearInterval(timer);
}

// ---------------- Timers ----------------
function timer(box) {
  const swOut = h('div.ref-big'); const laps = h('ol.ref-laps'); const swBtn = h('button.btn.primary'); const lapBtn = h('button.btn', { onClick: TM.swLap }, icon('flag', 14), t('Lap'));
  const cdOut = h('div.ref-big'); const cdBtn = h('button.btn.primary'); const lbl = h('input.input', { maxlength: 40, placeholder: t('Label (optional)') });
  const mm = h('input.input', { type: 'number', min: 0, max: 999, value: 5, inputmode: 'numeric', 'aria-label': t('Minutes') }); const ss = h('input.input', { type: 'number', min: 0, max: 59, value: 0, inputmode: 'numeric', 'aria-label': t('Seconds') });
  const brInfo = h('div.small.muted');
  const PRE = [[1, '1 min'], [3, '3 min'], [5, '5 min'], [10, '10 min'], [15, '15 min'], [25, '25 min'], [45, '45 min'], [60, '1 h']];
  const startCustom = () => { const ms = (Math.max(0, Number(mm.value) || 0) * 60 + Math.max(0, Math.min(59, Number(ss.value) || 0))) * 1000; if (ms < 1000) return toast(t('Set at least one second'), 'error'); TM.cdStart(ms, lbl.value.trim()); };
  const brSeg = segEl([[0, t('Off')], [20, '20 min'], [30, '30 min'], [45, '45 min'], [60, '1 h'], [90, '1 h 30']], Math.round(TM.state().br.every / 60000), (v) => TM.brSet(Number(v)));
  const once = (el, key, fn) => { if (el._k !== key) { el._k = key; fn(); } };
  const paint = () => {
    const s = TM.state(); const sw = TM.swElapsed(s); swOut.textContent = TM.fmtMs(sw, true);
    once(swBtn, s.sw.start ? 'p' : sw ? 'r' : 's', () => mount(swBtn, icon(s.sw.start ? 'pause' : 'play', 14), s.sw.start ? t('Pause') : sw ? t('Resume') : t('Start'))); swBtn.onclick = TM.swToggle; lapBtn.disabled = !sw;
    once(laps, s.sw.laps.length + ':' + (s.sw.laps[0] || 0), () => mount(laps, s.sw.laps.map((l, i) => h('li', h('span', t('Lap {n}', { n: s.sw.laps.length - i })), h('b', TM.fmtMs(l - (s.sw.laps[i + 1] || 0), true)), h('span.muted', TM.fmtMs(l, true))))));
    const left = TM.cdLeft(s); cdOut.textContent = TM.fmtMs(left || s.cd.dur); cdOut.classList.toggle('run', !!s.cd.end);
    once(cdBtn, s.cd.end ? 'p' : s.cd.left ? 'r' : 's', () => mount(cdBtn, icon(s.cd.end ? 'pause' : 'play', 14), s.cd.end ? t('Pause') : s.cd.left ? t('Resume') : t('Start'))); cdBtn.onclick = () => (s.cd.end ? TM.cdPause() : s.cd.left ? TM.cdStart() : startCustom());
    brInfo.textContent = s.br.every ? t('Next reminder in {t}', { t: TM.fmtMs(s.br.next - Date.now()) }) : t('Off. Pick an interval to get a reminder to rest your eyes and stretch.');
  };
  mount(box, h('div.grid.cols-2',
    h('section.card', h('h3', icon('clock', 16), ' ', t('Stopwatch')), swOut, h('div.row', { style: 'gap:6px' }, swBtn, lapBtn, h('button.btn.ghost', { onClick: TM.swReset }, icon('refresh', 14), t('Reset'))), laps),
    h('section.card', h('h3', icon('bell', 16), ' ', t('Timer')), cdOut,
      h('div.row', { style: 'gap:4px;flex-wrap:wrap' }, PRE.map(([m, l]) => h('button.chip', { onClick: () => TM.cdStart(m * 60000, lbl.value.trim()) }, l))),
      h('div.row', { style: 'gap:6px;align-items:end;flex-wrap:wrap' }, field(t('Minutes'), mm), field(t('Seconds'), ss), h('div.grow', field(t('Label'), lbl))),
      h('div.row', { style: 'gap:6px' }, cdBtn, h('button.btn.ghost', { onClick: TM.cdReset }, icon('refresh', 14), t('Reset')))),
    h('section.card', { style: 'grid-column:1/-1' }, h('h3', icon('eye', 16), ' ', t('Break reminder')), h('p.small.muted', t('For long gaming or study sessions: a sound and a notice every so often to rest your eyes, stretch and drink water.')), brSeg, brInfo),
    h('p.tiny.muted', { style: 'grid-column:1/-1' }, t('Timers keep running while you use other parts of Nebulix and after a reload, but they can only ring while a Nebulix tab is open. Allow notifications to be told when the tab is in the background.'))));
  paint(); const iv = setInterval(paint, 47); const off = TM.onChange(paint);
  return () => { clearInterval(iv); off(); };
}

// ---------------- Weather ----------------
const WMO = { 0: ['☀️', 'Clear sky'], 1: ['🌤️', 'Mainly clear'], 2: ['⛅', 'Partly cloudy'], 3: ['☁️', 'Overcast'], 45: ['🌫️', 'Fog'], 48: ['🌫️', 'Fog'], 51: ['🌦️', 'Light drizzle'], 53: ['🌦️', 'Drizzle'], 55: ['🌧️', 'Heavy drizzle'], 56: ['🌧️', 'Freezing drizzle'], 57: ['🌧️', 'Freezing drizzle'], 61: ['🌦️', 'Light rain'], 63: ['🌧️', 'Rain'], 65: ['🌧️', 'Heavy rain'], 66: ['🌧️', 'Freezing rain'], 67: ['🌧️', 'Freezing rain'], 71: ['🌨️', 'Light snow'], 73: ['🌨️', 'Snow'], 75: ['❄️', 'Heavy snow'], 77: ['🌨️', 'Snow grains'], 80: ['🌦️', 'Rain showers'], 81: ['🌧️', 'Rain showers'], 82: ['⛈️', 'Violent rain showers'], 85: ['🌨️', 'Snow showers'], 86: ['❄️', 'Snow showers'], 95: ['⛈️', 'Thunderstorm'], 96: ['⛈️', 'Thunderstorm with hail'], 99: ['⛈️', 'Thunderstorm with hail'] };
const wmo = (c) => WMO[c] || ['🌡️', 'Unknown'];
async function weather(box) {
  let place = ls('ref.place') || null; const res = h('div'); const sugg = h('div.ref-sugg');
  const input = h('input.input', { type: 'search', placeholder: t('Search a city') });
  let tmo = 0; input.addEventListener('input', () => { clearTimeout(tmo); tmo = setTimeout(async () => { const q = input.value.trim(); if (q.length < 2) return mount(sugg); try { const r = await api.get('/api/ref/geocode?lang=' + curLang() + '&q=' + encodeURIComponent(q)); mount(sugg, r.places.map((p) => h('button.chip', { onClick: () => { place = p; ls('ref.place', p); mount(sugg); input.value = ''; load(); } }, p.name + (p.admin ? ', ' + p.admin : '') + ' · ' + p.country))); } catch (e) { toastErr(e); } }, 350); });
  const locBtn = h('button.btn', { onClick: () => { if (!navigator.geolocation) return toast(t('Location is not available in this browser'), 'error'); navigator.geolocation.getCurrentPosition((p) => { place = { name: t('My location'), lat: p.coords.latitude, lon: p.coords.longitude, country: '' }; ls('ref.place', place); load(); }, () => toast(t('Location permission was denied'), 'error'), { timeout: 10000 }); } }, icon('pin', 14), t('Use my location'));
  const loc = locale();
  async function load() {
    if (!place) return mount(res, emptyState('sun', t('Pick a place'), t('Search a city or use your location.')));
    mount(res, loading());
    try {
      const w = await api.get(`/api/ref/weather?lat=${place.lat}&lon=${place.lon}`); const [ic, label] = wmo(w.current.code);
      const dayName = (d) => new Date(d + 'T12:00').toLocaleDateString(loc, { weekday: 'short', day: 'numeric' });
      mount(res, h('section.card.gt-card.ref-wnow', h('div.ref-wbig', h('span', ic), h('b', Math.round(w.current.temp) + '°'), h('div', h('h3', place.name + (place.country ? ', ' + place.country : '')), h('p', t(label)), h('p.small.muted', t('Feels like {n}°', { n: Math.round(w.current.feels) }) + ' · ' + t('Humidity {n}%', { n: w.current.humidity }) + ' · ' + t('Wind {n} km/h', { n: Math.round(w.current.wind) })))),
        h('div.ref-hours', w.hourly.map((x) => h('div', h('span.tiny.muted', x.time.slice(11, 16)), h('span', wmo(x.code)[0]), h('b', Math.round(x.temp) + '°'), h('span.tiny', x.rain + '%'))))),
        h('section.card.gt-card', h('h3', t('Next 7 days')), h('div.ref-days', w.daily.map((d) => h('div.ref-day', h('b', dayName(d.date)), h('span.ref-wic', wmo(d.code)[0]), h('span', Math.round(d.max) + '° / ' + Math.round(d.min) + '°'), h('span.tiny.muted', '💧 ' + d.rain + '%'), h('span.tiny.muted', '☀ ' + d.sunrise.slice(11) + ' – ' + d.sunset.slice(11)))))),
        h('p.tiny.muted', t('Weather data by {s}', { s: w.source })));
    } catch (e) { mount(res, emptyState('alert', t('Could not load the weather'), e.message)); }
  }
  mount(box, h('div', h('div.toolbar', input, locBtn), sugg, res)); load();
  return () => clearTimeout(tmo);
}

// ---------------- Currency ----------------
async function fx(box) {
  let base = ls('ref.fxbase') || 'EUR'; let data = null;
  const amount = h('input.input', { type: 'number', value: ls('ref.fxamt') || 100, step: 'any', style: 'max-width:160px' });
  const from = h('select.input'); const to = h('select.input'); const outEl = h('b.gt-out'); const tableEl = h('div.ref-fxgrid'); const note = h('p.tiny.muted');
  async function load() {
    try { data = await api.get('/api/ref/fx?base=' + base); } catch (e) { return mount(box, emptyState('alert', t('Could not load exchange rates'), e.message)); }
    const codes = [data.base, ...Object.keys(data.rates)].sort();
    const opt = (sel, v) => mount(sel, codes.map((c) => h('option', { value: c, selected: c === v }, c + ' — ' + (data.names[c] || c))));
    opt(from, data.base); opt(to, ls('ref.fxto') || (data.base === 'USD' ? 'EUR' : 'USD'));
    note.textContent = t('European Central Bank reference rates of {d}. Banks and card providers add their own margin.', { d: data.date });
    calc();
  }
  const rate = (c) => (c === data.base ? 1 : data.rates[c]);
  function calc() {
    if (!data) return; ls('ref.fxamt', amount.value); ls('ref.fxto', to.value);
    if (from.value !== data.base) { base = from.value; ls('ref.fxbase', base); return load(); }
    const a = Number(amount.value) || 0; const r = rate(to.value);
    outEl.textContent = new Intl.NumberFormat(locale(), { style: 'currency', currency: to.value }).format(a * r);
    mount(tableEl, ['USD', 'EUR', 'GBP', 'JPY', 'MXN', 'BRL', 'CAD', 'CHF', 'CNY', 'INR', 'AUD', 'KRW'].filter((c) => c !== data.base && rate(c)).map((c) => h('div', h('span', c), h('b', new Intl.NumberFormat(locale(), { style: 'currency', currency: c, maximumFractionDigits: 2 }).format(a * rate(c))))));
  }
  [amount, from, to].forEach((e) => e.addEventListener('input', calc));
  const swap = h('button.btn.sm', { onClick: () => { const f = from.value; ls('ref.fxto', f); base = to.value; ls('ref.fxbase', base); load(); } }, icon('swap', 14), t('Swap'));
  mount(box, h('div.gt-grid', h('section.card.gt-card', h('h3', t('Convert')), h('div.gt-row', field(t('Amount'), amount), field(t('From'), from), swap, field(t('To'), to)), h('div.gt-results', h('div', h('span', t('Result')), outEl)), note),
    h('section.card.gt-card', h('h3', t('Main currencies')), tableEl), h('p.tiny.muted', t('Rates by Frankfurter (frankfurter.dev), which publishes the European Central Bank reference rates. Real money only — Nebulix coins are not convertible.'))));
  await load();
}

// ---------------- Physics ----------------
const FORMULAS = [
  ['Speed', 'v = d / t', { v: ['Speed', 'm/s'], d: ['Distance', 'm'], t: ['Time', 's'] }, { v: (x) => x.d / x.t, d: (x) => x.v * x.t, t: (x) => x.d / x.v }],
  ['Uniform acceleration', 'v = v₀ + a·t', { v: ['Final speed', 'm/s'], v0: ['Initial speed', 'm/s'], a: ['Acceleration', 'm/s²'], t: ['Time', 's'] }, { v: (x) => x.v0 + x.a * x.t, v0: (x) => x.v - x.a * x.t, a: (x) => (x.v - x.v0) / x.t, t: (x) => (x.v - x.v0) / x.a }],
  ['Newton’s second law', 'F = m·a', { F: ['Force', 'N'], m: ['Mass', 'kg'], a: ['Acceleration', 'm/s²'] }, { F: (x) => x.m * x.a, m: (x) => x.F / x.a, a: (x) => x.F / x.m }],
  ['Weight', 'P = m·g (g = 9.81)', { P: ['Weight', 'N'], m: ['Mass', 'kg'] }, { P: (x) => x.m * 9.80665, m: (x) => x.P / 9.80665 }],
  ['Kinetic energy', 'Ek = ½·m·v²', { E: ['Energy', 'J'], m: ['Mass', 'kg'], v: ['Speed', 'm/s'] }, { E: (x) => 0.5 * x.m * x.v ** 2, m: (x) => (2 * x.E) / x.v ** 2, v: (x) => Math.sqrt((2 * x.E) / x.m) }],
  ['Potential energy', 'Ep = m·g·h', { E: ['Energy', 'J'], m: ['Mass', 'kg'], hh: ['Height', 'm'] }, { E: (x) => x.m * 9.80665 * x.hh, m: (x) => x.E / (9.80665 * x.hh), hh: (x) => x.E / (9.80665 * x.m) }],
  ['Density', 'ρ = m / V', { r: ['Density', 'kg/m³'], m: ['Mass', 'kg'], V: ['Volume', 'm³'] }, { r: (x) => x.m / x.V, m: (x) => x.r * x.V, V: (x) => x.m / x.r }],
  ['Pressure', 'p = F / A', { p: ['Pressure', 'Pa'], F: ['Force', 'N'], A: ['Area', 'm²'] }, { p: (x) => x.F / x.A, F: (x) => x.p * x.A, A: (x) => x.F / x.p }],
  ['Ohm’s law', 'V = I·R', { V: ['Voltage', 'V'], I: ['Current', 'A'], R: ['Resistance', 'Ω'] }, { V: (x) => x.I * x.R, I: (x) => x.V / x.R, R: (x) => x.V / x.I }],
  ['Electric power', 'P = V·I', { P: ['Power', 'W'], V: ['Voltage', 'V'], I: ['Current', 'A'] }, { P: (x) => x.V * x.I, V: (x) => x.P / x.I, I: (x) => x.P / x.V }],
  ['Work', 'W = F·d', { W: ['Work', 'J'], F: ['Force', 'N'], d: ['Distance', 'm'] }, { W: (x) => x.F * x.d, F: (x) => x.W / x.d, d: (x) => x.W / x.F }],
  ['Wave speed', 'v = λ·f', { v: ['Speed', 'm/s'], l: ['Wavelength', 'm'], f: ['Frequency', 'Hz'] }, { v: (x) => x.l * x.f, l: (x) => x.v / x.f, f: (x) => x.v / x.l }],
];
function physics(box) {
  let idx = ls('ref.phys') || 0; const sel = h('select.input', FORMULAS.map((f, i) => h('option', { value: i, selected: i === idx }, t(f[0]) + ' — ' + f[1])));
  const form = h('div'); let solveFor = null;
  const paint = () => {
    const [, eq, vars, solve] = FORMULAS[idx]; const keys = Object.keys(vars); if (!keys.includes(solveFor)) solveFor = keys[0];
    const ins = {}; const res = h('b.gt-out');
    const calc = () => { const x = {}; for (const k of keys) if (k !== solveFor) { const v = Number(ins[k].value); if (ins[k].value === '' || !Number.isFinite(v)) { res.textContent = t('Fill in the other values'); return; } x[k] = v; } const r = solve[solveFor](x); res.textContent = Number.isFinite(r) ? (Math.abs(r) >= 1e6 || (Math.abs(r) < 1e-3 && r !== 0) ? r.toExponential(4) : String(Math.round(r * 1e6) / 1e6)) + ' ' + vars[solveFor][1] : t('Not defined for these values'); };
    mount(form, h('p', h('code.gt-code', eq)), h('div.gt-row', keys.map((k) => { ins[k] = h('input.input', { type: 'number', step: 'any', disabled: k === solveFor, placeholder: k === solveFor ? t('result') : '', style: 'max-width:150px', onInput: calc });
      return field(h('label.gt-chk', h('input', { type: 'radio', name: 'solve', checked: k === solveFor, onChange: () => { solveFor = k; paint(); } }), t(vars[k][0]) + ' (' + vars[k][1] + ')'), ins[k]); })),
      h('div.gt-results', h('div', h('span', t('Result: {n}', { n: t(vars[solveFor][0]) })), res)), h('p.tiny.muted', t('Choose the value to find with the round button, then fill in the others. SI units.')));
    calc();
  };
  sel.addEventListener('change', () => { idx = Number(sel.value); ls('ref.phys', idx); paint(); });
  mount(box, h('section.card.gt-card', h('h3', t('Physics formulas')), field(t('Formula'), sel), form)); paint();
}

// ---------------- Barcode reader ----------------
async function scan(box) {
  const has = 'BarcodeDetector' in window; let stream = null, raf = 0; const found = h('div.ref-found'); const seen = new Set();
  if (!has) return mount(box, emptyState('camera', t('This browser cannot read barcodes'), t('Barcode reading uses the BarcodeDetector API, available in Chrome, Edge, Opera and Brave on Android, ChromeOS and macOS, and in Samsung Internet. Firefox and most desktop Windows/Linux browsers do not have it yet.')));
  let formats = []; try { formats = await window.BarcodeDetector.getSupportedFormats(); } catch {}
  if (!formats.length) return mount(box, emptyState('camera', t('This browser cannot read barcodes'), t('The barcode reader is present but has no formats on this device.')));
  const det = new window.BarcodeDetector({ formats });
  const video = h('video.ref-video', { playsInline: true, muted: true }); const add = (codes) => { for (const c of codes) { if (seen.has(c.rawValue)) continue; seen.add(c.rawValue); const isUrl = /^https?:\/\//i.test(c.rawValue);
    found.prepend(h('div.ref-code', h('span.tag', c.format), h('code.grow', c.rawValue), h('button.btn.sm', { onClick: async () => { await copyText(c.rawValue); toast(t('Copied!')); } }, icon('copy', 13)), isUrl ? h('button.btn.sm', { onClick: () => modal({ title: t('Open this link?'), body: h('p', h('code', c.rawValue)), actions: [{ label: t('Cancel') }, { label: t('Open'), kind: 'primary', onClick: () => window.open(c.rawValue, '_blank', 'noopener') }] }) }, icon('external', 13)) : null)); } };
  const camBtn = h('button.btn.primary', { onClick: async () => {
    if (stream) { stop(); return; }
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); video.srcObject = stream; await video.play(); camBtn.lastChild.textContent = ' ' + t('Stop camera');
      const loop = async () => { if (!stream) return; try { add(await det.detect(video)); } catch {} raf = setTimeout(loop, 250); }; loop();
    } catch { toast(t('Camera permission was denied or no camera is available'), 'error'); }
  } }, icon('camera', 14), ' ' + t('Start camera'));
  const file = h('input', { type: 'file', accept: 'image/*', style: 'display:none', onChange: async (e) => { const f = e.target.files[0]; if (!f) return; try { const bmp = await createImageBitmap(f); const r = await det.detect(bmp); if (!r.length) toast(t('No code found in that image'), 'error'); add(r); } catch { toast(t('Could not read that image'), 'error'); } e.target.value = ''; } });
  function stop() { clearTimeout(raf); if (stream) stream.getTracks().forEach((x) => x.stop()); stream = null; video.srcObject = null; camBtn.lastChild.textContent = ' ' + t('Start camera'); }
  mount(box, h('div.gt-grid', h('section.card.gt-card', h('h3', t('Barcode and QR reader')), h('div.row', { style: 'gap:8px;flex-wrap:wrap' }, camBtn, h('button.btn', { onClick: () => file.click() }, icon('image', 14), t('Read from an image')), file), video,
    h('p.tiny.muted', t('Reads {f}. Everything happens on your device.', { f: formats.join(', ') }))), h('section.card.gt-card', h('h3', t('Found')), found)));
  return stop;
}

const FN = { table, clock, timer, weather, fx, physics, scan };
