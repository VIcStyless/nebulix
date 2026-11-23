'use strict';
// Lightweight JavaScript tokenizer-based rewriter. It does NOT parse; it only recognises strings, comments,
// regex and template literals well enough to rewrite a few identifiers safely:
//   window.location / document.location / top.location ...  ->  X.__nx$loc
//   bare `location` used as the global Location object        ->  __nx$.location
//   import "/abs-or-root-relative" / from "..." / import("...")     ->  proxied URL
// Anything unexpected leaves the code untouched.
const KW_REGEX_OK = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await', 'extends']);
const DECL = new Set(['var', 'let', 'const', 'function', 'class', 'import', 'export', 'as', 'get', 'set', 'static', 'async', 'enum', 'interface', 'type', 'namespace', 'default', 'from', 'this']);
const LOC_MEMBERS = new Set(['href', 'hostname', 'host', 'origin', 'pathname', 'search', 'hash', 'protocol', 'port', 'assign', 'replace', 'reload', 'toString', 'ancestorOrigins']);
const GLOBALS = new Set(['window', 'self', 'top', 'parent', 'document', 'globalThis']);

const isIdStart = (c) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 36 || c === 95 || c > 127 || c === 92;
const isIdPart = (c) => isIdStart(c) || (c >= 48 && c <= 57);
const isDigit = (c) => c >= 48 && c <= 57;

function rewriteJs(src, rwUrl) {
  if (src.indexOf('location') < 0 && src.indexOf('import') < 0 && src.indexOf('from') < 0) return src;
  try { return run(src, rwUrl); } catch { return src; }
}

