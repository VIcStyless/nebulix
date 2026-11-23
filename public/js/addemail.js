// Add an email to an account that was created without one. Confirming it pays the welcome coins and unlocks the Verified badge.
import { h, mount } from './util.js';
import { t } from './i18n.js';
import { api } from './api.js';
import { setMe } from './state.js';
import { icon } from './icons.js';
import { modal, toast, busy, confetti } from './ui.js';
import { sfx } from './sfx.js';

export function addEmailFlow() {
  const body = h('div.col', { style: 'gap:12px' }); let m = null;
  const err = h('div.error', { role: 'alert', style: 'min-height:1.2em' });

  function stepEmail() {
    const mail = h('input.input', { type: 'email', autocomplete: 'email', maxlength: '254', placeholder: 'you@example.com' });
    const btn = h('button.btn.primary.block', { type: 'submit' }, icon('mail', 16), t('Send code'));
    const form = h('form.col', { novalidate: true, onSubmit: (e) => { e.preventDefault(); err.textContent = '';
      const v = mail.value.trim(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) { err.textContent = t('Enter a valid email address'); return; }
      busy(btn, async () => { try { const r = await api.post('/api/auth/email', { email: v }, { quiet: true }); stepCode(r.email || v, r.dev || null); } catch (ex) { err.textContent = ex.message; } }); } },
      h('div.pill.accent', { style: 'align-self:flex-start' }, icon('gift', 13), t('Verify your email and get 50 coins + a Verified badge')),
      h('p.small.muted', { style: 'margin:0' }, t('An email also lets you recover your account if you forget the password.')),
      h('div.field', h('label', t('Email')), mail), err, btn);
    mount(body, form); setTimeout(() => mail.focus(), 60);
  }
  function stepCode(masked, dev) {
    err.textContent = '';
    const code = h('input.input', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6', placeholder: '000000', style: 'text-align:center;font-family:var(--mono);font-size:1.5rem;letter-spacing:.3em;font-weight:700' });
    const btn = h('button.btn.primary.block', { type: 'submit' }, t('Verify'));
    const submit = () => { err.textContent = ''; const v = code.value.replace(/\D/g, ''); if (v.length !== 6) { err.textContent = t('Enter the 6-digit code'); return; }
      busy(btn, async () => { try { const r = await api.post('/api/auth/email/verify', { code: v }, { quiet: true }); if (r.user) setMe(r.user); sfx.big(); confetti();
        toast(t('Welcome! You earned {n} coins and your Verified badge.', { n: r.welcome || 50 }), 'good', 6000); if (m) m.close(); } catch (ex) { err.textContent = ex.message; sfx.lose(); code.select(); } }); };
    code.addEventListener('input', () => { code.value = code.value.replace(/\D/g, '').slice(0, 6); if (code.value.length === 6) submit(); });
    mount(body,
      h('p.small.muted', { style: 'margin:0' }, t('We sent a 6-digit code to {e}. It expires in 10 minutes.', { e: masked }) + ' ' + t('You can also just open the link in that email.')),
      dev ? h('div.ann', h('div.grow', h('b', t('Local mode')), h('div.small.muted', t('No email service is configured on this server, so your code is shown here instead:')), h('div.mono', { style: 'font-size:1.4rem;font-weight:800;letter-spacing:.2em' }, dev))) : null,
      h('form.col', { novalidate: true, onSubmit: (e) => { e.preventDefault(); submit(); } }, code, err, btn),
      h('button.btn.ghost.sm', { type: 'button', onClick: stepEmail }, t('Use a different email')));
    setTimeout(() => code.focus(), 60);
  }
  stepEmail();
  m = modal({ title: t('Add your email'), cls: 'narrow', body, actions: [{ label: t('Not now') }] });
  return m;
}
