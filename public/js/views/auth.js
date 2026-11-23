// Login, sign-up, e-mail verification (6-digit code), password reset. Rendered instead of the app shell when signed out.
import { h, mount, $ } from '../util.js';
import { t, getLang, setLang, loadLang, LANGS } from '../i18n.js';
import { api, ApiError } from '../api.js';
import { S } from '../state.js';
import { icon, logoMark } from '../icons.js';
import { toast, busy, segEl, confetti } from '../ui.js';
import { sfx } from '../sfx.js';
import { routeMap } from '../fx/routes.js';

const RESEND_WAIT = 45;

function score(pw) {
  let s = 0;
  if (pw.length >= 8) s++; if (pw.length >= 12) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++; if (/[^A-Za-z0-9]/.test(pw)) s++;
  return Math.min(4, s);
}

function pwField(label, { autocomplete, meter = false, id } = {}) {
  const input = h('input.input', { type: 'password', autocomplete, required: true, id, maxlength: '128', style: 'padding-right:46px' });
  const eye = h('button.btn.ghost.icon', {
    type: 'button', 'aria-label': t('Show password'), tabindex: '-1',
    style: 'position:absolute;right:4px;top:50%;transform:translateY(-50%);padding:6px',
    onClick: () => { const show = input.type === 'password'; input.type = show ? 'text' : 'password'; eye.replaceChildren(icon(show ? 'eyeoff' : 'eye', 18)); },
  }, icon('eye', 18));
  const bar = h('i'); const hintEl = h('div.hint');
  const COL = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#10b981'];
  if (meter) {
    input.addEventListener('input', () => {
      const s = input.value ? score(input.value) : -1; bar.style.width = s < 0 ? '0' : (s + 1) * 20 + '%'; bar.style.background = COL[Math.max(0, s)];
      hintEl.textContent = s < 0 ? '' : [t('Very weak'), t('Weak'), t('Okay'), t('Strong'), t('Excellent')][s];
    });
  }
  const el = h('div.field', h('label', { for: id }, label), h('div', { style: 'position:relative' }, input, eye), meter ? h('div.strength', bar) : null, meter ? hintEl : null);
  return { el, input };
}

function codeInput(onComplete) {
  const boxes = Array.from({ length: 6 }, (_, i) => h('input.input', {
    type: 'text', inputmode: 'numeric', autocomplete: i === 0 ? 'one-time-code' : 'off', 'aria-label': t('Digit {n}', { n: i + 1 }), pattern: '[0-9]*', spellcheck: 'false',
  }));
  const el = h('div.codebox', boxes);
  const val = () => boxes.map((b) => b.value).join('');
  const spread = (digits, from) => { digits.split('').forEach((d, k) => { if (from + k < 6) boxes[from + k].value = d; }); const last = Math.min(5, from + digits.length); boxes[last].focus(); if (val().length === 6) onComplete(val()); };
  boxes.forEach((b, i) => {
    b.addEventListener('input', () => {
      const d = b.value.replace(/\D/g, '');
      if (d.length > 1) { b.value = ''; spread(d, i); return; }
      b.value = d; if (d && i < 5) boxes[i + 1].focus();
      if (val().length === 6) onComplete(val());
    });
    b.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !b.value && i > 0) { boxes[i - 1].value = ''; boxes[i - 1].focus(); e.preventDefault(); }
      else if (e.key === 'ArrowLeft' && i > 0) boxes[i - 1].focus(); else if (e.key === 'ArrowRight' && i < 5) boxes[i + 1].focus();
    });
    b.addEventListener('paste', (e) => { const d = ((e.clipboardData && e.clipboardData.getData('text')) || '').replace(/\D/g, ''); if (d) { e.preventDefault(); boxes.forEach((x) => (x.value = '')); spread(d.slice(0, 6), 0); } });
    b.addEventListener('focus', () => b.select());
  });
  el.value = val;
  el.fill = (code) => { boxes.forEach((x) => (x.value = '')); spread(String(code).replace(/\D/g, '').slice(0, 6), 0); };
  el.reset = () => { boxes.forEach((x) => (x.value = '')); boxes[0].focus(); el.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-8px)' }, { transform: 'translateX(8px)' }, { transform: 'translateX(0)' }], { duration: 280 }); };
  return el;
}

