// Nebulix Quiz: live quiz games with a PIN (host on one screen, players answer on theirs), solo practice and a
// quiz editor. #/quiz · #/quiz?pin=123456
import { h, mount, fmt } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { S, bus } from '../state.js';
import { icon } from '../icons.js';
import { toast, toastErr, loading, emptyState, busy, confirmBox, confetti } from '../ui.js';
import { sfx } from '../sfx.js';

const SHAPES = [['★', 'qz-a0'], ['☾', 'qz-a1'], ['◆', 'qz-a2'], ['●', 'qz-a3']];
const snd = (k) => { try { sfx[k] && sfx[k](); } catch {} };

export default {
  title: () => 'Nebulix Quiz',
  async mount(root, ctx) {
    const inner = h('div.inner.qz'); mount(root, inner);
    let live = null; let poll = 0; let tick = 0; const offs = [];
    const stopLive = () => { clearInterval(poll); clearInterval(tick); poll = 0; };
    // ---------- home ----------
    async function home() {
      stopLive(); live = null; mount(inner, loading());
      let cat; try { cat = await api.get('/api/quiz'); } catch (e) { mount(inner, emptyState('alert', t('Could not load this'), e.message)); return; }
      const pin = h('input.input.qz-pin', { inputmode: 'numeric', maxlength: 6, placeholder: 'PIN', autocomplete: 'off' });
      const joinB = h('button.btn.primary.qz-joinb', { onClick: () => busy(joinB, async () => { const p = pin.value.replace(/\D/g, ''); if (p.length !== 6) return toast(t('Enter the 6-digit PIN'), 'err'); try { enter(await api.post('/api/quiz/join', { pin: p })); } catch (e) { toastErr(e); } }) }, t('Join'));
      pin.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinB.click(); });
      const tile = (q) => h('div.qz-tile', h('div.qz-emoji', q.emoji), h('b', q.title), h('div.tiny.muted', t('{n} questions', { n: q.count }) + (q.owner && !q.mine ? ' · @' + q.owner : '')),
        h('div.row', { style: 'gap:6px;flex-wrap:wrap;justify-content:center' },
          h('button.btn.sm.primary', { onClick: (e) => busy(e.currentTarget, async () => { try { enter(await api.post('/api/quiz/host', { quiz: q.id })); } catch (er) { toastErr(er); } }) }, icon('users', 13), t('Host')),
          h('button.btn.sm', { onClick: () => solo(q.id) }, icon('play', 13), t('Practice')),
          q.mine ? h('button.btn.sm.ghost', { onClick: () => editor(q.id) }, icon('edit', 13)) : null));
      mount(inner,
        h('section.qz-hero', h('div.grow', h('h2.qz-logo', 'Nebulix ', h('span', 'Quiz')), h('p', t('Live quiz games: host one on a big screen and everyone answers from their own device. The fastest correct answers win.'))),
          h('div.qz-joinbox', h('b', t('Join a game')), h('div.row', { style: 'gap:8px' }, pin, joinB))),
        h('div.row', { style: 'justify-content:space-between;align-items:center;margin:18px 0 10px' }, h('h3', { style: 'margin:0' }, t('Quizzes')), h('button.btn', { onClick: () => editor(null) }, icon('plus', 14), t('Create a quiz'))),
        h('div.qz-grid', cat.builtin.map(tile), cat.mine.map(tile)),
        h('p.tiny.muted', t('Podium prizes (500/300/150 coins) are paid in games with 3 or more players, up to 5 prizes a day.')));
      setTimeout(() => pin.focus(), 50);
    }
    // ---------- live ----------
    function enter(snap) {
      live = snap; history.replaceState(history.state, '', '#/quiz?pin=' + snap.pin); paintLive();
      stopLive(); poll = setInterval(async () => { if (!live || document.hidden) return; try { const s = await api.get('/api/quiz/live/' + live.pin, { quiet: true }); if (s.state !== live.state || s.qi !== live.qi || s.players !== live.players || s.answered !== live.answered) { live = s; paintLive(); } } catch (e) { if (e.status === 404) { toast(t('The game has ended'), 'info'); home(); } } }, 2500);
      tick = setInterval(() => { const el = inner.querySelector('.qz-timer'); if (el && live && live.endsAt) { const s = Math.max(0, Math.ceil((live.endsAt - Date.now()) / 1000)); el.textContent = s; el.classList.toggle('low', s <= 5); } }, 250);
    }
    offs.push(bus.on('ws:quiz', (m) => { if (!live || m.pin !== live.pin) return; if (m.state === 'closed') { toast(t('The host closed the game'), 'info'); home(); return; } const was = live; live = m; if (m.state === 'reveal' && was.state !== 'reveal' && m.me && m.me.last) snd(m.me.last.ok ? 'win' : 'lose'); paintLive(); }));
    const ctl = (action) => async (e) => busy(e.currentTarget, async () => { try { live = await api.post('/api/quiz/live/' + live.pin + '/control', { action }); paintLive(); } catch (er) { toastErr(er); } });
    const leave = async () => { if (live && live.host && live.state !== 'end' && !(await confirmBox(t('Close this game for everyone?'), { danger: true }))) return; try { if (live) await api.post('/api/quiz/live/' + live.pin + '/leave'); } catch {} history.replaceState(history.state, '', '#/quiz'); home(); };
    function boardEl(list, n = 10) { return h('div.qz-board', list.slice(0, n).map((p, i) => h('div.qz-brow' + (p.id === S.me.id ? '.me' : ''), h('span.qz-brk', ['🥇', '🥈', '🥉'][i] || String(i + 1)), h('b.grow', p.name), h('span.mono', fmt.num(p.score)), p.streak > 1 ? h('span.qz-streak', '🔥' + p.streak) : null))); }
    function paintLive() {
      const L = live; const top = h('div.qz-bar', h('span.pill', 'PIN ' + L.pin), h('b.grow', L.title), L.state === 'question' || L.state === 'reveal' ? h('span.small.muted', t('Question {a} of {b}', { a: L.qi + 1, b: L.total })) : null, h('span.small.muted', icon('users', 13), ' ' + L.players), h('button.btn.sm.ghost', { onClick: leave }, icon('x', 14), L.host ? t('Close') : t('Leave')));
      let body;
      if (L.state === 'lobby') {
        body = L.host ? h('div.qz-lobby', h('div.small.muted', t('Join at Nebulix → Quiz with the PIN')), h('div.qz-bigpin', L.pin), h('div.qz-chips', L.board.map((p) => h('span.qz-chip', p.name))), L.players ? null : h('p.muted', t('Waiting for players…')), h('button.btn.primary.qz-go', { disabled: !L.players, onClick: ctl('start') }, icon('play', 16), t('Start')))
          : h('div.qz-lobby', h('div.qz-emoji-big', '🎮'), h('h2', t('You are in!')), h('p.muted', t('Waiting for {h} to start…', { h: L.hostName })), h('div.qz-chips', L.board.map((p) => h('span.qz-chip' + (p.id === S.me.id ? '.me' : ''), p.name))));
      } else if (L.state === 'question') {
        const answers = h('div.qz-answers', L.a.map((txt, i) => h('button.qz-ans.' + SHAPES[i][1] + (L.myAnswer === i ? '.picked' : ''), { disabled: L.host || L.myAnswer !== null && L.myAnswer !== undefined, onClick: async (e) => { if (L.host) return; e.currentTarget.classList.add('picked'); try { live = await api.post('/api/quiz/live/' + L.pin + '/answer', { i }); snd('click'); paintLive(); } catch (er) { toastErr(er); } } }, h('span.qz-shape', SHAPES[i][0]), h('span', txt))));
        body = h('div.qz-q', h('div.qz-qhead', h('div.qz-timer', Math.max(0, Math.ceil((L.endsAt - Date.now()) / 1000))), h('h2.grow', L.q), L.host ? h('div.qz-count', h('b', String(L.answered)), h('span.tiny', t('answers'))) : null),
          answers, !L.host && L.myAnswer !== null && L.myAnswer !== undefined ? h('p.qz-wait', t('Answer locked in. Waiting for the others…')) : null, L.host ? h('div.row', { style: 'justify-content:flex-end' }, h('button.btn', { onClick: ctl('next') }, t('Skip'))) : null);
      } else if (L.state === 'reveal') {
        const max = Math.max(1, ...L.dist);
        body = h('div.qz-q', h('h2', L.q),
          h('div.qz-dist', L.a.map((txt, i) => h('div.qz-dcol.' + SHAPES[i][1] + (i === L.c ? '.ok' : '.no'), h('b', String(L.dist[i])), h('i', { style: { height: Math.max(6, (L.dist[i] / max) * 120) + 'px' } }), h('span', SHAPES[i][0] + ' ' + (i === L.c ? '✔' : ''))))),
          h('div.qz-correct', '✔ ', L.a[L.c]),
          L.me ? h('div.qz-result' + (L.me.last && L.me.last.ok ? '.ok' : '.bad'), L.me.last && L.me.last.ok ? [h('b', t('Correct!')), ' +' + L.me.last.pts, L.me.streak > 1 ? ' · 🔥 ' + t('streak {n}', { n: L.me.streak }) : ''] : h('b', t('Not this time')), h('div.small', t('You are #{r} with {s} points', { r: L.me.rank, s: fmt.num(L.me.score) }))) : null,
          L.host ? [boardEl(L.board, 5), h('div.row', { style: 'justify-content:flex-end' }, h('button.btn.primary', { onClick: ctl('next') }, L.qi + 1 >= L.total ? t('Final results') : t('Next question'), icon('fwd', 14)))] : null);
      } else if (L.state === 'end') {
        const b = L.board; const pod = [b[1], b[0], b[2]];
        body = h('div.qz-end', h('h2', '🏆 ' + t('Final results')), h('div.qz-podium', pod.map((p, k) => p ? h('div.qz-pod.p' + [2, 1, 3][k], h('b', p.name), h('span.mono', fmt.num(p.score)), h('div.qz-step', ['🥈', '🥇', '🥉'][k])) : h('div'))),
          L.prizes && L.prizes.length ? h('p.small', t('Prizes: {p}', { p: L.prizes.map((x) => ['🥇', '🥈', '🥉'][x.rank - 1] + ' ' + fmt.coins(x.coins)).join('  ') })) : h('p.tiny.muted', t('Prizes need 3 or more players.')), boardEl(b, 50),
          h('button.btn.primary', { onClick: leave }, t('Back to quizzes')));
        if (!inner.querySelector('.qz-end')) setTimeout(() => confetti(innerWidth / 2, innerHeight / 3, 80), 200);
      } else body = emptyState('alert', t('The game has ended'), '');
      mount(inner, top, body);
    }
    // ---------- solo practice ----------
    async function solo(id) {
      stopLive(); let q; try { q = (await api.get('/api/quiz/q/' + id)).quiz; } catch (e) { toastErr(e); return; }
      let i = 0, score = 0, streak = 0, t0 = 0, timer = 0;
      const next = () => {
        clearInterval(timer); if (i >= q.questions.length) { mount(inner, h('div.qz-end', h('h2', '🎉 ' + t('Practice finished')), h('div.qz-bigpin', fmt.num(score)), h('p.muted', t('points')), h('div.row', { style: 'gap:8px;justify-content:center' }, h('button.btn.primary', { onClick: () => solo(id) }, t('Play again')), h('button.btn', { onClick: home }, t('Back to quizzes'))))); return; }
        const Q = q.questions[i]; t0 = Date.now(); const tm = h('div.qz-timer', String(Q.time));
        const pick = (k) => { clearInterval(timer); const ms = Date.now() - t0; const ok = k === Q.c; if (ok) { streak++; score += Math.round(1000 * (1 - ms / (Q.time * 1000) / 2)) + Math.min(5, streak - 1) * 100; snd('win'); } else { streak = 0; snd('lose'); }
          for (const [n, b] of [...inner.querySelectorAll('.qz-ans')].entries()) { b.disabled = true; b.classList.add(n === Q.c ? 'right' : 'wrong'); } setTimeout(() => { i++; next(); }, 1400); };
        mount(inner, h('div.qz-bar', h('b.grow', q.title + ' · ' + t('Practice')), h('span.small.muted', t('Question {a} of {b}', { a: i + 1, b: q.questions.length })), h('span.pill', fmt.num(score) + ' pts'), h('button.btn.sm.ghost', { onClick: () => { clearInterval(timer); home(); } }, icon('x', 14))),
          h('div.qz-q', h('div.qz-qhead', tm, h('h2.grow', Q.q)), h('div.qz-answers', Q.a.map((txt, k) => h('button.qz-ans.' + SHAPES[k][1], { onClick: () => pick(k) }, h('span.qz-shape', SHAPES[k][0]), h('span', txt))))));
        timer = setInterval(() => { const s = Math.max(0, Q.time - Math.floor((Date.now() - t0) / 1000)); tm.textContent = s; tm.classList.toggle('low', s <= 5); if (s <= 0) pick(-1); }, 250);
      };
      next();
    }
    // ---------- editor ----------
    async function editor(id) {
      stopLive(); let q = { title: '', emoji: '❓', public: false, questions: [{ q: '', a: ['', '', '', ''], c: 0, time: 20 }] };
      if (id) { try { q = (await api.get('/api/quiz/q/' + id)).quiz; q.questions = q.questions.map((x) => ({ ...x, a: [...x.a, '', '', '', ''].slice(0, 4) })); } catch (e) { toastErr(e); return; } }
      const paint = () => {
        const title = h('input.input', { value: q.title, maxlength: 60, placeholder: t('Quiz title'), onInput: (e) => { q.title = e.target.value; } });
        const emoji = h('input.input', { value: q.emoji || '❓', maxlength: 4, style: 'width:70px', onInput: (e) => { q.emoji = e.target.value; } });
        mount(inner, h('div.qz-bar', h('b.grow', id ? t('Edit quiz') : t('New quiz')), h('button.btn.ghost', { onClick: home }, t('Cancel')),
          id ? h('button.btn.ghost', { onClick: async () => { if (await confirmBox(t('Delete this quiz?'), { danger: true })) { await api.del('/api/quiz/q/' + id); home(); } } }, icon('trash', 14)) : null,
          h('button.btn.primary', { onClick: (e) => busy(e.currentTarget, async () => { try { const body = { id, title: q.title, emoji: q.emoji, public: q.public, questions: q.questions.map((x) => ({ q: x.q, a: x.a.filter((y) => y.trim()), c: x.c, time: x.time })) }; const r = await api.post('/api/quiz/save', body); id = r.id; toast(t('Quiz saved'), 'good'); home(); } catch (er) { toastErr(er); } }) }, icon('save', 14), t('Save'))),
          h('div.row', { style: 'gap:8px;margin:12px 0' }, emoji, title, h('label.row', { style: 'gap:6px;white-space:nowrap' }, h('input', { type: 'checkbox', checked: !!q.public, onChange: (e) => { q.public = e.target.checked; } }), t('Public'))),
          q.questions.map((x, n) => h('div.card.qz-edq', h('div.row', { style: 'gap:8px' }, h('b', String(n + 1)), h('input.input.grow', { value: x.q, maxlength: 160, placeholder: t('Question'), onInput: (e) => { x.q = e.target.value; } }),
            h('select.select', { onChange: (e) => { x.time = Number(e.target.value); } }, [10, 15, 20, 30, 45, 60].map((s) => h('option', { value: s, selected: s === x.time }, s + ' s'))),
            h('button.btn.ghost.icon.sm', { disabled: q.questions.length < 2, onClick: () => { q.questions.splice(n, 1); paint(); } }, icon('trash', 14))),
            h('div.qz-edans', x.a.map((a, k) => h('label.qz-eda.' + SHAPES[k][1], h('input', { type: 'radio', name: 'c' + n, checked: x.c === k, onChange: () => { x.c = k; } }), h('span.qz-shape', SHAPES[k][0]), h('input.input', { value: a, maxlength: 60, placeholder: k < 2 ? t('Answer {n}', { n: k + 1 }) : t('Answer {n} (optional)', { n: k + 1 }), onInput: (e) => { x.a[k] = e.target.value; } })))),
            h('div.tiny.muted', t('Tick the correct answer.')))),
          h('button.btn', { disabled: q.questions.length >= 40, onClick: () => { q.questions.push({ q: '', a: ['', '', '', ''], c: 0, time: 20 }); paint(); } }, icon('plus', 14), t('Add question')));
      };
      paint();
    }
    const pin0 = ctx.query && ctx.query.get('pin');
    if (pin0) { try { enter(await api.post('/api/quiz/join', { pin: pin0 })); } catch { home(); } } else home();
    return () => { stopLive(); offs.forEach((f) => f()); };
  },
};
