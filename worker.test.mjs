// Run: node worker.test.mjs (checks order.js)
import assert from 'node:assert/strict';
import { lineItems } from './order.js';

const cat = [{ id: 'a', name: 'Kurta', price: 129, sizes: { M: 2, L: 0 } }];
const order = (o) => ({ no: 'SL-261025-AB12', items: [{ id: 'a', size: 'M', qty: 2 }], delivery: 'pickup', ...o });

assert.deepEqual(lineItems(cat, order()), [{ name: 'Kurta (M)', amount: 12900, qty: 2 }]);
assert.equal(lineItems(cat, order({ delivery: 'delivery', address: '1 Queen St' })).at(-1).amount, 1200);
assert.throws(() => lineItems(cat, order({ items: [{ id: 'a', size: 'M', qty: 3 }] })), /only 2/);
assert.throws(() => lineItems(cat, order({ items: [{ id: 'a', size: 'L', qty: 1 }] })), /only 0/);
assert.throws(() => lineItems(cat, order({ items: [{ id: 'a', size: 'M', qty: 1.5 }] })), /quantity/);
assert.throws(() => lineItems(cat, order({ items: [{ id: 'x', size: 'M', qty: 1 }] })), /no longer/);
assert.throws(() => lineItems(cat, order({ delivery: 'delivery' })), /address/);
assert.throws(() => lineItems(cat, order({ no: 'bad' })), /order number/);
console.log('worker.test.mjs: all checks passed');
