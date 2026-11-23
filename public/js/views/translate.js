// Translator page: two panes, language pickers with swap, auto-translate while typing, copy, history.
import { h, mount, ls, debounce } from '../util.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { toast, toastErr } from '../ui.js';
import { translate, languages, myLang } from '../translator.js';

export default {
  title: () => t('Translator'),
  async mount(root, ctx) {
    const info = await languages(); const L = info.langs;
    let from = ls('tr.from') || ''; let to = ls('tr.to') || (myLang() === 'en' ? 'es' : myLang());
    const opt = (sel, auto) => [auto ? h('option', { value: '' }, t('Detect language')) : null, ...Object.entries(L).map(([k, v]) => h('option', { value: k, selected: k === sel }, t(v)))];
    const fromSel = h('select.select', { 'aria-label': t('From'), onChange: () => { from = fromSel.value; ls('tr.from', from); run(); } }, opt(from, true));
    const toSel = h('select.select', { 'aria-label': t('To'), onChange: () => { to = toSel.value; ls('tr.to', to); run(); } }, opt(to, false));
    const src = h('textarea.input.tr-src', { maxlength: 2000, placeholder: t('Type or paste text…'), value: ctx.query && ctx.query.get('q') ? ctx.query.get('q') : '' });
    const out = h('div.tr-out'); const count = h('span.tiny.muted'); const engine = h('span.tiny.muted');
    const hist = h('div.tr-hist');
    const swap = h('button.btn.ghost.icon', { title: t('Swap languages'), 'aria-label': t('Swap languages'), onClick: () => {
      if (!from) return toast(t('Pick the source language first to swap.'));
      [from, to] = [to, from]; fromSel.value = from; toSel.value = to; ls('tr.from', from); ls('tr.to', to);
      const o = out.textContent; if (o) src.value = o; run();
    } }, icon('swap', 17));
    const copy = h('button.btn.sm', { onClick: async () => { if (!out.textContent) return; try { await navigator.clipboard.writeText(out.textContent); toast(t('Copied!'), 'good', 1200); } catch {} } }, icon('copy', 14), t('Copy'));
    let seq = 0;
    async function run() {
      const text = src.value.trim(); count.textContent = src.value.length + ' / 2000';
      if (!text) { out.textContent = ''; out.classList.remove('busy'); return; }
      const my = ++seq; out.classList.add('busy');
      try {
        const r = await translate(text, to, from); if (my !== seq) return;
        out.textContent = r.text; engine.textContent = r.engine === 'ai' ? t('Translated with Nova AI') : r.engine === 'mymemory' ? t('Translated with MyMemory') : '';
        if (r.from && !from && L[r.from]) engine.textContent += ' · ' + t('Detected: {l}', { l: t(L[r.from]) });
        saveHist(text, r.text);
      } catch (e) { if (my === seq) { out.textContent = ''; toastErr(e); } }
      finally { if (my === seq) out.classList.remove('busy'); }
    }
    const saveHist = debounce((a, b) => { const list = (ls('tr.hist') || []).filter((x) => x.a !== a); list.unshift({ a, b, to, t: Date.now() }); ls('tr.hist', list.slice(0, 12)); paintHist(); }, 1500);
    function paintHist() {
      const list = ls('tr.hist') || [];
      mount(hist, list.length ? [h('div.eyebrow', t('Recent')), ...list.map((x) => h('button.tr-hrow', { onClick: () => { src.value = x.a; to = x.to; toSel.value = to; run(); } }, h('span.ellipsis', x.a), h('span.ellipsis.muted', x.b)))] : null);
    }
    src.addEventListener('input', debounce(run, 450));
    mount(root, h('div.inner.narrow',
      h('div.page-title', h('div', h('h2', t('Translator')), h('p', t('Translate between 19 languages. Messages in Community and DMs have a Translate button too.')))),
      h('div.card.tr-card',
        h('div.tr-bar', fromSel, swap, toSel),
        h('div.tr-panes', h('div.tr-pane', src, h('div.row', count, h('div.grow'), h('button.btn.ghost.sm', { onClick: () => { src.value = ''; run(); src.focus(); } }, icon('x', 14), t('Clear')))),
          h('div.tr-pane', out, h('div.row', engine, h('div.grow'), copy)))),
      hist));
    paintHist(); if (src.value) run(); setTimeout(() => src.focus(), 50);
    return () => {};
  },
};
