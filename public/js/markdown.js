// Safe Markdown → DOM (never innerHTML) for Nova: headings, bold / italic / strike / inline code, links, lists
// (nested, task lists), quotes, tables, rules and fenced code with syntax highlighting and actions
// (copy, run in a sandbox, open in Nebulix Studio, download). Works while the text is still streaming.
import { h, ls } from './util.js';
import { t } from './i18n.js';
import { icon } from './icons.js';
import { toast, modal } from './ui.js';

// ---------- syntax highlighting (small tokenizer, good enough for chat answers) ----------
const KW = {
  js: 'async await break case catch class const continue debugger default delete do else export extends finally for from function get if import in instanceof let new of return set static super switch this throw try typeof var void while with yield null undefined true false NaN Infinity',
  py: 'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return self True try while with yield print len range',
  c: 'auto bool break case char class const continue default delete do double else enum extern false float for friend goto if inline int long namespace new nullptr operator private protected public register return short signed sizeof static struct switch template this throw true try typedef union unsigned using virtual void volatile while include define string vector std cout cin endl',
  java: 'abstract boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long native new null package private protected public return short static super switch synchronized this throw throws true false try void volatile while var String System out println',
  lua: 'and break do else elseif end false for function goto if in local nil not or repeat return then true until while print',
  sql: 'select from where insert into values update set delete create table drop alter add join left right inner outer on as and or not null is in like order by group having limit offset primary key foreign references distinct count sum avg min max',
  sh: 'if then else elif fi for while do done case esac function in echo cd ls rm mv cp mkdir sudo export source return exit npm node git pip python apt',
  css: 'important',
};
const ALIAS = { javascript: 'js', jsx: 'js', ts: 'js', tsx: 'js', typescript: 'js', mjs: 'js', json: 'js', node: 'js', python: 'py', py3: 'py', cpp: 'c', 'c++': 'c', h: 'c', hpp: 'c', cs: 'java', csharp: 'java', kotlin: 'java', go: 'java', rust: 'c', rs: 'c', php: 'js', swift: 'java', bash: 'sh', shell: 'sh', zsh: 'sh', console: 'sh', powershell: 'sh', ps1: 'sh', postgres: 'sql', mysql: 'sql', sqlite: 'sql', scss: 'css', less: 'css', html: 'html', xml: 'html', svg: 'html', vue: 'html', lua: 'lua', luau: 'lua' };
const langOf = (l) => ALIAS[l] || (KW[l] ? l : l === 'html' ? 'html' : null);
function hlLine(src, lang) {
  const out = []; const kw = new Set((KW[lang] || '').split(' ')); const lineC = lang === 'py' || lang === 'sh' ? '#' : lang === 'sql' || lang === 'lua' ? '--' : '//';
  const re = lang === 'html'
    ? /(<!--[\s\S]*?-->)|(<\/?[A-Za-z][\w:-]*)|(\s[\w:-]+(?==))|("[^"]*"|'[^']*')|(\/?>)/g
    : lang === 'css'
      ? /(\/\*[\s\S]*?\*\/)|("[^"]*"|'[^']*')|(#[0-9a-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|ms|deg)?\b)|([.#]?[A-Za-z-][\w-]*(?=\s*[{,:]))|([a-z-]+(?=\s*:))/g
      : new RegExp(`(${lineC.replace(/[/-]/g, '\\$&')}.*$|/\\*[\\s\\S]*?\\*/)|("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|\`(?:[^\`\\\\]|\\\\.)*\`)|(\\b\\d+(?:\\.\\d+)?\\b)|([A-Za-z_$][\\w$]*)(?=\\s*\\()|([A-Za-z_$][\\w$]*)`, 'gm');
  let last = 0; let m;
  while ((m = re.exec(src))) {
    if (m.index > last) out.push(src.slice(last, m.index));
    const [tok] = m; let cls = null;
    if (lang === 'html') cls = m[1] ? 'c' : m[2] ? 'k' : m[3] ? 'a' : m[4] ? 's' : 'k';
    else if (lang === 'css') cls = m[1] ? 'c' : m[2] ? 's' : m[3] ? 'n' : m[4] ? 'f' : 'a';
    else cls = m[1] ? 'c' : m[2] ? 's' : m[3] ? 'n' : m[4] ? 'f' : kw.has(lang === 'sql' ? tok.toLowerCase() : tok) ? 'k' : /^[A-Z][a-z]/.test(tok) ? 't' : null;
    out.push(cls ? h('span.hl-' + cls, tok) : tok); last = m.index + tok.length; if (!tok.length) re.lastIndex++;
  }
  if (last < src.length) out.push(src.slice(last));
  return out;
}
export function highlight(code, lang) { const l = langOf(String(lang || '').toLowerCase()); return l ? hlLine(code, l) : [code]; }

