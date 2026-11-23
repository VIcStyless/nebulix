// Live progression feedback: level-up celebration, achievement unlocks and finished quests (from ws "prog" events).
import { h } from './util.js';
import { badgeGlyph } from './cosmetics.js';
import { t } from './i18n.js';
import { toast, confetti } from './ui.js';
import { sfx } from './sfx.js';

let defs = null;
export async function progressDefs() {
  if (defs) return defs;
  try { defs = await (await fetch('/data/progress.json')).json(); } catch { defs = { achievements: [], quests: [] }; }
  return defs;
}
export const RARITY = { common: '#94a3b8', rare: '#38bdf8', epic: '#a855f7', legendary: '#f59e0b' };

export function levelUp(lu) {
  if (!lu) return; sfx.big();
  const ov = h('div.lvl-ov', { role: 'status', onClick: () => close() }, h('div.lvl-rays'), h('div.lvl-card', h('div.lvl-k', t('Level up!')), h('div.lvl-n', String(lu.to)), lu.coins ? h('div.lvl-c', h('span.coin', '+' + lu.coins)) : null, h('div.tiny.muted', t('Tap to continue'))));
  document.body.appendChild(ov); confetti(innerWidth / 2, innerHeight / 2.4, 140);
  const timer = setTimeout(() => close(), 3800);
  function close() { clearTimeout(timer); ov.classList.add('out'); setTimeout(() => ov.remove(), 400); }
}
export async function onProg(m) {
  if (m.levelUp) levelUp(m.levelUp);
  if ((m.unlocked && m.unlocked.length) || (m.questDone && m.questDone.length)) {
    const d = await progressDefs();
    for (const id of m.unlocked || []) {
      const a = d.achievements.find((x) => x.id === id); if (!a) continue;
      sfx.win();
      const el = h('div.ach-toast', { style: `--rc:${RARITY[a.rarity] || RARITY.common}` }, h('span.ach-ic', badgeGlyph(a.icon)), h('div', h('div.tiny.ach-k', t('Achievement unlocked') + ' · ' + t(a.rarity[0].toUpperCase() + a.rarity.slice(1))), h('b', t(a.name)), a.coins ? h('div.tiny', '+' + a.coins) : null));
      toast(el, 'coin', 6500);
    }
    for (const id of m.questDone || []) { const q = d.quests.find((x) => x.id === id); if (q) toast(`${t('Quest complete: {q}', { q: t(q.name, { n: q.goal }) })} — ${t('claim it in Achievements')}`, 'good', 6000); }
  }
}
