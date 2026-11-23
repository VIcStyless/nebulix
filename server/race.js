'use strict';
// Weekly coin race (13.8): who earns the most coins this week by playing and studying (Monday to Sunday, UTC).
// Only earned coins count — not transfers, trades, the casino, bets, the bank or staff gifts — so it cannot be bought.
// When the week ends the top 10 get prizes automatically and a notice.
const { S, hub, publicUser } = require('./state');
const COUNTS = /^(work|worlds|tournament|season|boss|achievement|word|study|ranked|quiz|quest|level-up|league|fusion|dash|daily|ctf|arena|arcade|kill|royale|ops|mission|progress)\b/;
const PRIZES = [5000, 3000, 2000, 1000, 800, 600, 500, 400, 300, 200];
function weekKey(t = Date.now()) { const d = new Date(t); const day = (d.getUTCDay() + 6) % 7; const mon = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day); return new Date(mon).toISOString().slice(0, 10); }
const weekEnd = (t = Date.now()) => Date.parse(weekKey(t) + 'T00:00:00Z') + 7 * 86400000;
function race() { const r = (S.meta.race = S.meta.race || { week: weekKey(), scores: {} }); if (r.week !== weekKey()) settle(); return S.meta.race; }
function settle() {
  const r = S.meta.race; if (!r) return; const top = Object.entries(r.scores || {}).filter(([id]) => S.users[id] && !S.users[id].deleted).sort((a, b) => b[1] - a[1]).slice(0, PRIZES.length);
  S.meta.race = { week: weekKey(), scores: {}, last: { week: r.week, winners: top.map(([id, n], i) => ({ id, n, prize: PRIZES[i] })) } }; S.store.touch('meta');
  top.forEach(([id], i) => { const u = S.users[id]; try { require('./economy').adjust(u, PRIZES[i], 'race:prize'); } catch {} hub.push(id, { t: 'notice', text: `Weekly coin race: you finished #${i + 1} and won ${PRIZES[i]} coins!`, es: `Carrera semanal de monedas: has quedado #${i + 1} y ganas ${PRIZES[i]} monedas.` }); });
}
function record(u, delta, reason) { if (!u || delta <= 0 || u.infinite || u.deleted || !COUNTS.test(String(reason || ''))) return; const r = race(); r.scores[u.id] = (r.scores[u.id] || 0) + Math.trunc(delta); S.store.touch('meta'); }
function view(u) {
  const r = race(); const list = Object.entries(r.scores).filter(([id]) => S.users[id]).sort((a, b) => b[1] - a[1]); const me = list.findIndex(([id]) => id === u.id);
  return { week: r.week, ends: weekEnd(), prizes: PRIZES, top: list.slice(0, 20).map(([id, n], i) => ({ rank: i + 1, n, user: publicUser(S.users[id]), prize: PRIZES[i] || 0 })), me: { rank: me >= 0 ? me + 1 : null, n: r.scores[u.id] || 0 }, last: r.last ? { week: r.last.week, winners: r.last.winners.slice(0, 3).map((w) => ({ n: w.n, prize: w.prize, user: S.users[w.id] ? publicUser(S.users[w.id]) : null })) } : null };
}
setInterval(() => { try { race(); } catch (e) { console.error('[race]', e.message); } }, 3600000).unref();
module.exports = { record, view, weekKey, settle, COUNTS };