// ---------- running code safely ----------
const RUNNABLE = /^(html|htm|svg|js|javascript|css)$/;
function runDoc(code, lang) {
  if (/^(js|javascript)$/.test(lang)) return `<!doctype html><meta charset="utf-8"><style>body{font:14px ui-monospace,monospace;background:#0b0c10;color:#e5e7eb;padding:12px;margin:0}.l{white-space:pre-wrap;border-bottom:1px solid #ffffff14;padding:3px 0}.e{color:#f87171}</style><body><script>const _o=document.body;const _p=(c,a)=>{const d=document.createElement('div');d.className='l '+c;d.textContent=a.map(x=>typeof x==='object'?JSON.stringify(x,null,1):String(x)).join(' ');_o.appendChild(d)};console.log=(...a)=>_p('',a);console.info=console.log;console.warn=(...a)=>_p('e',a);console.error=(...a)=>_p('e',a);onerror=(m)=>_p('e',[m]);<\/script><script>${code.replace(/<\/script/gi, '<\\/script')}<\/script>`;
  if (lang === 'css') return `<!doctype html><meta charset="utf-8"><style>${code}</style><body><h1>Título</h1><p>Texto de ejemplo con un <a href="#">enlace</a>.</p><button>Botón</button><div class="box card container">Caja</div>`;
  return code;
}
export function runCode(code, lang) {
  const fr = h('iframe.md-run', { sandbox: 'allow-scripts allow-modals allow-forms allow-pointer-lock', title: t('Preview'), srcdoc: runDoc(code, lang) });
  modal({ title: '▶ ' + t('Preview'), cls: 'wide md-runmodal', body: h('div.md-runwrap', fr, h('div.tiny.muted', t('Runs in a sandbox: it cannot see your account or Nebulix.'))), actions: [{ label: t('Open in Nebulix Studio'), onClick: () => { toStudio(code, lang); } }, { label: t('Close') }] });
}
const EXT = { js: 'js', javascript: 'js', ts: 'ts', typescript: 'ts', python: 'py', py: 'py', html: 'html', css: 'css', json: 'json', java: 'java', c: 'c', cpp: 'cpp', cs: 'cs', go: 'go', rust: 'rs', lua: 'lua', sql: 'sql', bash: 'sh', sh: 'sh', php: 'php', md: 'md', markdown: 'md', svg: 'svg', xml: 'xml', yaml: 'yml', yml: 'yml', kotlin: 'kt', swift: 'swift', rb: 'rb', ruby: 'rb' };
export function toStudio(code, lang) {
  const ext = EXT[lang] || 'txt'; const files = ls('studio.local') || {};
  let name = ext === 'html' ? 'index.html' : 'nova.' + ext; if (files[name] && files[name] !== code) { let i = 2; while (files[`nova-${i}.${ext}`]) i++; name = ext === 'html' && !files['index.html'] ? 'index.html' : `nova-${i}.${ext}`; }
  files[name] = code; ls('studio.local', files); toast(t('Saved as {f} in Nebulix Studio', { f: name }), 'good');
  if (window.__nbx && window.__nbx.go) window.__nbx.go('studio', { path: name }); else location.hash = '#/studio?path=' + encodeURIComponent(name);
}

function codeBlock(code, lang, { done }) {
  const pre = h('pre.md-pre', h('code', highlight(code, lang)));
  const copyB = h('button.md-cbtn', { type: 'button', onClick: async () => { try { await navigator.clipboard.writeText(code); copyB.lastChild.textContent = ' ' + t('Copied!'); setTimeout(() => { copyB.lastChild.textContent = ' ' + t('Copy'); }, 1500); } catch {} } }, icon('copy', 13), h('span', ' ' + t('Copy')));
  return h('div.md-code', h('div.md-chead', h('span.md-lang', lang || 'code'), h('span.grow'),
    done && RUNNABLE.test(lang) ? h('button.md-cbtn', { type: 'button', onClick: () => runCode(code, lang) }, icon('play', 13), h('span', ' ' + t('Run'))) : null,
    done && lang && !/^(text|plaintext|output|console)$/.test(lang) ? h('button.md-cbtn', { type: 'button', title: t('Open in Nebulix Studio'), onClick: () => toStudio(code, lang) }, icon('terminal', 13)) : null,
    done ? h('button.md-cbtn', { type: 'button', title: t('Download'), onClick: () => { const a = h('a', { href: URL.createObjectURL(new Blob([code], { type: 'text/plain' })), download: 'nova.' + (EXT[lang] || 'txt') }); document.body.append(a); a.click(); a.remove(); } }, icon('download', 13)) : null, copyB), pre);
}

