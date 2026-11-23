'use strict';
// Advantages shop (boosts, upgrades) and the Nebulix bank. Logic lives in ../boosts.js.
const B = require('../boosts');
module.exports = function register(r) {
  const A = { auth: true, verified: true, limit: [40, 60000, 'user'] };
  r.get('/api/perks', { auth: true, limit: [120, 60000, 'user'] }, async (c) => B.view(c.user));
  r.post('/api/perks/boost', A, async (c) => B.buyBoost(c.user, String(c.body.id || '')));
  r.post('/api/perks/upgrade', A, async (c) => B.buyUpgrade(c.user, String(c.body.id || '')));
  r.post('/api/bank/deposit', A, async (c) => B.deposit(c.user, c.body.amount));
  r.post('/api/bank/withdraw', A, async (c) => B.withdraw(c.user, c.body.amount === 'all' ? 'all' : c.body.amount));
};
