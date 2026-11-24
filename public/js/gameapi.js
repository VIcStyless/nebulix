// Nebulix 3.0 Game API — the page side. Hub games call window.Nebulix.submitScore(n, label?), Nebulix.leaderboard()
// and Nebulix.me() (injected by server/hubshim.js); the request arrives here by postMessage from that game's frame only,
// and the answer goes back to the same frame. Returns a function that stops listening.
import { api } from './api.js';
import { S } from './state.js';
import { toast } from './ui.js';
import { t } from './i18n.js';

export function gameApi(frame, itemId, { onBoard } = {}) {
  const reply = (req, data) => { try { frame.contentWindow.postMessage({ nxHubRes: 1, req, data }, '*'); } catch {} };
  const onMsg = async (e) => {
    if (!frame.isConnected) { removeEventListener('message', onMsg); return; }
    const d = e.data; if (e.source !== frame.contentWindow || !d || d.nxHubApi !== 1) return;
    try {
      if (d.op === 'score') { const r = await api.post(`/api/hub/${itemId}/board`, { score: d.score, label: d.label }, { quiet: true }); if (r.pb) toast(t('New best in this game: {s} (rank #{r})', { s: r.best, r: r.rank }), 'good', 2500); reply(d.req, r); if (onBoard) onBoard(); }
      else if (d.op === 'board') reply(d.req, await api.get(`/api/hub/${itemId}/board`, { quiet: true }));
      else if (d.op === 'me') reply(d.req, S.me ? { username: S.me.username, displayName: S.me.displayName || S.me.username, lang: document.documentElement.lang || 'es' } : null);
      else reply(d.req, null);
    } catch { reply(d.req, null); }
  };
  addEventListener('message', onMsg);
  return () => removeEventListener('message', onMsg);
}