function run(src, rwUrl) {
  const n = src.length;
  let i = 0; let last = 0; let out = '';
  let prev = null; let prev2 = null;            // previous significant tokens {t, v, s(tart)}
  const stack = [];                             // 'b' block, 'o' object literal, 't' template ${
  let tpl = false;                              // currently scanning template chars
  const edit = (from, to, text) => { out += src.slice(last, from) + text; last = to; };
  const push = (t, v, s) => { prev2 = prev; prev = { t, v, s }; };

  const nextSig = (j) => { // index of next non-space, non-comment char
    for (;;) {
      while (j < n && (src.charCodeAt(j) <= 32 || src.charCodeAt(j) === 0xa0 || src.charCodeAt(j) === 0xfeff || src.charCodeAt(j) === 0x2028 || src.charCodeAt(j) === 0x2029)) j++;
      if (src[j] === '/' && src[j + 1] === '/') { while (j < n && src[j] !== '\n') j++; continue; }
      if (src[j] === '/' && src[j + 1] === '*') { const e = src.indexOf('*/', j + 2); j = e < 0 ? n : e + 2; continue; }
      return j;
    }
  };

  function scanTemplateChars() { // positioned inside template text; returns after closing ` or after ${
    while (i < n) {
      const c = src.charCodeAt(i);
      if (c === 92) { i += 2; continue; }
      if (c === 96) { i++; tpl = false; push('tpl', '`', i - 1); return; }
      if (c === 36 && src.charCodeAt(i + 1) === 123) { i += 2; stack.push('t'); tpl = false; push('punc', '${', i - 2); return; }
      i++;
    }
    throw new Error('unterminated template');
  }

  while (i < n) {
    if (tpl) { scanTemplateChars(); continue; }
    const c = src.charCodeAt(i);
    if (c === 32 || c === 9 || c === 10 || c === 13 || c === 0xa0 || c === 0xfeff || c === 0x2028 || c === 0x2029 || c === 11 || c === 12) { i++; continue; }
    if (c === 47) { // '/'
      const d = src.charCodeAt(i + 1);
      if (d === 47) { while (i < n && src.charCodeAt(i) !== 10) i++; continue; }
      if (d === 42) { const e = src.indexOf('*/', i + 2); if (e < 0) throw new Error('comment'); i = e + 2; continue; }
      let regexOk = true;
      if (prev) {
        if (prev.t === 'num' || prev.t === 'str' || prev.t === 'tpl' || prev.t === 're') regexOk = false;
        else if (prev.t === 'id') regexOk = KW_REGEX_OK.has(prev.v);
        else if (prev.t === 'punc') regexOk = !(prev.v === ')' || prev.v === ']' || prev.v === '}' || prev.v === '++' || prev.v === '--');
      }
      if (regexOk) {
        let j = i + 1; let cls = false; let ok = false;
        while (j < n) {
          const ch = src.charCodeAt(j);
          if (ch === 10) break;
          if (ch === 92) { j += 2; continue; }
          if (ch === 91) cls = true; else if (ch === 93) cls = false;
          else if (ch === 47 && !cls) { ok = true; break; }
          j++;
        }
        if (ok) { j++; while (j < n && isIdPart(src.charCodeAt(j))) j++; push('re', '', i); i = j; continue; }
      }
      if (src.charCodeAt(i + 1) === 61) { push('punc', '/=', i); i += 2; } else { push('punc', '/', i); i++; }
      continue;
    }
    if (c === 34 || c === 39) { // string
      const s = i; i++;
      while (i < n) { const ch = src.charCodeAt(i); if (ch === 92) { i += 2; continue; } if (ch === c) break; if (ch === 10) throw new Error('newline in string'); i++; }
      if (i >= n) throw new Error('unterminated string');
      i++;
      const lit = src.slice(s + 1, i - 1);
      // module specifiers
      if (rwUrl && prev && ((prev.t === 'id' && (prev.v === 'from' || prev.v === 'import')) || (prev.t === 'punc' && prev.v === '(' && prev2 && prev2.t === 'id' && prev2.v === 'import')) && /^(https?:\/\/|\/)/i.test(lit)) {
        const r = rwUrl(lit);
        if (r && r !== lit) edit(s + 1, i - 1, r);
      } else if (prev && prev.t === 'punc' && prev.v === '[' && lit === 'location' && prev2 && prev2.t === 'id' && GLOBALS.has(prev2.v) && src[nextSig(i)] === ']') {
        edit(s + 1, i - 1, '__nx$loc');
      }
      push('str', '', s); continue;
    }
    if (c === 96) { i++; tpl = true; continue; }
    if (isDigit(c) || (c === 46 && isDigit(src.charCodeAt(i + 1)))) {
      const s = i; i++;
      while (i < n) {
        const ch = src.charCodeAt(i);
        if (isIdPart(ch) || ch === 46) {
          if ((ch === 101 || ch === 69) && !/^0[xX]/.test(src.slice(s, s + 2))) { i++; if (src[i] === '+' || src[i] === '-') i++; continue; }
          i++; continue;
        }
        break;
      }
      push('num', '', s); continue;
    }
    if (isIdStart(c) || (c === 35 && isIdStart(src.charCodeAt(i + 1)))) {
      const s = i; i++;
      while (i < n && (isIdPart(src.charCodeAt(i)) || (src.charCodeAt(i) === 92))) { if (src.charCodeAt(i) === 92) { i += 2; continue; } i++; }
      const id = src.slice(s, i);
      if (id === 'location') {
        const pv = prev; const pv2 = prev2; const nj = nextSig(i); const nc = src[nj];
        if (pv && pv.t === 'punc' && (pv.v === '.' || pv.v === '?.')) {
          if (pv2 && pv2.t === 'id' && GLOBALS.has(pv2.v)) edit(s, i, '__nx$loc');
        } else if (!(pv && pv.t === 'id' && DECL.has(pv.v))) {
          const top = stack[stack.length - 1];
          const keyPos = top === 'o' && pv && pv.t === 'punc' && (pv.v === '{' || pv.v === ',');
          if (!keyPos && nc !== '(' && nc !== ':' ) {
            let ok = false;
            if (nc === '.' && src[nj + 1] !== '.') { // location.<member>
              let k = nj + 1; while (k < n && src.charCodeAt(k) <= 32) k++;
              let e = k; while (e < n && isIdPart(src.charCodeAt(e))) e++;
              ok = LOC_MEMBERS.has(src.slice(k, e));
            } else if (nc === '=' && src[nj + 1] !== '=' && src[nj + 1] !== '>') ok = true; // assignment
            else if (pv && pv.t === 'id' && pv.v === 'typeof') ok = true;
            else if (pv && ((pv.t === 'punc' && ['=', '||', '&&', '?', ':', '+'].includes(pv.v)) || (pv.t === 'id' && pv.v === 'return')) && (nc === ';' || nc === ',' || nc === ')' || nc === '}' || nc === undefined)) ok = true;
            if (ok) edit(s, i, '__nx$.location');
          }
        }
      }
      push('id', id, s); continue;
    }
    // punctuators
    const ch = src[i];
    if (ch === '{') {
      let kind = 'b';
      if (prev && prev.t === 'punc' && ['(', ',', '=', ':', '[', '?', '||', '&&', '!', '+', '-', '*', '${'].includes(prev.v) && prev.v !== '${') kind = 'o';
      else if (prev && prev.t === 'id' && (prev.v === 'return' || prev.v === 'typeof' || prev.v === 'case' || prev.v === 'in' || prev.v === 'of' || prev.v === 'yield' || prev.v === 'await' || prev.v === 'throw' || prev.v === 'new')) kind = 'o';
      stack.push(kind); push('punc', '{', i); i++; continue;
    }
    if (ch === '}') {
      const top = stack.pop();
      i++;
      if (top === 't') { tpl = true; continue; }
      push('punc', '}', i - 1); continue;
    }
    if (ch === '.' && src[i + 1] === '.' && src[i + 2] === '.') { push('punc', '...', i); i += 3; continue; }
    if (ch === '?' && src[i + 1] === '.' && !isDigit(src.charCodeAt(i + 2))) { push('punc', '?.', i); i += 2; continue; }
    if (ch === '=' && src[i + 1] === '>') { push('punc', '=>', i); i += 2; continue; }
    if (ch === '+' && src[i + 1] === '+') { push('punc', '++', i); i += 2; continue; }
    if (ch === '-' && src[i + 1] === '-') { push('punc', '--', i); i += 2; continue; }
    if (ch === '|' && src[i + 1] === '|') { push('punc', '||', i); i += 2; continue; }
    if (ch === '&' && src[i + 1] === '&') { push('punc', '&&', i); i += 2; continue; }
    push('punc', ch, i); i++;
  }
  if (!last) return src;
  return out + src.slice(last);
}

module.exports = { rewriteJs };
