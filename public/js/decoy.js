// Disguise mode and admin lockdown (13.8).
//  · Disguise (per device, Settings → Safety): opening Nebulix shows an ordinary-looking study notes page. Typing your
//    secret code (in the search box, or anywhere on the page) opens Nebulix. The code is stored only as a SHA-256 hash.
//  · Lockdown (owner / admin, from Admin): every open Nebulix switches to the same study page at once, and stays there
//    until the lockdown is lifted. Staff are not locked.
// The page is an original design ("Cuaderno de estudio"); it does not copy any real website.
import { h } from './util.js';

const KEY = 'nbx.disguise'; const SESSION = 'nbx.disguise.open';
const get = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
export const disguiseOn = () => { const d = get(); return !!(d && d.on && d.hash); };
async function sha(s) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('nbx-disguise:' + s)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join(''); }
export async function setDisguise(on, code) { if (!on) { localStorage.removeItem(KEY); return true; } const c = String(code || '').trim(); if (c.length < 4) return false; localStorage.setItem(KEY, JSON.stringify({ on: true, hash: await sha(c.toLowerCase()) })); try { sessionStorage.setItem(SESSION, '1'); } catch {} return true; }

const TOPICS = [
  ['La célula', 'La célula es la unidad básica de los seres vivos. Todas las células tienen membrana plasmática, citoplasma y material genético. Las procariotas no tienen núcleo definido; las eucariotas sí, además de orgánulos como mitocondrias, retículo endoplasmático y aparato de Golgi.', ['Membrana plasmática: controla qué entra y qué sale.', 'Núcleo: guarda el ADN y dirige la actividad celular.', 'Mitocondrias: producen la energía (respiración celular).', 'Cloroplastos (solo vegetales): realizan la fotosíntesis.']],
  ['La fotosíntesis', 'Proceso por el que las plantas transforman la energía de la luz en energía química. Ocurre en los cloroplastos gracias a la clorofila.', ['Ecuación: 6 CO₂ + 6 H₂O + luz → C₆H₁₂O₆ + 6 O₂', 'Fase luminosa: en los tilacoides, produce ATP y NADPH.', 'Fase oscura (ciclo de Calvin): en el estroma, fija el CO₂.']],
  ['Mitosis y meiosis', 'La mitosis produce dos células hijas idénticas (crecimiento y reparación). La meiosis produce cuatro células con la mitad de cromosomas (gametos).', ['Fases de la mitosis: profase, metafase, anafase y telofase.', 'Meiosis I separa cromosomas homólogos; meiosis II separa cromátidas.', 'El sobrecruzamiento aumenta la variabilidad genética.']],
  ['Genética mendeliana', 'Mendel estudió la herencia con guisantes y describió cómo se transmiten los caracteres.', ['1ª ley: uniformidad de la primera generación.', '2ª ley: segregación de los caracteres.', '3ª ley: transmisión independiente.', 'Genotipo AA, Aa o aa; fenotipo dominante o recesivo.']],
];

let shown = null;
// show the study page; resolve when the right code is typed (disguise) or when release() is called (lockdown)
export function showDecoy({ reason = 'disguise' } = {}) {
  if (shown) { shown.reason = reason; return shown.promise; }
  const d = get(); let buf = ''; let done = null;
  const promise = new Promise((r) => { done = r; });
  const search = h('input.dc-search', { type: 'search', placeholder: 'Buscar en mis apuntes…', autocomplete: 'off', 'aria-label': 'Buscar' });
  const tryCode = async (txt) => { if (shown.reason !== 'disguise' || !d || !d.hash) return false; if (await sha(String(txt).trim().toLowerCase()) === d.hash) { open(); return true; } return false; };
  search.addEventListener('keydown', async (e) => { if (e.key === 'Enter') { e.preventDefault(); if (!(await tryCode(search.value))) { const q = search.value.toLowerCase(); const hit = [...el.querySelectorAll('.dc-sec')].find((s) => s.textContent.toLowerCase().includes(q)); if (hit) hit.scrollIntoView({ behavior: 'smooth' }); } search.value = ''; } });
  // typing the code anywhere on the page also works
  const onKey = async (e) => { if (e.target === search || e.ctrlKey || e.metaKey || e.altKey) return; if (e.key.length === 1) { buf = (buf + e.key).slice(-40); for (let i = 0; i < buf.length - 3; i++) if (await tryCode(buf.slice(i))) return; } };
  document.addEventListener('keydown', onKey, true);
  const today = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  const el = h('div.dc', { role: 'document' },
    h('header.dc-top', h('div.dc-logo', h('span', '✎'), h('b', 'Cuaderno de estudio')), search, h('span.dc-date', today)),
    h('div.dc-main',
      h('nav.dc-side', h('b', 'Biología · 3º ESO'), TOPICS.map(([tt], i) => h('a', { href: '#t' + i, onClick: (e) => { e.preventDefault(); el.querySelector('#dct' + i).scrollIntoView({ behavior: 'smooth' }); } }, (i + 1) + '. ' + tt)), h('b', { style: 'margin-top:16px' }, 'Próximas tareas'), h('div.dc-task', '☐ Resumen del tema 2'), h('div.dc-task', '☐ Ejercicios pág. 48'), h('div.dc-task', '☑ Esquema de la célula')),
      h('article.dc-doc', h('h1', 'Tema 2: La célula y la herencia'), h('p.dc-meta', 'Apuntes de clase · actualizado hoy'),
        TOPICS.map(([tt, p, list], i) => h('section.dc-sec', { id: 'dct' + i }, h('h2', (i + 1) + '. ' + tt), h('p', p), h('ul', list.map((x) => h('li', x))))),
        h('section.dc-sec', h('h2', 'Preguntas de repaso'), h('ol', ['¿Qué diferencia hay entre célula procariota y eucariota?', '¿Dónde ocurre la fase oscura de la fotosíntesis?', '¿Cuántas células se obtienen en la meiosis y cómo son?', 'Explica la segunda ley de Mendel con un ejemplo.'].map((x) => h('li', x)))))));
  document.body.append(el); document.documentElement.classList.add('dc-on'); const prevTitle = document.title; document.title = 'Cuaderno de estudio';
  const icon = document.querySelector('link[rel~="icon"]'); const prevIcon = icon && icon.href; if (icon) icon.href = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#2563eb"/><text x="16" y="23" font-size="18" text-anchor="middle" fill="#fff">✎</text></svg>');
  function open() { document.removeEventListener('keydown', onKey, true); el.remove(); document.documentElement.classList.remove('dc-on'); document.title = prevTitle; if (icon && prevIcon) icon.href = prevIcon; try { sessionStorage.setItem(SESSION, '1'); } catch {} const r = shown; shown = null; done(r.reason); }
  shown = { el, reason, promise, open };
  return promise;
}
export function releaseDecoy() { if (shown) shown.open(); }
export function decoyShowing() { return !!shown; }
// at start-up: show the disguise unless it was already opened in this tab
export function maybeDisguise() { if (!disguiseOn()) return null; try { if (sessionStorage.getItem(SESSION) === '1') return null; } catch {} return showDecoy({ reason: 'disguise' }); }
