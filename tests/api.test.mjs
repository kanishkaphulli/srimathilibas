// End-to-end API tests against the real Worker on a throwaway database. Run: npm test
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { startServer, signIn, ADMIN, ADMIN2, WEBHOOK_SECRET } from './helpers/server.mjs';

let s, cookie;
const json = (path, init) => s.get(path, init).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null), headers: r.headers }));
const admin = (path, init = {}) => json(path, { ...init, headers: { cookie, 'content-type': 'application/json', ...(init.headers || {}) } });
const post = (path, body) => json(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const stock = async (id, colour, size) => (await json('/products.json')).body.find((p) => p.id === id).colours.find((c) => c.name === colour).stock[size];
let n = 0;
const orderNo = () => `SL-261027-T${String(++n).padStart(3, '0')}`;
const order = (o = {}) => ({ no: orderNo(), items: [{ id: 'su1', colour: 'As shown', size: 'M', qty: 1 }], name: 'Test Customer', phone: '021 555 0100', delivery: 'pickup', ...o });

before(async () => { s = await startServer(); cookie = await signIn(s); }, { timeout: 180_000 });
after(async () => { await s?.stop(); });

describe('public shop', () => {
  it('serves the shop page and catalogue', async () => {
    assert.equal((await s.get('/')).status, 200);
    const { body: products } = await json('/products.json');
    assert.equal(products.length, 8);
    assert.ok(products.every((p) => p.sizes.length && p.colours.length && p.colours[0].photos.length));
    assert.ok(Array.isArray((await json('/promos.json')).body));
  });
  it('reports settings and payment setup', async () => {
    assert.deepEqual((await json('/api/settings')).body, { planner: true });
    assert.deepEqual((await json('/api/payments')).body, { card: true, shipping: 12 });
  });
  it('never serves private files', async () => {
    for (const f of ['/worker.js', '/order.js', '/validate.js', '/session.js', '/schema.sql', '/seed.sql', '/scripts/seed.mjs',
      '/wrangler.jsonc', '/.dev.vars', '/README.md', '/tests/api.test.mjs', '/package.json', '/migrations/0002_colours.sql']) {
      assert.equal((await s.get(f)).status, 404, f);
    }
  });
  it('returns 404 for unknown API routes and missing photos', async () => {
    assert.equal((await s.get('/api/nope')).status, 404);
    assert.equal((await s.get('/photos/missing.jpg')).status, 404);
    assert.equal((await s.get('/photos/..%2Fworker.js')).status, 404);
  });
});

describe('admin sign-in', () => {
  it('sends signed-out visitors to the sign-in page', async () => {
    for (const p of ['/admin', '/admin.html']) {
      const r = await s.get(p);
      assert.equal(r.status, 303, p);
      assert.equal(new URL(r.headers.get('location'), s.base).pathname, '/admin/login');
    }
    assert.equal((await s.get('/admin/api/data')).status, 401);
    assert.match(await (await s.get('/admin/login')).text(), /Admin sign in/);
  });
  it('rejects wrong passwords and the old browser login', async () => {
    const r = await s.get('/admin/login', { method: 'POST', body: new URLSearchParams({ name: ADMIN.name, password: 'wrong' }) });
    assert.equal(r.status, 401);
    assert.match(await r.text(), /Wrong name or password/);
    const basic = 'Basic ' + btoa(`${ADMIN.name}:${ADMIN.password}`);
    assert.equal((await s.get('/admin/api/data', { headers: { authorization: basic } })).status, 401);
  });
  it('signs in with a secure, script-proof cookie', async () => {
    const r = await s.get('/admin/login', { method: 'POST', body: new URLSearchParams(ADMIN) });
    assert.equal(r.status, 303);
    const c = r.headers.get('set-cookie');
    for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Max-Age=43200']) assert.ok(c.includes(flag), flag);
    assert.equal((await s.get('/admin', { headers: { cookie } })).status, 200);
    assert.equal((await admin('/admin/api/data')).body.user, ADMIN.name);
  });
  it('lets every listed admin sign in', async () => {
    const c2 = await signIn(s, ADMIN2);
    assert.equal((await json('/admin/api/data', { headers: { cookie: c2 } })).body.user, ADMIN2.name);
  });
  it('refuses tampered sessions', async () => {
    const [name, token] = cookie.split('=');
    const [payload, sig] = token.split('.');
    const forged = `${name}=${btoa(JSON.stringify({ u: 'x', exp: 9999999999 })).replace(/=+$/, '')}.${sig}`;
    for (const c of [forged, `${name}=${payload}.AAAA`, `${name}=junk`]) assert.equal((await s.get('/admin/api/data', { headers: { cookie: c } })).status, 401);
  });
  it('logs out', async () => {
    const c = await signIn(s);
    const r = await s.get('/admin/logout', { method: 'POST', headers: { cookie: c } });
    assert.equal(r.status, 303);
    assert.match(r.headers.get('set-cookie'), /Max-Age=0/);
  });
});

describe('orders and stock', () => {
  it('saves a bank-transfer order and lists it for admin', async () => {
    const o = order();
    const r = await post('/api/order', o);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { no: o.no, total: 129 });
    const listed = (await admin('/admin/api/orders')).body.find((x) => x.no === o.no);
    assert.equal(listed.status, 'awaiting_payment');
    assert.deepEqual(listed.items[0], { id: 'su1', colour: 'As shown', size: 'M', qty: 1, name: 'Gulnaar Red Kurta Set (M)', price: 129 });
  });
  it('charges delivery only for courier orders', async () => {
    assert.equal((await post('/api/order', order({ delivery: 'delivery', address: '1 Queen St, Auckland' }))).body.total, 141);
    assert.equal((await post('/api/order', order({ delivery: 'delivery' }))).status, 400);
  });
  it('rejects bad orders', async () => {
    assert.equal((await post('/api/order', order({ items: [{ id: 'su1', colour: 'As shown', size: 'M', qty: 99 }] }))).status, 400);
    assert.equal((await post('/api/order', order({ items: [{ id: 'lh2', colour: 'As shown', size: 'S', qty: 1 }] }))).status, 400); // 0 in stock
    assert.equal((await post('/api/order', order({ items: [{ id: 'nope', colour: 'As shown', size: 'M', qty: 1 }] }))).status, 400);
    assert.equal((await post('/api/order', order({ phone: '' }))).status, 400);
    assert.equal((await post('/api/order', order({ phone: '-------' }))).status, 400, 'a phone number needs digits');
    assert.equal((await post('/api/order', order({ no: 'hello' }))).status, 400);
    const o = order();
    assert.equal((await post('/api/order', o)).status, 200);
    assert.equal((await post('/api/order', { ...o })).status, 409); // same order number twice
  });
  it('takes stock off once when paid and puts it back once when cancelled', async () => {
    const before = await stock('sa1', 'As shown', 'Free size');
    const o = order({ items: [{ id: 'sa1', colour: 'As shown', size: 'Free size', qty: 2 }] });
    await post('/api/order', o);
    assert.equal(await stock('sa1', 'As shown', 'Free size'), before, 'unpaid orders hold no stock');
    const set = (status) => admin(`/admin/api/orders/${o.no}`, { method: 'POST', body: JSON.stringify({ status }) });
    assert.equal((await set('paid')).body.status, 'paid');
    assert.equal((await set('paid')).body.status, 'paid');
    assert.equal(await stock('sa1', 'As shown', 'Free size'), before - 2);
    assert.equal((await set('shipped')).body.status, 'shipped');
    assert.equal((await set('cancelled')).body.status, 'cancelled');
    assert.equal((await set('cancelled')).body.status, 'cancelled');
    assert.equal(await stock('sa1', 'As shown', 'Free size'), before);
    assert.equal((await set('awaiting_payment')).status, 400);
  });
  it('requires sign-in to change orders', async () => {
    const o = order(); await post('/api/order', o);
    const r = await s.get(`/admin/api/orders/${o.no}`, { method: 'POST', body: JSON.stringify({ status: 'paid' }) });
    assert.equal(r.status, 401);
  });
  it('refuses to mark a bank order paid when its stock already went to another paid order', async () => {
    // lh1 size S has 1 left; unpaid orders hold no stock, so both orders are accepted
    const item = [{ id: 'lh1', colour: 'As shown', size: 'S', qty: 1 }];
    const a = order({ items: item }), b = order({ items: item });
    assert.equal((await post('/api/order', a)).status, 200);
    assert.equal((await post('/api/order', b)).status, 200);
    const set = (no, status) => admin(`/admin/api/orders/${no}`, { method: 'POST', body: JSON.stringify({ status }) });
    assert.equal((await set(a.no, 'paid')).status, 200);
    const refused = await set(b.no, 'paid');
    assert.equal(refused.status, 409);
    assert.match(refused.body.error, /only 0 .* left/i);
    assert.equal(await stock('lh1', 'As shown', 'S'), 0);
    await set(a.no, 'cancelled'); // put it back for later tests
    assert.equal(await stock('lh1', 'As shown', 'S'), 1);
  });
});

