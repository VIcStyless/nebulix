'use strict';
// Game rules shared with the browser: the server runs the very same pure rules code that the Arcade uses
// (the "rules:begin … rules:end" part of public/js/views/arcade-chess.js and arcade-cards.js), in an isolated vm
// context with nothing but Math. So online duels validate moves exactly like the offline games play them.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function load(file, names) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', file), 'utf8');
  const a = src.indexOf('// ---- rules:begin ----'); const b = src.indexOf('// ---- rules:end ----');
  if (a < 0 || b < a) throw new Error('rules markers missing in ' + file);
  return vm.runInNewContext(src.slice(a, b) + `\n;({ ${names.join(', ')} })`, { Math }, { filename: 'rules:' + file, timeout: 2000 });
}
let chess = null, checkers = null;
module.exports = {
  get chess() { return chess || (chess = load('arcade-chess.js', ['start', 'legal', 'make', 'inCheck', 'kingAt', 'key', 'side'])); },
  get checkers() { return checkers || (checkers = load('arcade-cards.js', ['ckStart', 'ckMoves', 'ckApply', 'own'])); },
};
