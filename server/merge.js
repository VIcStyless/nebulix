'use strict';
// Three-way merge for live co-editing: runs the exact code of public/js/merge3.js (between the merge:begin/end
// markers) in an isolated vm context, so the server and the browser always merge the same way.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
let M = null;
function load() {
  if (M) return M;
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'merge3.js'), 'utf8');
  const a = src.indexOf('// ---- merge:begin ----'); const b = src.indexOf('// ---- merge:end ----');
  if (a < 0 || b < a) throw new Error('merge markers missing');
  M = vm.runInNewContext(src.slice(a, b) + '\n;({ mergeTokens, mergeHtml, mergeText, mergeJson })', { Math, Map, Set, Array, JSON, String, Uint16Array, Object }, { filename: 'merge3.js' });
  return M;
}
module.exports = { get mergeHtml() { return load().mergeHtml; }, get mergeText() { return load().mergeText; }, get mergeJson() { return load().mergeJson; } };