const FEATURES = [
  ['box3d', '3D Casino & avatars', 'Walk the casino with your own 3D character'], ['search', 'Nebulix Search', 'A private search engine that always works'],
  ['terminal', 'Code & Studio', 'Repositories and a pro code editor'], ['layers', 'Drive, Docs, Sheets, Slides', 'Your files and documents in the cloud'],
  ['upload', 'Nebulix Hub', 'Share videos, games and apps'], ['users', 'Community', 'Servers, roles, voice, encrypted DMs'],
];

export function renderAuth(root, onDone0, init) {
  // animated 3D space behind the sign-in screen (stopped as soon as you are in)
  import('../bg3d.js').then((m) => { if (!root.isConnected) return; m.startBg3d('space3d', ['#07061a', '#7c3aed', '#22d3ee'], 0.6); page.classList.add('has3d'); }).catch(() => {});
  const onDone = (...a) => { import('../bg3d.js').then((m) => m.stopBg3d()).catch(() => {}); return onDone0(...a); };
  const st = Object.assign({ mode: 'login', email: '', masked: '', dev: null, cooldown: 0, tick: null }, init || {});
  const page = h('div.auth');
  mount(root, page);

  const langSw = () => { const sel = h('select.select.auth-lang', { 'aria-label': 'Language', onChange: async () => { await loadLang(sel.value); draw(); } }, LANGS.map(([code, name]) => h('option', { value: code, selected: code === getLang() }, name))); return sel; };

  const swap = (mode, extra = {}) => { Object.assign(st, extra, { mode }); draw(); };
  const done = () => { clearInterval(st.tick); onDone(); };

  function startCooldown(btn) {
    clearInterval(st.tick); st.cooldown = RESEND_WAIT;
    const paint = () => { if (!btn.isConnected) { clearInterval(st.tick); return; } btn.disabled = st.cooldown > 0; btn.textContent = st.cooldown > 0 ? t('Resend code in {s}s', { s: st.cooldown }) : t('Resend code'); };
    paint(); st.tick = setInterval(() => { st.cooldown--; paint(); if (st.cooldown <= 0) clearInterval(st.tick); }, 1000);
  }

  // ---------- forms ----------
  function loginForm() {
    const id = h('input.input', { id: 'l-id', autocomplete: 'username', required: true, maxlength: '254', placeholder: t('Username or email') });
    const pw = pwField(t('Password'), { autocomplete: 'current-password', id: 'l-pw' });
    const err = h('div.error', { role: 'alert' });
    const btn = h('button.btn.primary.lg.block', { type: 'submit' }, t('Log in'));
    const form = h('form.col', { novalidate: true, onSubmit: (e) => { e.preventDefault(); err.textContent = ''; if (!id.value.trim() || !pw.input.value) { err.textContent = t('Enter your username/email and password'); return; }
      busy(btn, async () => {
        try {
          const r = await api.post('/api/auth/login', { id: id.value.trim(), password: pw.input.value }, { quiet: true });
          if (r.needsVerify) { swap('verify', { email: r.emailRaw, masked: r.email, dev: r.dev || null }); return; }
          if (r.needs2fa) { swap('tfa', { lid: id.value.trim(), lpw: pw.input.value }); return; }
          sfx.win(); done();
        } catch (ex) { err.textContent = ex.message; sfx.lose(); }
      }); } },
      h('h2', t('Welcome back')), h('p.muted.small', { style: 'margin-top:-6px' }, t('Log in to continue where you left off.')),
      h('div.field', h('label', { for: 'l-id' }, t('Username or email')), id), pw.el,
      h('div.row', h('button.btn.ghost.sm', { type: 'button', onClick: () => swap('forgot') }, t('Forgot password?'))),
      err, btn,
      h('div.center.small.muted', t('New here?') + ' ', h('button.btn.ghost.sm', { type: 'button', onClick: () => swap('signup') }, t('Create an account'))));
    setTimeout(() => id.focus(), 40);
    return form;
  }

  function signupForm() {
    const user = h('input.input', { id: 's-user', autocomplete: 'username', required: true, maxlength: '20', placeholder: 'VicStyles', spellcheck: 'false' });
    const mail = h('input.input', { id: 's-mail', type: 'email', autocomplete: 'email', maxlength: '254', placeholder: 'you@example.com' });
    const pw = pwField(t('Password'), { autocomplete: 'new-password', id: 's-pw', meter: true });
    const age = h('input', { type: 'checkbox', id: 's-age' });
    const err = h('div.error', { role: 'alert' });
    const btn = h('button.btn.primary.lg.block', { type: 'submit' }, t('Create account'));
    const open = !S.cfg || S.cfg.signups !== false;
    const form = h('form.col', { novalidate: true, onSubmit: (e) => { e.preventDefault(); err.textContent = '';
      const u = user.value.trim();
      if (!/^[A-Za-z0-9_]{3,20}$/.test(u)) { err.textContent = t('Username must be 3-20 characters: letters, numbers or _'); return; }
      if (mail.value.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail.value.trim())) { err.textContent = t('Enter a valid email address'); return; }
      if (pw.input.value.length < 8) { err.textContent = t('Password must be 8-128 characters'); return; }
      if (!age.checked) { err.textContent = t('Please confirm you are 13 or older.'); return; }
      busy(btn, async () => {
        try {
          const r = await api.post('/api/auth/signup', { username: u, email: mail.value.trim(), password: pw.input.value, lang: getLang() }, { quiet: true });
          if (!r.verify) { sfx.win(); if (!(S.cfg && S.cfg.canMail === false)) toast(t('Account created. Add an email any time to earn 50 coins and the Verified badge.'), 'good', 6000); done(); return; } // no email: you are in straight away
          swap('verify', { email: r.emailRaw || mail.value.trim(), masked: r.email, dev: r.dev || null });
        } catch (ex) { err.textContent = ex.message; }
      }); } },
      h('h2', t('Create your account')),
      S.cfg && S.cfg.canMail === false ? null : h('div.pill.accent', { style: 'align-self:flex-start' }, icon('gift', 13), t('Verify your email and get 50 coins + a Verified badge')),
      open ? null : h('div.error', t('Sign-ups are closed')),
      h('div.field', h('label', { for: 's-user' }, t('Username')), user), S.cfg && S.cfg.canMail === false ? null : h('div.field', h('label', { for: 's-mail' }, t('Email'), ' ', h('span.muted', '(' + t('optional') + ')')), mail, h('div.hint', t('Optional. With an email you can recover your password, and confirming it earns the reward.'))), pw.el,
      h('label.row.small', { style: 'cursor:pointer;align-items:flex-start' }, age, h('span', t('I am 13 or older and I will follow the community rules (be kind, no cheating, no abuse).'))),
      err, btn,
      h('div.center.small.muted', t('Already have an account?') + ' ', h('button.btn.ghost.sm', { type: 'button', onClick: () => swap('login') }, t('Log in'))));
    if (!open) btn.disabled = true;
    setTimeout(() => user.focus(), 40);
    return form;
  }

  function verifyForm() {
    const err = h('div.error', { role: 'alert', style: 'text-align:center;min-height:1.2em' });
    let busyNow = false;
    const submit = async (code) => {
      if (busyNow) return; busyNow = true; err.textContent = '';
      try {
        const r = await api.post('/api/auth/verify', { email: st.email, code }, { quiet: true });
        sfx.big(); confetti();
        toast(t('Welcome! You earned {n} coins and your Verified badge.', { n: r.welcome || 50 }), 'good', 6000);
        setTimeout(done, 650);
      } catch (ex) { busyNow = false; err.textContent = ex.message; sfx.lose(); box.reset(); if (ex.code === 'already_verified') swap('login'); }
    };
    const box = codeInput(submit);
    const resend = h('button.btn.sm', { type: 'button' }, t('Resend code'));
    resend.addEventListener('click', async () => {
      resend.disabled = true; err.textContent = '';
      try { const r = await api.post('/api/auth/resend', { email: st.email }, { quiet: true }); if (r.dev) { st.dev = r.dev; draw(); return; } toast(t('A new code is on its way.'), 'good'); startCooldown(resend); }
      catch (ex) { err.textContent = ex.message; resend.disabled = false; }
    });
    const dev = st.dev ? h('div.ann', { style: 'align-items:center' }, h('div.grow',
      h('b', t('Local mode')), h('div.small.muted', t('No email service is configured on this server, so your code is shown here instead:')),
      h('div', { style: 'font-family:var(--mono);font-size:1.7rem;font-weight:800;letter-spacing:.25em;margin-top:2px' }, st.dev)),
      h('button.btn.sm.primary', { type: 'button', onClick: () => box.fill(st.dev) }, t('Fill in'))) : null;
    const form = h('div.col', { style: 'gap:14px' },
      h('div.center.col', { style: 'align-items:center' }, h('div.empty-art', icon('mail', 26)), h('h2', { style: 'margin-top:10px' }, t('Check your email')),
        h('p.muted.small', t('We sent a 6-digit code to {e}. It expires in 10 minutes.', { e: st.masked || st.email })),
        h('p.muted.tiny', { style: 'margin-top:4px' }, t('You can also just open the link in that email.'))),
      dev, box, err,
      h('div.row', { style: 'justify-content:center;gap:8px;flex-wrap:wrap' }, resend, h('button.btn.ghost.sm', { type: 'button', onClick: () => swap('login') }, t('Back to log in'))),
      h('p.tiny.muted.center', t('Tip: also check your spam folder. Wrong email? Sign up again with the right one.')));
    setTimeout(() => { box.querySelector('input').focus(); startCooldown(resend); }, 40);
    return form;
  }

  function forgotForm() {
    const mail = h('input.input', { id: 'f-mail', type: 'email', autocomplete: 'email', required: true, placeholder: 'you@example.com', value: st.email || '' });
    const err = h('div.error', { role: 'alert' });
    const btn = h('button.btn.primary.lg.block', { type: 'submit' }, t('Send reset code'));
    const form = h('form.col', { novalidate: true, onSubmit: (e) => { e.preventDefault(); err.textContent = '';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail.value.trim())) { err.textContent = t('Enter a valid email address'); return; }
      busy(btn, async () => { try { await api.post('/api/auth/forgot', { email: mail.value.trim() }, { quiet: true }); swap('reset', { email: mail.value.trim() }); } catch (ex) { err.textContent = ex.message; } }); } },
      h('h2', t('Reset your password')), h('p.muted.small', { style: 'margin-top:-6px' }, t('Enter your email and we will send you a code if an account exists.')),
      h('div.field', h('label', { for: 'f-mail' }, t('Email')), mail), err, btn,
      h('div.center', h('button.btn.ghost.sm', { type: 'button', onClick: () => swap('login') }, t('Back to log in'))));
    setTimeout(() => mail.focus(), 40);
    return form;
  }

  function resetForm() {
    const code = codeInput(() => pw.input.focus());
    const pw = pwField(t('New password'), { autocomplete: 'new-password', id: 'r-pw', meter: true });
    const err = h('div.error', { role: 'alert' });
    const btn = h('button.btn.primary.lg.block', { type: 'submit' }, t('Change password'));
    const form = h('form.col', { novalidate: true, onSubmit: (e) => { e.preventDefault(); err.textContent = '';
      if (code.value().length !== 6) { err.textContent = t('Enter the 6-digit code'); return; }
      busy(btn, async () => {
        try { await api.post('/api/auth/reset', { email: st.email, code: code.value(), password: pw.input.value }, { quiet: true }); toast(t('Password changed. You can log in now.'), 'good'); swap('login'); }
        catch (ex) { err.textContent = ex.message; sfx.lose(); }
      }); } },
      h('h2', t('Enter your code')), h('p.muted.small', { style: 'margin-top:-6px' }, t('If an account exists for {e}, a code is on its way.', { e: st.email }) + ' ' + t('You can also just open the link in that email.')),
      code, pw.el, err, btn,
      h('div.center', h('button.btn.ghost.sm', { type: 'button', onClick: () => swap('login') }, t('Back to log in'))));
    setTimeout(() => code.querySelector('input').focus(), 40);
    return form;
  }

  // Second step of signing in: the 6-digit code from the authenticator app (or one of the backup codes).
  function tfaForm() {
    const code = h('input.input', { id: 't-code', type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '12', spellcheck: 'false', placeholder: '000000', style: 'text-align:center;font-family:var(--mono);font-size:1.5rem;letter-spacing:.25em;font-weight:700' });
    const err = h('div.error', { role: 'alert' });
    const btn = h('button.btn.primary.lg.block', { type: 'submit' }, t('Verify'));
    const send = () => busy(btn, async () => {
      err.textContent = '';
      try { await api.post('/api/auth/login', { id: st.lid, password: st.lpw, code: code.value.trim() }, { quiet: true }); st.lpw = ''; sfx.win(); done(); }
      catch (ex) { err.textContent = ex.message; sfx.lose(); code.select(); }
    });
    code.addEventListener('input', () => { if (/^\d{6}$/.test(code.value.trim())) send(); });
    const form = h('form.col', { novalidate: true, onSubmit: (e) => { e.preventDefault(); if (code.value.trim()) send(); } },
      h('div.center.col', { style: 'align-items:center' }, h('div.empty-art', icon('shield', 26)), h('h2', { style: 'margin-top:10px' }, t('Two-step verification')),
        h('p.muted.small', t('Enter the 6-digit code from your authenticator app. You can also use one of your backup codes.'))),
      code, err, btn,
      h('div.center', h('button.btn.ghost.sm', { type: 'button', onClick: () => { st.lpw = ''; swap('login'); } }, t('Back to log in'))));
    setTimeout(() => code.focus(), 40);
    return form;
  }

  // Opened from the link in the reset email: the code is already known, only the new password is asked.
  function newpassForm() {
    const pw = pwField(t('New password'), { autocomplete: 'new-password', id: 'n-pw', meter: true });
    const err = h('div.error', { role: 'alert' });
    const btn = h('button.btn.primary.lg.block', { type: 'submit' }, t('Change password'));
    const form = h('form.col', { novalidate: true, onSubmit: (e) => { e.preventDefault(); err.textContent = '';
      if (pw.input.value.length < 8) { err.textContent = t('Password must be 8-128 characters'); return; }
      busy(btn, async () => {
        try { await api.post('/api/auth/reset', { uid: st.uid, code: st.code, password: pw.input.value }, { quiet: true }); toast(t('Password changed. You can log in now.'), 'good'); swap('login'); }
        catch (ex) { err.textContent = ex.code === 'bad_code' || ex.code === 'code_expired' ? t('This link is no longer valid. Request a new one.') : ex.message; sfx.lose(); }
      }); } },
      h('h2', t('Choose a new password')), h('p.muted.small', { style: 'margin-top:-6px' }, t('You opened the link from your email. Pick a new password to finish.')),
      pw.el, err, btn,
      h('div.center', h('button.btn.ghost.sm', { type: 'button', onClick: () => swap('forgot') }, t('Send a new link')), h('button.btn.ghost.sm', { type: 'button', onClick: () => swap('login') }, t('Back to log in'))));
    setTimeout(() => pw.input.focus(), 40);
    return form;
  }

  // ---------- page ----------
  let map = null;
  function draw() {
    clearInterval(st.tick);
    const form = { login: loginForm, signup: signupForm, verify: verifyForm, forgot: forgotForm, reset: resetForm, newpass: newpassForm, tfa: tfaForm }[st.mode]();
    const feats = h('ul.feat', FEATURES.map(([ic, a, b]) => h('li', h('span.fi', icon(ic, 16)), h('span', h('b', t(a)), h('span', t(b))))));
    if (!map) map = routeMap();
    mount(page,
      h('section.auth-hero',
        h('div.auth-top', h('div.brand', logoMark(28, 'logo-draw'), 'Nebulix'), h('span.pill', 'v' + ((S.cfg && S.cfg.version) || '3.0'))),
        h('div.auth-visual', map),
        h('div.auth-copy',
          h('div.eyebrow', t('Nebulix 5 · The big update')),
          h('h1.auth-h1', t('Your whole internet,'), h('br'), h('span.auth-grad', t('in one place.'))),
          h('p.tag', t('Browse privately, play in a 3D casino, code, store files, write documents and hang out with your community — all in Nebulix.')),
          feats),
        h('div.auth-foot', h('span', t('Created by') + ' ', h('b', 'VicStyles')), h('span.muted', '·'), h('span.muted', t('Play money only. No real-money gambling.')))),
      h('section.auth-box', h('div.auth-card', h('div.row', { style: 'justify-content:flex-end;margin-bottom:18px' }, langSw()), h('div.auth-form', { key: st.mode }, form))));
  }
  draw();
}

export default { renderAuth };
