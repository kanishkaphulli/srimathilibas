// Unit checks for order.js, validate.js, stock-sheet.js and session.js. Run: npm test (or node --test tests/)
import assert from 'node:assert/strict';
import { lineItems, stockPath, namePath, itemName } from '../order.js';
import { validateProducts, validatePromos } from '../validate.js';

const kurta = { id: 'a', name: 'Kurta', price: 129, sizes: ['M', 'L'],
  colours: [{ name: 'Red', hex: '#aa0000', photos: ['/photos/r1.jpg', '/photos/r2.jpg'], stock: { M: 2, L: 0 } },
            { name: 'Blue', hex: '#0000aa', photos: ['/photos/b1.jpg'], stock: { M: 0, L: 1 } }] };
const cat = [kurta];
const order = (o) => ({ no: 'SL-261025-AB12', items: [{ id: 'a', colour: 'Red', size: 'M', qty: 2 }], delivery: 'pickup', ...o });

// pricing and stock per colour + size
assert.deepEqual(lineItems(cat, order()), [{ id: 'a', colour: 'Red', size: 'M', qty: 2, name: 'Kurta — Red (M)', amount: 12900 }]);
assert.equal(lineItems(cat, order({ delivery: 'delivery', address: '1 Queen St' })).at(-1).amount, 1200);
assert.throws(() => lineItems(cat, order({ items: [{ id: 'a', colour: 'Red', size: 'M', qty: 3 }] })), /only 2/);
assert.throws(() => lineItems(cat, order({ items: [{ id: 'a', colour: 'Blue', size: 'M', qty: 1 }] })), /only 0/);
assert.equal(lineItems(cat, order({ items: [{ id: 'a', colour: 'Blue', size: 'L', qty: 1 }] }))[0].name, 'Kurta — Blue (L)');
assert.throws(() => lineItems(cat, order({ items: [{ id: 'a', colour: 'Green', size: 'M', qty: 1 }] })), /only 0/);
assert.throws(() => lineItems(cat, order({ items: [{ id: 'a', colour: 'Red', size: 'M', qty: 1.5 }] })), /quantity/);
assert.throws(() => lineItems(cat, order({ items: [{ id: 'x', colour: 'Red', size: 'M', qty: 1 }] })), /no longer/);
assert.throws(() => lineItems(cat, order({ delivery: 'delivery' })), /address/);
assert.throws(() => lineItems(cat, order({ no: 'bad' })), /order number/);
assert.throws(() => lineItems(cat, order({ items: [{ id: 'a', colour: 'Red', size: 'M', qty: 1 }, { id: 'a', colour: 'Red', size: 'M', qty: 2 }] })), /only 2/);
assert.equal(itemName({ ...kurta, colours: [kurta.colours[0]] }, 'Red', 'M'), 'Kurta (M)'); // single colour isn't named
assert.equal(stockPath(1, 'Free size'), '$[1].stock."Free size"');
assert.equal(namePath(0), '$[0].name');

// validate.js
assert.equal(validateProducts([{ ...kurta, cat: 'Suits' }]), '');
const bad = (change) => validateProducts([{ ...kurta, cat: 'Suits', ...change }]);
const colour = (change) => bad({ colours: [{ ...kurta.colours[0], ...change }] });
assert.match(bad({ sizes: [] }), /size/);
assert.match(bad({ sizes: ['M', 'M'] }), /twice/);
assert.match(bad({ sizes: ['M"'] }), /quotes/);
assert.match(bad({ colours: [] }), /colour/);
assert.match(bad({ colours: [kurta.colours[0], { ...kurta.colours[1], name: 'Red ' }] }), /twice/);
assert.match(colour({ hex: 'red' }), /swatch/);
assert.match(colour({ photos: [] }), /photo/);
assert.match(colour({ photos: ['javascript:alert(1)'] }), /photo link/);
assert.match(colour({ stock: { M: -1 } }), /whole number/);
assert.match(colour({ stock: { XL: 1 } }), /unknown size/);
assert.match(validateProducts([{ ...kurta, cat: 'Suits' }, { ...kurta, cat: 'Suits' }]), /duplicate/);
assert.equal(validatePromos([{ id: 'p', tag: '', title: 'Hi', text: '', until: '', active: true }]), '');
assert.match(validatePromos([{ id: 'p', tag: '', title: '', text: '', until: '', active: true }]), /title/);
console.log('worker.test.mjs: all checks passed');

