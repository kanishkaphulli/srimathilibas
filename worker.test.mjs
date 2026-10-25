// Run: node worker.test.mjs (checks order.js)
import assert from 'node:assert/strict';
import { lineItems } from './order.js';

const cat = [{ id: 'a', name: 'Kurta', price: 129, sizes: { M: 2, L: 0 } }];
const order = (o) => ({ no: 'SL-261025-AB12', items: [{ id: 'a', size: 'M', qty: 2 }], delivery: 'pickup', ...o });

assert.deepEqual(lineItems(cat, order()), [{ id: 'a', size: 'M', qty: 2, name: 'Kurta (M)', amount: 12900 }]);
assert.equal(lineItems(cat, order({ delivery: 'delivery', address: '1 Queen St' })).at(-1).amount, 1200);
assert.throws(() => lineItems(cat, order({ items: [{ id: 'a', size: 'M', qty: 3 }] })), /only 2/);
assert.throws(() => lineItems(cat, order({ items: [{ id: 'a', size: 'L', qty: 1 }] })), /only 0/);
assert.throws(() => lineItems(cat, order({ items: [{ id: 'a', size: 'M', qty: 1.5 }] })), /quantity/);
assert.throws(() => lineItems(cat, order({ items: [{ id: 'x', size: 'M', qty: 1 }] })), /no longer/);
assert.throws(() => lineItems(cat, order({ delivery: 'delivery' })), /address/);
assert.throws(() => lineItems(cat, order({ no: 'bad' })), /order number/);
console.log('worker.test.mjs: all checks passed');

// validate.js
import { validateProducts, validatePromos } from './validate.js';
import { sizePath } from './order.js';
const good = { id: 'a', cat: 'Sarees', name: 'Silk', price: 99, img: '/photos/x.jpg', sizes: { 'Free size': 2 } };
assert.equal(validateProducts([good]), '');
assert.match(validateProducts([{ ...good, sizes: { S: null } }]), /sizes/);
assert.match(validateProducts([{ ...good, img: 'javascript:alert(1)' }]), /photo/);
assert.match(validateProducts([good, good]), /duplicate/);
assert.match(validateProducts([{ ...good, sizes: { 'S"x': 1 } }]), /sizes/);
assert.equal(validatePromos([{ id: 'p', tag: '', title: 'Hi', text: '', until: '', active: true }]), '');
assert.match(validatePromos([{ id: 'p', tag: '', title: '', text: '', until: '', active: true }]), /title/);
assert.equal(sizePath('Free size'), '$."Free size"');
// two lines of the same size must fit stock together
assert.throws(() => lineItems(cat, order({ items: [{ id: 'a', size: 'M', qty: 1 }, { id: 'a', size: 'M', qty: 2 }] })), /only 2/);
console.log('validate.js: all checks passed');