// ---------- inline ----------
const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*|__[^_\n]+__)|(\*[^*\s][^*\n]*\*|_[^_\s][^_\n]*_)|(~~[^~\n]+~~)|(\[([^\]\n]{1,200})\]\(((?:https?:\/\/|#\/)[^)\s]{1,500})\))|(https?:\/\/[^\s<)]+[^\s<.,;:!?)\]'"])/g;
export function inline(text, { go } = {}) {
  // a fresh regex per call: inline() is recursive (bold/italic contain inline text) and a shared /g regex would loop forever
  const re = new RegExp(INLINE.source, 'g'); const out = []; let last = 0; let m; const s = String(text);
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    if (m[1]) out.push(h('code.md-ic', m[1].slice(1, -1)));
    else if (m[2]) out.push(h('strong', inline(m[2].slice(2, -2), { go })));
    else if (m[3]) out.push(h('em', inline(m[3].slice(1, -1), { go })));
    else if (m[4]) out.push(h('s', m[4].slice(2, -2)));
    else if (m[5]) { const href = m[7]; out.push(h('a.md-a', { href, target: href.startsWith('#/') ? null : '_blank', rel: 'noopener noreferrer', onClick: href.startsWith('#/') && go ? (e) => { e.preventDefault(); const [p] = href.slice(2).split('?'); const [n, ...rest] = p.split('/'); go(n, rest.join('/') || undefined); } : null }, m[6])); }
    else if (m[8]) out.push(h('a.md-a', { href: m[8], target: '_blank', rel: 'noopener noreferrer' }, m[8].replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)));
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

// ---------- images made by Nova ----------
function imageCard(url, alt) {
  const want = (k) => Number((new RegExp('[?&]' + k + '=(\\d+)').exec(url) || [])[1]) || 0; const W = want('width'), H = want('height');
  const st = h('div.md-imgload', h('span.nv2-typing', h('i'), h('i'), h('i')), h('span.tiny.muted', ' ' + t('Creating the image…')));
  let tries = 0; let timer = 0;
  // the free service answers with a small "limit reached" picture instead of an error: detect it by its size and retry
  const limited = () => { img.classList.remove('on'); let left = 46; mount3(st, h('span', '⏳ ' + t('Free limit: 1 image every 45 seconds.')), h('b.md-cd', ' ' + left + ' s'));
    clearInterval(timer); timer = setInterval(() => { left--; const cd = st.querySelector('.md-cd'); if (cd) cd.textContent = ' ' + left + ' s'; if (left <= 0) { clearInterval(timer); if (!img.isConnected) return; mount3(st, h('span.nv2-typing', h('i'), h('i'), h('i')), h('span.tiny.muted', ' ' + t('Creating the image…'))); img.src = url + '&r=' + Date.now(); } }, 1000); };
  const img = h('img.md-img', { src: url, alt, loading: 'lazy',
    onLoad: () => {
      const off = W && H && (img.naturalWidth !== W || img.naturalHeight !== H);
      if (off && tries < 1) { tries++; limited(); return; } // one retry after the free limit window
      st.remove(); img.classList.add('on'); if (off) cap.prepend(h('span.tiny.md-imgwarn', '⚠ ' + t('The free image service is busy: this picture may be lower quality or not match. Try again later.') + ' '));
    },
    onError: () => { mount2(st, t('The image could not be created. Try again in a moment.')); },
    onClick: () => modal({ cls: 'wide md-imgmodal', body: h('img', { src: img.src, alt, style: 'width:100%;border-radius:12px' }), actions: [{ label: t('Close') }] }) });
  const dl = async () => { try { const r = await fetch(img.src); const b = await r.blob(); const a = h('a', { href: URL.createObjectURL(b), download: 'nova-' + Date.now() + '.jpg' }); document.body.append(a); a.click(); a.remove(); } catch { window.open(img.src, '_blank', 'noopener'); } };
  const cap = h('span.grow.tiny.muted', alt);
  return h('figure.md-figure', h('div.md-imgbox', st, img), h('figcaption', cap, h('button.md-cbtn', { type: 'button', title: t('Download'), onClick: dl }, icon('download', 13)), h('button.md-cbtn', { type: 'button', title: t('Copy link'), onClick: () => navigator.clipboard.writeText(url).then(() => toast(t('Link copied'), 'good')) }, icon('link', 13))));
}
const mount3 = (el, ...kids) => { el.textContent = ''; for (const k of kids) el.append(k); };
const mount2 = (el, txt) => { el.textContent = txt; };

// ---------- blocks ----------
export function renderMarkdown(text, { go, done = true, special } = {}) {
  const out = []; const src = String(text || '').replace(/\r/g, '');
  const parts = src.split(/(^```[^\n]*\n[\s\S]*?(?:^```[ \t]*$|$(?![\s\S])))/m);
  for (const part of parts) {
    const fm = /^```([^\n]*)\n([\s\S]*?)(\n?```[ \t]*)?$/.exec(part);
    if (fm) {
      const lang = fm[1].trim().toLowerCase().split(/\s+/)[0]; const code = fm[2].replace(/\n$/, ''); const closed = !!fm[3] || done;
      const sp = special && special(lang, code, closed); if (sp !== undefined) { if (sp) out.push(sp); continue; }
      out.push(codeBlock(code, lang, { done: closed })); continue;
    }
    const lines = part.split('\n'); let i = 0;
    const isUl = (l) => /^\s*[-*+•]\s+/.test(l); const isOl = (l) => /^\s*\d+[.)]\s+/.test(l); const isTable = (l, n) => /\|/.test(l) && n !== undefined && /^\s*\|?\s*:?-{2,}/.test(n);
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) { i++; continue; }
      const im = /^\s*!\[([^\]]{0,600})\]\((https:\/\/image\.pollinations\.ai\/[^)\s]{1,1500})\)\s*$/.exec(l); if (im) { out.push(imageCard(im[2], im[1])); i++; continue; }
      // 13.8: pictures uploaded to Nebulix (study notes, posts): only our own /uploads/ addresses
      const up = /^\s*!\[([^\]]{0,300})\]\((\/uploads\/[A-Za-z0-9_-]{6,80}\.(?:png|jpe?g|webp|gif))\)\s*$/.exec(l); if (up) { out.push(h('figure.md-fig', h('img.md-upimg', { src: up[2], alt: up[1], loading: 'lazy' }), up[1] ? h('figcaption.tiny.muted', up[1]) : null)); i++; continue; }
      const hm = /^(#{1,6})\s+(.*)$/.exec(l); if (hm) { out.push(h('h' + Math.min(6, hm[1].length + 1) + '.md-h', inline(hm[2], { go }))); i++; continue; }
      if (/^\s*([-*_])\s*\1\s*\1[\s\1]*$/.test(l)) { out.push(h('hr.md-hr')); i++; continue; }
      if (/^\s*>/.test(l)) { const q = []; while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, '')); out.push(h('blockquote.md-q', renderMarkdown(q.join('\n'), { go, done }))); continue; }
      if (isTable(l, lines[i + 1])) {
        const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()); const head = cells(l); i += 2; const rows = [];
        while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) rows.push(cells(lines[i++]));
        out.push(h('div.md-tablewrap', h('table.md-table', h('thead', h('tr', head.map((c) => h('th', inline(c, { go }))))), h('tbody', rows.map((r) => h('tr', head.map((_, k) => h('td', inline(r[k] || '', { go })))))))));
        continue;
      }
      if (isUl(l) || isOl(l)) {
        const ordered = isOl(l); const items = [];
        while (i < lines.length && (isUl(lines[i]) || isOl(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
          const ln = lines[i++]; if (/^\s{2,}\S/.test(ln) && !isUl(ln.trim()) && !isOl(ln.trim())) { items[items.length - 1].more.push(ln.trim()); continue; }
          const indent = /^\s*/.exec(ln)[0].length; const body = ln.replace(/^\s*([-*+•]|\d+[.)])\s+/, '');
          if (indent >= 2 && items.length) { items[items.length - 1].sub.push(ln.slice(Math.min(indent, 4))); continue; }
          items.push({ body, sub: [], more: [] });
        }
        const li = (it) => { const task = /^\[( |x|X)\]\s+/.exec(it.body); return h('li' + (task ? '.md-task' : ''), task ? h('input', { type: 'checkbox', checked: task[1] !== ' ', disabled: true }) : null, inline(task ? it.body.slice(task[0].length) : it.body, { go }), it.more.length ? h('div', inline(it.more.join(' '), { go })) : null, it.sub.length ? renderMarkdown(it.sub.join('\n'), { go, done }) : null); };
        out.push(h(ordered ? 'ol.md-ol' : 'ul.md-ul', items.map(li))); continue;
      }
      const para = []; while (i < lines.length && lines[i].trim() && !/^(#{1,6})\s/.test(lines[i]) && !isUl(lines[i]) && !isOl(lines[i]) && !/^\s*>/.test(lines[i]) && !isTable(lines[i], lines[i + 1])) para.push(lines[i++]);
      out.push(h('p.md-p', para.map((p, k) => [k ? h('br') : null, inline(p, { go })])));
    }
  }
  return out;
}