describe('card payments (fake Stripe)', () => {
  const sign = (raw, t = Math.floor(Date.now() / 1000), secret = WEBHOOK_SECRET) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`;
  const hook = (event, header) => { const raw = JSON.stringify(event); return s.get('/api/stripe-webhook', { method: 'POST', body: raw, headers: { 'stripe-signature': header ?? sign(raw) } }); };
  const paidEvent = (no) => ({ type: 'checkout.session.completed', data: { object: { payment_status: 'paid', client_reference_id: no } } });
  const status = async (no) => (await admin('/admin/api/orders')).body.find((x) => x.no === no).status;

  it('prices the Stripe checkout on the server and saves the order as unpaid', async () => {
    const o = order({ items: [{ id: 'co2', colour: 'As shown', size: 'M', qty: 2 }], delivery: 'delivery', address: '1 Queen St' });
    const r = await post('/api/checkout', { ...o, items: o.items.map((i) => ({ ...i, price: 1 })) }); // a price from the browser is ignored
    assert.equal(r.status, 200);
    assert.match(r.body.url, /^https:\/\/checkout\.stripe\.test\//);
    const form = s.stripe.created.at(-1);
    assert.equal(form.client_reference_id, o.no);
    assert.equal(form['line_items[0][price_data][unit_amount]'], '10900');
    assert.equal(form['line_items[0][quantity]'], '2');
    assert.equal(form['line_items[1][price_data][unit_amount]'], '1200');
    assert.equal(await status(o.no), 'pending_payment');
  });
  it('marks the order paid when the customer comes back after paying, once', async () => {
    const before = await stock('co1', 'As shown', 'M');
    const o = order({ items: [{ id: 'co1', colour: 'As shown', size: 'M', qty: 1 }] });
    await post('/api/checkout', o);
    const id = Object.values(s.stripe.sessions).find((x) => x.client_reference_id === o.no).id;
    assert.deepEqual((await json(`/api/session?id=${id}`)).body, { paid: false, no: o.no });
    s.stripe.pay(id);
    assert.deepEqual((await json(`/api/session?id=${id}`)).body, { paid: true, no: o.no });
    await json(`/api/session?id=${id}`);
    assert.equal(await status(o.no), 'paid');
    assert.equal(await stock('co1', 'As shown', 'M'), before - 1);
  });
  it('accepts only correctly signed, recent webhooks', async () => {
    const o = order(); await post('/api/order', o);
    const raw = JSON.stringify(paidEvent(o.no));
    assert.equal((await hook(paidEvent(o.no), 'nonsense')).status, 400);
    assert.equal((await hook(paidEvent(o.no), sign(raw, undefined, 'whsec_wrong'))).status, 400);
    assert.equal((await hook(paidEvent(o.no), sign(raw, Math.floor(Date.now() / 1000) - 600))).status, 400, 'too old');
    assert.equal((await hook({ ...paidEvent(o.no), extra: 1 }, sign(raw))).status, 400, 'body changed after signing');
    assert.equal(await status(o.no), 'awaiting_payment');
    assert.equal((await hook(paidEvent(o.no))).status, 200);
    assert.equal(await status(o.no), 'paid');
  });
  it('closes the Stripe checkout when an unpaid card order is cancelled', async () => {
    const o = order(); await post('/api/checkout', o);
    const sess = Object.values(s.stripe.sessions).find((x) => x.client_reference_id === o.no);
    const r = await admin(`/admin/api/orders/${o.no}`, { method: 'POST', body: JSON.stringify({ status: 'cancelled' }) });
    assert.equal(r.body.status, 'cancelled');
    assert.equal(sess.status, 'expired');
  });
  it('refuses to cancel a card order whose payment just went through', async () => {
    const o = order(); await post('/api/checkout', o);
    const sess = Object.values(s.stripe.sessions).find((x) => x.client_reference_id === o.no);
    s.stripe.pay(sess.id); // paid at Stripe, webhook not arrived yet
    const r = await admin(`/admin/api/orders/${o.no}`, { method: 'POST', body: JSON.stringify({ status: 'cancelled' }) });
    assert.equal(r.status, 409);
    assert.equal(await status(o.no), 'pending_payment');
    await hook(paidEvent(o.no));
    assert.equal(await status(o.no), 'paid');
  });
});

describe('admin catalogue', () => {
  it('saves edits and refuses stale or invalid saves', async () => {
    const { body: data } = await admin('/admin/api/data');
    const edited = structuredClone(data);
    edited.products[0].price = 301;
    const ok = await admin('/admin/api/catalogue', { method: 'PUT', body: JSON.stringify(edited) });
    assert.equal(ok.status, 200);
    assert.equal((await json('/products.json')).body[0].price, 301);
    assert.equal((await admin('/admin/api/catalogue', { method: 'PUT', body: JSON.stringify(edited) })).status, 409, 'old version must be refused');
    const fresh = (await admin('/admin/api/data')).body;
    fresh.products[0].colours[0].photos = [];
    assert.match((await admin('/admin/api/catalogue', { method: 'PUT', body: JSON.stringify(fresh) })).body.error, /photo/);
  });
  it('refuses a save made before a paid order changed stock', async () => {
    const { body: data } = await admin('/admin/api/data');
    const o = order(); await post('/api/order', o);
    await admin(`/admin/api/orders/${o.no}`, { method: 'POST', body: JSON.stringify({ status: 'paid' }) });
    assert.equal((await admin('/admin/api/catalogue', { method: 'PUT', body: JSON.stringify(data) })).status, 409);
  });
  it('switches "Plan by occasion" on and off', async () => {
    assert.equal((await admin('/admin/api/settings', { method: 'PUT', body: JSON.stringify({ planner: 'no' }) })).status, 400);
    assert.equal((await s.get('/admin/api/settings', { method: 'PUT', body: JSON.stringify({ planner: false }) })).status, 401);
    assert.deepEqual((await admin('/admin/api/settings', { method: 'PUT', body: JSON.stringify({ planner: false }) })).body, { planner: false });
    assert.deepEqual((await json('/api/settings')).body, { planner: false });
    await admin('/admin/api/settings', { method: 'PUT', body: JSON.stringify({ planner: true }) });
    assert.deepEqual((await json('/api/settings')).body, { planner: true });
  });
  it('uploads photos (images only, up to 5 MB) and serves them', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    const up = await admin('/admin/api/photo', { method: 'POST', headers: { 'content-type': 'image/png' }, body: png });
    assert.equal(up.status, 200);
    const served = await s.get(up.body.url);
    assert.equal(served.status, 200);
    assert.equal(served.headers.get('content-type'), 'image/png');
    assert.deepEqual(new Uint8Array(await served.arrayBuffer()), png);
    assert.equal((await admin('/admin/api/photo', { method: 'POST', headers: { 'content-type': 'text/html' }, body: '<script>' })).status, 400);
    assert.equal((await admin('/admin/api/photo', { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: new Uint8Array(5 * 1024 * 1024 + 1) })).status, 400);
    assert.equal((await s.get('/admin/api/photo', { method: 'POST', headers: { 'content-type': 'image/png' }, body: png })).status, 401);
  });
});

describe('rate limits (runs last: it uses up the sign-in limit)', () => {
  it('slows down password guessing even when requests run in parallel', async () => {
    const tries = await Promise.all(Array.from({ length: 15 }, () =>
      s.get('/admin/login', { method: 'POST', body: new URLSearchParams({ name: ADMIN.name, password: 'guess' }) })));
    const codes = tries.map((r) => r.status);
    assert.ok(codes.includes(429), `expected some 429s, got ${codes.join(',')}`);
    assert.ok(codes.every((c) => c === 401 || c === 429));
  });
});