// stock-sheet.js
import { stockRows, applyStockSheet } from '../stock-sheet.js';
const two = [kurta, { id: 's', name: 'Saree', price: 99, sizes: ['Free size'], colours: [{ name: 'As shown', hex: '#123456', photos: ['/photos/s.jpg'], stock: { 'Free size': 3 } }] }];
assert.deepEqual(stockRows(two), [
  ['Product ID', 'Product', 'Colour', 'M', 'L', 'Free size'],
  ['a', 'Kurta', 'Red', 2, 0, ''], ['a', 'Kurta', 'Blue', 0, 1, ''], ['s', 'Saree', 'As shown', '', '', 3],
]);
const roundTrip = applyStockSheet(two, stockRows(two));
assert.equal(roundTrip.changed, 0); assert.deepEqual(roundTrip.problems, []); assert.deepEqual(roundTrip.products, two);
const up = applyStockSheet(two, [
  ['Product ID', 'Product', 'Colour', 'M', 'L', 'XL'],
  ['a', '', 'red', 5, '', 2],        // case-insensitive colour, blank leaves L alone, new size XL
  ['', 'saree', '', '', '', ''],     // found by name, single colour, nothing to change
  ['a', 'Kurta', 'Green', 1, '', ''],// new colour
  ['zz', '', 'Red', 1, '', ''],      // unknown product
  ['a', '', 'Blue', 'two', -1, ''],  // bad numbers
  ['', '', '', '', '', ''],          // blank row ignored
]);
assert.equal(up.products[0].colours[0].stock.M, 5);
assert.equal(up.products[0].colours[0].stock.L, 0);
assert.equal(up.products[0].colours[0].stock.XL, 2);
assert.deepEqual(up.products[0].sizes, ['M', 'L', 'XL']);
assert.deepEqual(up.products[0].colours[2], { name: 'Green', hex: '#888888', photos: [], stock: { M: 1 } });
assert.equal(up.changed, 3);
assert.deepEqual(up.newColours, ['Kurta — Green']);
assert.deepEqual(up.newSizes, ['Kurta — XL']);
assert.equal(up.problems.length, 3);
assert.match(up.problems[0], /Row 5: no product/);
assert.equal(two[0].colours[0].stock.M, 2); // original untouched
assert.match(applyStockSheet(two, [['Name', 'Qty']]).problems[0], /headings/);
console.log('stock-sheet.js: all checks passed');

// session.js
import { makeSession, readSession } from '../session.js';
const T0 = Date.UTC(2026, 9, 27, 0, 0, 0);
const tok = await makeSession('kanishka', 'kanishka:pw', 3600, T0);
assert.deepEqual(await readSession(tok, 'kanishka:pw', T0 + 1000), { u: 'kanishka', exp: T0 / 1000 + 3600 });
assert.equal(await readSession(tok, 'kanishka:pw', T0 + 3601 * 1000), null);       // expired
assert.equal(await readSession(tok, 'kanishka:newpw', T0 + 1000), null);           // admin list changed
assert.equal(await readSession(tok.replace(/^./, (c) => (c === 'e' ? 'f' : 'e')), 'kanishka:pw', T0), null); // tampered payload
assert.equal(await readSession('nonsense', 'kanishka:pw', T0), null);
assert.equal(await readSession(undefined, 'kanishka:pw', T0), null);
console.log('session.js: all checks passed');
