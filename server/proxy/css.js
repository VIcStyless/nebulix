'use strict';
// CSS url()/@import/image-set() rewriting. `rw(urlString, baseUrl)` converts a URL to its proxied form.
const URL_FN = /url\(\s*(?:"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|((?:[^"'()\s\\]|\\.)+))\s*\)/gi;
const IMPORT_STR = /@import\s+(["'])((?:(?!\1)[^\\\n]|\\.)*)\1/gi;
const IMAGE_SET = /(image-set|-webkit-image-set)\(((?:[^()"']|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|url\([^)]*\))*)\)/gi;
const SKIP = /^(data:|#|about:|blob:|javascript:)/i;

function rewriteCss(css, base, rw) {
  if (!css || (css.indexOf('url(') < 0 && css.indexOf('@import') < 0 && css.indexOf('image-set') < 0)) return css;
  css = css.replace(IMPORT_STR, (m, q, u) => (SKIP.test(u.trim()) ? m : `@import ${q}${rw(u.trim(), base)}${q}`));
  css = css.replace(URL_FN, (m, dq, sq, bare) => {
    const t = (dq !== undefined ? dq : sq !== undefined ? sq : bare).trim();
    if (!t || SKIP.test(t)) return m;
    const out = rw(t, base);
    if (dq !== undefined) return `url("${out.replace(/"/g, '%22')}")`;
    if (sq !== undefined) return `url('${out.replace(/'/g, '%27')}')`;
    return /[\s"'()\\]/.test(out) ? `url("${out.replace(/"/g, '%22')}")` : `url(${out})`;
  });
  // image-set("a.png" 1x, "b.png" 2x): plain strings are URLs here
  css = css.replace(IMAGE_SET, (m, fn, inner) => `${fn}(${inner.replace(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'/g, (s, a, b) => {
    const t = (a !== undefined ? a : b).trim();
    return !t || SKIP.test(t) ? s : `"${rw(t, base).replace(/"/g, '%22')}"`;
  })})`);
  return css;
}
module.exports = { rewriteCss };
