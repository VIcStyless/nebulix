'use strict';
// When NX_LOG_FILE is set (the Windows client does this), everything printed with console.* is also written
// to that file, so the client can show the log and find the app URL without a console window.
const fs = require('fs');
let done = false;
module.exports = function setupLogFile() {
  if (done || !process.env.NX_LOG_FILE) return; done = true;
  try {
    const out = fs.createWriteStream(process.env.NX_LOG_FILE, { flags: 'w' });
    for (const k of ['log', 'info', 'warn', 'error']) {
      const orig = console[k].bind(console);
      console[k] = (...a) => { try { out.write(a.map((x) => (typeof x === 'string' ? x : (x && x.stack) || JSON.stringify(x))).join(' ') + '\n'); } catch {} orig(...a); };
    }
  } catch (e) { console.error('Could not open NX_LOG_FILE:', e.message); }
};
