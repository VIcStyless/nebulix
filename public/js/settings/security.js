// Settings → Security: password, active sessions, end-to-end encryption keys, data export and account deletion.
import { h, mount, fmt, download } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { S, patchMe, setMe } from '../state.js';
import { icon } from '../icons.js';
import { toast, toastErr, field, settingRow, busy, confirmBox, promptBox, loading, modal } from '../ui.js';
import { addEmailFlow } from '../addemail.js';
import * as crypto from '../crypto.js';
import { lockSettings } from '../lock.js';

function pwStrength(s) {
  let n = 0; if (s.length >= 8) n++; if (s.length >= 12) n++; if (/[a-z]/.test(s) && /[A-Z]/.test(s)) n++; if (/\d/.test(s)) n++; if (/[^\w]/.test(s)) n++;
  return Math.min(4, n);
}

export default {
  mount(host) {
    let alive = true;
    // ---------- password ----------
    const cur = h('input.input', { type: 'password', autocomplete: 'current-password', placeholder: t('Current password') });
    const nw = h('input.input', { type: 'password', autocomplete: 'new-password', placeholder: t('New password') });
    const meter = h('div.pw-meter', h('i')); const pwHint = h('div.tiny.muted');
    nw.oninput = () => { const s = pwStrength(nw.value); meter.firstChild.style.width = (s / 4 * 100) + '%'; meter.dataset.s = s; pwHint.textContent = nw.value.length < 8 ? t('At least 8 characters.') : [t('Weak'), t('Okay'), t('Good'), t('Strong'), t('Very strong')][s]; };
    const pwBtn = h('button.btn.primary', {}, t('Change password'));
    pwBtn.onclick = () => busy(pwBtn, async () => {
      if (nw.value.length < 8) return toast(t('Choose a password of at least 8 characters.'), 'err');
      try { await api.post('/api/auth/password', { current: cur.value, next: nw.value }); cur.value = nw.value = ''; nw.oninput(); toast(t('Password changed. Other devices were signed out.'), 'good', 3500); loadSessions(); } catch (e) { toastErr(e); }
    });

    // ---------- two-step verification ----------
    const tfaBox = h('div'); const checkBox = h('div.sec-check'); const loginBox = h('div.col', { style: 'gap:6px' }, loading());
    const copy = async (txt) => { try { await navigator.clipboard.writeText(txt); toast(t('Copied'), 'good'); } catch { toast(txt); } };
    function showBackupCodes(codes) {
      modal({ title: t('Save your backup codes'), cls: 'narrow', body: h('div.col', { style: 'gap:12px' },
        h('p.small.muted', { style: 'margin:0' }, t('Each code works once if you lose your phone. Keep them somewhere safe: they will not be shown again.')),
        h('div.sec-codes', codes.map((c) => h('code', c))),
        h('div.row.wrap', h('button.btn.sm', { onClick: () => copy(codes.join('\n')) }, icon('copy', 15), t('Copy')), h('button.btn.sm', { onClick: () => download('nebulix-backup-codes.txt', 'Nebulix backup codes (' + S.me.username + ')\n\n' + codes.join('\n') + '\n') }, icon('download', 15), t('Download')))),
        actions: [{ label: t('I saved them'), kind: 'primary' }] });
    }
    async function enableTfa() {
      const pass = await promptBox(t('Turn on two-step verification'), { label: t('Enter your password'), type: 'password' }); if (!pass) return;
      let s; try { s = await api.post('/api/auth/2fa/setup', { password: pass }); } catch (e) { return toastErr(e); }
      const code = h('input.input', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6', placeholder: '000000', style: 'text-align:center;font-family:var(--mono);font-size:1.4rem;letter-spacing:.25em;font-weight:700' });
      const err = h('div.error', { role: 'alert', style: 'min-height:1.2em' }); let m = null;
      const go = h('button.btn.primary.block', { type: 'submit' }, t('Turn on'));
      const submit = () => busy(go, async () => {
        err.textContent = '';
        try { const r = await api.post('/api/auth/2fa/enable', { code: code.value.trim() }, { quiet: true }); if (r.user) setMe(r.user); if (m) m.close(); toast(t('Two-step verification is on. Other devices were signed out.'), 'good', 5000); paintTfa(); paintCheck(); loadSessions(); showBackupCodes(r.codes); }
        catch (e) { err.textContent = e.message; code.select(); }
      });
      m = modal({ title: t('Set up your authenticator app'), cls: 'narrow', body: h('div.col', { style: 'gap:12px' },
        h('p.small.muted', { style: 'margin:0' }, t('1. Open an authenticator app (Google Authenticator, Microsoft Authenticator, Aegis, 2FAS…) and add an account by entering this key:')),
        h('div.sec-key', h('code', s.secret.replace(/(.{4})/g, '$1 ').trim()), h('button.btn.sm', { type: 'button', onClick: () => copy(s.secret) }, icon('copy', 15), t('Copy'))),
        h('a.btn.sm.ghost', { href: s.uri, style: 'align-self:flex-start' }, icon('external', 15), t('On this phone? Open it in the app')),
        h('p.small.muted', { style: 'margin:0' }, t('2. Type the 6-digit code the app shows:')),
        h('form.col', { novalidate: true, onSubmit: (e) => { e.preventDefault(); submit(); } }, code, err, go)), actions: [{ label: t('Cancel') }] });
      setTimeout(() => code.focus(), 60);
    }
    async function disableTfa() {
      const pass = await promptBox(t('Turn off two-step verification'), { label: t('Enter your password'), type: 'password' }); if (!pass) return;
      const code = await promptBox(t('Turn off two-step verification'), { label: t('Code from your app, or a backup code') }); if (!code) return;
      try { const r = await api.post('/api/auth/2fa/disable', { password: pass, code }); if (r.user) setMe(r.user); toast(t('Two-step verification is off.'), 'good'); paintTfa(); paintCheck(); } catch (e) { toastErr(e); }
    }
    function paintTfa() {
      const on = !!S.me.tfa;
      mount(tfaBox, settingRow(on ? t('On') : t('Off'), on ? t('Signing in needs your password and a code from your authenticator app.') : t('Add a second lock: even with your password, nobody gets in without the code from your phone.'),
        on ? h('button.btn.sm', { onClick: disableTfa }, t('Turn off')) : h('button.btn.primary.sm', { onClick: enableTfa }, icon('shield', 15), t('Turn on'))));
    }
    // ---------- security check-up ----------
    let otherSessions = 0;
    function paintCheck() {
      const items = [
        [!!S.me.tfa, t('Two-step verification'), S.me.tfa ? t('On') : t('Off — turn it on below'), null],
        [!S.me.noEmail, t('Recovery email'), S.me.noEmail ? t('None — without it a forgotten password cannot be recovered') : t('Confirmed'), S.me.noEmail && !(S.cfg && S.cfg.canMail === false) ? () => addEmailFlow() : null],
        [!S.me.hasKey || S.me.hasBackup, t('Encryption key backup'), !S.me.hasKey ? t('Not needed yet') : S.me.hasBackup ? t('Saved') : t('Missing — back up your key below'), null],
        [otherSessions === 0, t('Other devices'), otherSessions ? t('{n} other session(s) open', { n: otherSessions }) : t('Only this device is signed in'), null],
      ];
      const score = items.filter((x) => x[0]).length;
      mount(checkBox, h('div.sec-score' + (score === items.length ? '.ok' : score >= 2 ? '.mid' : '.bad'), h('b', score + '/' + items.length), h('span', score === items.length ? t('Your account is well protected.') : t('Your account can be safer.'))),
        items.map(([ok, name, note, fix]) => h('div.sec-item' + (ok ? '.ok' : ''), icon(ok ? 'check' : 'alert', 16), h('div.grow', h('b', name), h('div.tiny.muted', note)), fix ? h('button.btn.sm', { onClick: fix }, t('Fix')) : null)));
    }
    async function loadLogins() {
      try {
        const r = await api.get('/api/auth/logins'); if (!alive) return;
        mount(loginBox, r.logins.length ? r.logins.map((l) => h('div.set-row', icon(l.ok ? 'check' : 'alert', 18), h('div.grow', h('b', l.ok ? t('Signed in') : t('Failed attempt'), l.here ? h('span.pill.ok', { style: 'margin-left:6px' }, t('This device')) : null), h('div.tiny.muted', (l.ua || t('Unknown device')).slice(0, 70))), h('span.tiny.muted', fmt.rel(l.t)))) : h('p.small.muted', t('Sign-ins will be listed here from now on.')),
          S.me.tfa ? h('p.tiny.muted', t('Backup codes left: {n}', { n: r.backupLeft })) : null);
      } catch (e) { if (alive) mount(loginBox, h('span.error', e.message)); }
    }

    // ---------- sessions ----------
    const sessBox = h('div.col', { style: 'gap:6px' }, loading());
    async function loadSessions() {
      try {
        const r = await api.get('/api/auth/sessions'); if (!alive) return; otherSessions = r.sessions.filter((x) => !x.current).length; paintCheck();
        mount(sessBox, r.sessions.map((s) => h('div.set-row',
          icon(s.current ? 'monitor' : 'globe', 18), h('div.grow', h('b', (s.ua || t('Unknown device')).slice(0, 60), s.current ? h('span.pill.ok', { style: 'margin-left:6px' }, t('This device')) : null), h('div.tiny.muted', t('Last active {d}', { d: fmt.rel(s.last) }))),
          s.current ? null : h('button.btn.sm', { onClick: async () => { try { await api.post('/api/auth/sessions/revoke', { id: s.id }); loadSessions(); } catch (e) { toastErr(e); } } }, t('Sign out')))));
      } catch (e) { if (alive) mount(sessBox, h('span.error', e.message)); }
    }
    const revokeAll = h('button.btn.sm.ghost', { onClick: async () => { if (await confirmBox(t('Sign out of every other device?'))) { try { await api.post('/api/auth/sessions/revoke', { all: true }); toast(t('Other devices signed out.'), 'good'); loadSessions(); } catch (e) { toastErr(e); } } } }, icon('logout', 15), t('Sign out everywhere else'));

    // ---------- encryption ----------
    const encBox = h('div');
    async function loadEnc() {
      mount(encBox, loading());
      if (!crypto.supported()) return mount(encBox, h('p.muted.small', t('This browser cannot do end-to-end encryption, so encrypted DMs are unavailable here.')));
      let st; try { st = await crypto.state(); } catch (e) { return mount(encBox, h('span.error', e.message)); }
      if (!alive) return;
      const badge = { ready: ['ok', t('Active')], 'ready-unpublished': ['', t('Local only')], none: ['', t('Not set up')], restore: ['bad', t('Key needed on this device')], mismatch: ['bad', t('Key mismatch')] }[st.s] || ['', st.s];
      const rows = [settingRow(t('Status'), st.pub ? t('Your messages are end-to-end encrypted.') : t('Set up a key to send and read encrypted DMs.'), h('span.pill.' + (badge[0] || ''), badge[1]))];
      const mkBtn = (label, kind, fn) => { const b = h('button.btn' + (kind ? '.' + kind : ''), {}, label); b.onclick = () => busy(b, fn); return b; };
      const actions = [];
      if (st.s === 'none') actions.push(mkBtn(t('Set up encryption'), 'primary', async () => { try { await crypto.createKeys(); patchMe({ hasKey: true }); toast(t('Encryption ready.'), 'good'); loadEnc(); } catch (e) { toastErr(e); } }));
      if (st.s === 'ready-unpublished') actions.push(mkBtn(t('Publish my key'), 'primary', async () => { try { await crypto.publishLocal(); toast(t('Key published.'), 'good'); loadEnc(); } catch (e) { toastErr(e); } }));
      if (st.s === 'restore' || st.s === 'mismatch') {
        if (st.hasBackup) actions.push(mkBtn(t('Restore from backup'), 'primary', async () => {
          const pass = await promptBox(t('Restore your key'), { label: t('Backup passphrase'), type: 'password' }); if (!pass) return;
          try { await crypto.restore(pass); toast(t('Key restored on this device.'), 'good'); loadEnc(); } catch (e) { toastErr(e); }
        }));
        actions.push(mkBtn(t('Create a new key'), 'danger', async () => { if (await confirmBox(t('Older encrypted messages will become unreadable. Continue?'), { danger: true })) { try { await crypto.resetKeys(); patchMe({ hasKey: true }); toast(t('New key created.'), 'good'); loadEnc(); } catch (e) { toastErr(e); } } }));
      }
      if (st.s === 'ready' || st.s === 'ready-unpublished') {
        actions.push(mkBtn(S.me.hasBackup ? t('Update encrypted backup') : t('Back up my key'), '', async () => {
          const pass = await promptBox(t('Encrypt a backup of your key'), { label: t('Choose a passphrase (8+ characters)'), type: 'password', hint: t('You will need this to restore your key on another device. We cannot recover it for you.'), validate: (v) => (v.length < 8 ? t('At least 8 characters.') : null) }); if (!pass) return;
          try { await crypto.backup(pass); patchMe({ hasBackup: true }); toast(t('Encrypted backup saved.'), 'good'); loadEnc(); } catch (e) { toastErr(e); }
        }));
        if (S.me.hasBackup) actions.push(mkBtn(t('Remove backup'), 'ghost', async () => { if (await confirmBox(t('Remove the stored backup of your key?'), { danger: true })) { try { await crypto.removeBackup(); patchMe({ hasBackup: false }); loadEnc(); } catch (e) { toastErr(e); } } }));
      }
      mount(encBox, rows, actions.length ? h('div.row.wrap', { style: 'margin-top:10px' }, actions) : null);
    }

    // ---------- data / danger ----------
    const exportBtn = h('button.btn', {}, icon('download', 16), t('Download my data'));
    exportBtn.onclick = () => busy(exportBtn, async () => { try { const data = await api.get('/api/auth/export'); download('nebulix-data.json', JSON.stringify(data, null, 2)); toast(t('Your data was exported.'), 'good'); } catch (e) { toastErr(e); } });
    const delBtn = h('button.btn.danger', {}, icon('trash', 16), t('Delete my account'));
    delBtn.onclick = async () => {
      if (S.me.role === 'owner') return toast(t('The owner account cannot be deleted here.'), 'err');
      if (!(await confirmBox(t('This permanently deletes your account, cosmetics and coins. This cannot be undone.'), { danger: true, ok: t('Continue') }))) return;
      const pw = await promptBox(t('Confirm account deletion'), { label: t('Enter your password'), type: 'password' }); if (!pw) return;
      try { await api.post('/api/auth/delete', { password: pw }); location.reload(); } catch (e) { toastErr(e); }
    };

    mount(host,
      h('section.card', h('h3', icon('shield', 18), t('Security check-up')), checkBox),
      h('section.card', h('h3', icon('lock', 18), t('Screen lock')), lockSettings()),
      h('section.card', h('h3', icon('lock', 18), t('Two-step verification')), tfaBox),
      h('section.card', h('h3', icon('key', 18), t('Password')),
        field(t('Current password'), cur), field(t('New password'), nw), meter, pwHint, h('div.row', { style: 'margin-top:10px' }, pwBtn)),
      h('section.card', h('h3', icon('monitor', 18), t('Active sessions')),
        sessBox, h('div.row', { style: 'margin-top:10px' }, revokeAll)),
      h('section.card', h('h3', icon('clock', 18), t('Recent sign-ins')), loginBox),
      h('section.card', h('h3', icon('lock', 18), t('Encryption keys')), encBox),
      h('section.card', h('h3', icon('shield', 18), t('Your data')),
        settingRow(t('Export'), t('Download everything your account holds as a JSON file.'), exportBtn),
        settingRow(t('Delete account'), t('Permanently remove your account and all its data.'), delBtn)));
    paintTfa(); paintCheck(); loadSessions(); loadLogins(); loadEnc();
    return () => { alive = false; };
  },
};
