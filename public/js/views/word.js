// Palabra del día: guess the secret 5-letter word in six tries. Same word for everyone, new one every day. #/word
import { h, mount, fmt } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { toast, toastErr, loading, emptyState, confetti } from '../ui.js';
import { sfx } from '../sfx.js';
import { icon } from '../icons.js';

const ROWS = [['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'], ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'Ñ'], ['ENTER', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', '⌫']];
const snd = (k) => { try { sfx[k] && sfx[k](); } catch {} };
const left = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`; };

export default {
  title: () => t('Word of the day'),
  async mount(root) {
    const inner = h('div.inner.wo'); mount(root, inner, loading()); let d; let cur = ''; let busyNow = false; let shake = -1; let reveal = -1;
    try { d = await api.get('/api/word'); } catch (e) { mount(inner, emptyState('alert', t('Could not load this'), e.message)); return () => {}; }
    const keyState = () => { const k = {}; for (const g of d.guesses) g.w.split('').forEach((c, i) => { k[c] = Math.max(k[c] ?? -1, g.r[i]); }); return k; };
    function paint() {
      const ks = keyState(); const rows = [];
      for (let i = 0; i < 6; i++) {
        const g = d.guesses[i]; const typing = !g && i === d.guesses.length && !d.done;
        const letters = g ? g.w.split('') : typing ? cur.padEnd(5).split('') : ['', '', '', '', ''];
        rows.push(h('div.wo-row' + (shake === i ? '.shake' : ''), letters.map((c, j) => h('div.wo-cell' + (g ? '.s' + g.r[j] + (reveal === i ? '.flip' : '') : c.trim() ? '.typed' : ''), { style: reveal === i ? { animationDelay: j * 0.12 + 's' } : null }, c.trim()))));
      }
      const st = d.stats;
      mount(inner,
        h('div.page-title', h('div', h('h2', icon('type', 24), ' ', t('Word of the day'), h('span.wo-no', ' #' + d.day)), h('p', t('Guess the secret 5-letter word in 6 tries. Green: right letter in the right place. Yellow: the letter is in the word. Grey: it is not. The same word for everyone, a new one every day.')))),
        h('div.wo-wrap',
          h('div.wo-board', rows),
          d.done ? h('div.wo-end' + (d.won ? '.won' : ''), h('b', d.won ? t('You got it in {n}!', { n: d.guesses.length }) : t('The word was {w}', { w: d.answer })), d.won ? h('div.coin', '+' + fmt.coins(d.coins)) : null,
            h('div.small.muted', t('Next word in {t}', { t: left(d.next - Date.now()) })), h('button.btn.primary', { onClick: share }, t('Share result'))) : null,
          h('div.wo-kb', ROWS.map((r) => h('div.wo-kr', r.map((k) => h('button.wo-k' + (k.length > 1 ? '.wide' : '') + (ks[k] === 2 ? '.s2' : ks[k] === 1 ? '.s1' : ks[k] === 0 ? '.s0' : ''), { type: 'button', disabled: d.done, onClick: () => press(k) }, k === 'ENTER' ? t('Enter') : k))))),
          h('div.wo-stats', [[st.played, t('Played')], [st.played ? Math.round((st.won / st.played) * 100) + '%' : '—', t('Won')], [st.streak, t('Streak')], [st.best, t('Best streak')]].map(([v, l]) => h('div', h('b', String(v)), h('span', l)))),
          h('p.tiny.muted', { style: 'text-align:center' }, t('Prize: {a} coins in 1 try … {b} in 6, plus 25 per day of streak.', { a: d.prize[0], b: d.prize[5] }))));
      reveal = -1; shake = -1;
    }
    async function press(k) {
      if (d.done || busyNow) return;
      if (k === '⌫' || k === 'BACKSPACE') { cur = cur.slice(0, -1); paint(); return; }
      if (k === 'ENTER') {
        if (cur.length < 5) { shake = d.guesses.length; paint(); toast(t('Not enough letters'), 'info', 1200); return; }
        busyNow = true; try { const was = d.guesses.length; d = await api.post('/api/word/guess', { w: cur }); cur = ''; reveal = was; snd(d.won ? 'win' : 'click'); paint(); if (d.done && d.won) setTimeout(() => confetti(innerWidth / 2, innerHeight / 3, 120), 700); } catch (e) { toastErr(e); } busyNow = false; return;
      }
      if (/^[A-ZÑ]$/.test(k) && cur.length < 5) { cur += k; paint(); }
    }
    function share() {
      const rows = d.guesses.map((g) => g.r.map((x) => (x === 2 ? '🟩' : x === 1 ? '🟨' : '⬛')).join('')).join('\n');
      const text = `Nebulix · ${t('Word of the day')} #${d.day} ${d.won ? d.guesses.length : 'X'}/6\n${rows}`;
      navigator.clipboard.writeText(text).then(() => toast(t('Copied! Paste it in a chat.'), 'good')).catch(() => toast(text, 'info', 8000));
    }
    const onKey = (e) => { if (!inner.isConnected || e.ctrlKey || e.metaKey || e.altKey) return; if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return; const k = e.key === 'Enter' ? 'ENTER' : e.key === 'Backspace' ? '⌫' : String(e.key || '').toUpperCase(); if (k === 'ENTER' || k === '⌫' || /^[A-ZÑ]$/.test(k)) { e.preventDefault(); press(k); } };
    document.addEventListener('keydown', onKey);
    paint();
    return () => document.removeEventListener('keydown', onKey);
  },
};
