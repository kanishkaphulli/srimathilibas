// Cloudflare Worker: serves the static site, plus
//  - /admin and /admin/api/*  need a signed-in session; /admin/login checks the ADMIN_USERS secret ("name:password,name2:password2")
//  - /products.json, /promos.json  read from the D1 database (DB)
//  - /photos/<key>             product photos from R2 (PHOTOS)
//  - /api/order                saves a bank-transfer order
//  - /api/checkout             saves a card order and creates a Stripe Checkout session (priced on the server)
//  - /api/session              tells the shop whether a returning Stripe session was paid
//  - /api/stripe-webhook       Stripe tells us a payment went through, even if the customer closed the tab
// Secrets (set with `npx wrangler secret put NAME`): ADMIN_USERS, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET

import { lineItems, stockPath, namePath } from './order.js';
import { validateProducts, validatePromos } from './validate.js';
import { makeSession, readSession } from './session.js';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const STATUSES = ['pending_payment', 'awaiting_payment', 'paid', 'shipped', 'cancelled'];

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === '/admin' || path.startsWith('/admin.') || path.startsWith('/admin/')) {
      if (path === '/admin/login') return req.method === 'POST' ? login(req, env) : loginPage(env);
      if (path === '/admin/logout' && req.method === 'POST') return logout();
      const who = await currentAdmin(req, env);
      if (!who) return path.startsWith('/admin/api/') ? json({ error: 'You have been signed out. Please sign in again.' }, 401) : redirect('/admin/login');
      if (path.startsWith('/admin/api/')) {
        try { return await adminApi(req, env, path.slice('/admin/api/'.length), who); }
        catch (e) { return json({ error: e.status ? e.message : 'Something went wrong — please try again' }, e.status || 500); }
      }
      return env.ASSETS.fetch(req);
    }
    if (path === '/products.json') return json(await getProducts(env));
    if (path === '/promos.json') return json(await getPromos(env));
    if (path.startsWith('/photos/')) return photo(env, path.slice('/photos/'.length));
    if (path === '/api/payments') return json({ card: !!env.STRIPE_SECRET_KEY });
    if (path === '/api/settings') return json(await getSettings(env));
    if (path === '/api/order' && req.method === 'POST') return placeOrder(req, env, 'bank');
    if (path === '/api/checkout' && req.method === 'POST') return placeOrder(req, env, 'card', url);
    if (path === '/api/session') return session(url, env);
    if (path === '/api/stripe-webhook' && req.method === 'POST') return webhook(req, env);
    if (path.startsWith('/api/')) return json({ error: 'Not found' }, 404);
    return env.ASSETS.fetch(req);
  },
};

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

// ---- Admin sign-in: a form checks ADMIN_USERS, then a signed session cookie (12 hours) ----
const SESSION_HOURS = 12;
const COOKIE = 'sl_admin';
const cookieFlags = 'Path=/; HttpOnly; Secure; SameSite=Lax';
const redirect = (to, headers = {}) => new Response(null, { status: 303, headers: { location: to, 'cache-control': 'no-store', ...headers } });

async function currentAdmin(req, env) {
  const m = (req.headers.get('cookie') || '').match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]+)'));
  return m ? readSession(m[1], env.ADMIN_USERS) : null;
}

async function login(req, env) {
  if (!env.ADMIN_USERS) return loginPage(env);
  let name = '', password = '';
  try { const f = await req.formData(); name = String(f.get('name') || '').trim(); password = String(f.get('password') || ''); } catch {}
  const given = name + ':' + password;
  let ok = false;
  for (const pair of env.ADMIN_USERS.split(',').map((p) => p.trim()).filter(Boolean)) if (await same(given, pair)) ok = true;
  if (!ok || !name) {
    await new Promise((r) => setTimeout(r, 600)); // slows down password guessing a little
    return loginPage(env, 'Wrong name or password.', name, 401);
  }
  const token = await makeSession(name, env.ADMIN_USERS, SESSION_HOURS * 3600);
  return redirect('/admin', { 'set-cookie': `${COOKIE}=${token}; ${cookieFlags}; Max-Age=${SESSION_HOURS * 3600}` });
}

function logout() {
  return redirect('/admin/login?out=1', { 'set-cookie': `${COOKIE}=; ${cookieFlags}; Max-Age=0` });
}

function loginPage(env, error = '', name = '', status = 200) {
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const note = !env.ADMIN_USERS ? 'Admin is locked: no admin users are set up yet.' : error;
  return new Response(`<!doctype html><html lang="en-NZ"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>Sign in · Srimathi Libas Admin</title>
<link href="https://fonts.googleapis.com/css2?family=Chivo:wght@400;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0}body{min-height:100vh;display:grid;place-items:center;background:#f6f3f1;color:#1d1a19;font:400 15px/1.5 "Chivo",system-ui,sans-serif;padding:16px}
form{width:min(360px,100%);background:#fff;border:1px solid #e8e3df;padding:28px;display:grid;gap:14px}
.logo{color:#7a1f2b;font-weight:700;font-size:18px}h1{font-size:20px;letter-spacing:-.01em}
label{display:grid;gap:4px;font-size:13px;font-weight:700}input{font:inherit;font-size:15px;border:1px solid #ddd5d1;padding:10px 12px;width:100%}
input:focus{outline:none;border-color:#1d1a19}button{font:700 14px/1 "Chivo",sans-serif;background:#7a1f2b;color:#fff;border:0;padding:13px;cursor:pointer}
button:hover{background:#5f1721}.msg{font-size:13px;color:#b3261e}.ok{font-size:13px;color:#1f7a45}a{color:#6b6461;font-size:13px}
</style></head><body>
<form method="post" action="/admin/login">
<div class="logo">Srimathi Libas</div><h1>Admin sign in</h1>
${note ? `<p class="msg" role="alert">${esc(note)}</p>` : ''}<p class="ok" id="out" hidden>You have signed out.</p>
<label>Name<input name="name" autocomplete="username" required value="${esc(name)}" ${name ? '' : 'autofocus'}></label>
<label>Password<input name="password" type="password" autocomplete="current-password" required ${name ? 'autofocus' : ''}></label>
<button type="submit">Sign in</button>
<a href="/">Back to the shop</a>
</form>
<script>if(new URLSearchParams(location.search).has('out'))document.getElementById('out').hidden=false</script>
</body></html>`, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY' } });
}
// Constant-time compare of SHA-256 digests, so timing doesn't leak how much of a secret matched
async function same(a, b) {
  const enc = (s) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  const [x, y] = await Promise.all([enc(a), enc(b)]);
  return crypto.subtle.timingSafeEqual(x, y);
}

// ---- Catalogue ----
async function getProducts(env) {
  const { results } = await env.DB.prepare('SELECT id,cat,name,price,sizes,colours FROM products ORDER BY sort, rowid').all();
  return results.map((p) => ({ ...p, sizes: JSON.parse(p.sizes), colours: JSON.parse(p.colours) }));
}
async function getPromos(env) {
  const { results } = await env.DB.prepare('SELECT id,tag,title,text,until,active FROM promos ORDER BY sort, rowid').all();
  return results.map((p) => ({ ...p, active: !!p.active }));
}
// Shop on/off switches, stored in the meta table as 0/1; a missing row means the feature is on
const SETTINGS = ['planner'];
async function getSettings(env) {
  const { results } = await env.DB.prepare(`SELECT key, value FROM meta WHERE key IN (${SETTINGS.map(() => '?').join(',')})`).bind(...SETTINGS).all();
  const s = Object.fromEntries(SETTINGS.map((k) => [k, true]));
  results.forEach((r) => { s[r.key] = !!r.value; });
  return s;
}
const version = async (env) => (await env.DB.prepare("SELECT value FROM meta WHERE key='version'").first('value')) || 0;

// ---- Photos (R2) ----
async function photo(env, key) {
  if (!/^[\w.-]{1,80}$/.test(key)) return new Response('Not found', { status: 404 });
  const obj = await env.PHOTOS.get(key);
  if (!obj) return new Response('Not found', { status: 404 });
  return new Response(obj.body, { headers: { 'content-type': obj.httpMetadata?.contentType || 'application/octet-stream', 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' } });
}
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' };
async function uploadPhoto(req, env) {
  const type = (req.headers.get('content-type') || '').split(';')[0];
  if (!IMAGE_TYPES[type]) throw new HttpError(400, 'Please upload a JPG, PNG, WebP or AVIF image');
  const body = await req.arrayBuffer();
  if (!body.byteLength) throw new HttpError(400, 'The file is empty');
  if (body.byteLength > 5 * 1024 * 1024) throw new HttpError(400, 'Photo is larger than 5 MB — please use a smaller one');
  const key = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}.${IMAGE_TYPES[type]}`;
  await env.PHOTOS.put(key, body, { httpMetadata: { contentType: type } });
  return { url: `/photos/${key}` };
}

// ---- Orders ----
async function placeOrder(req, env, payMethod, url) {
  if (payMethod === 'card' && !env.STRIPE_SECRET_KEY) return json({ error: 'Card payment is not set up yet.' }, 503);
  let order;
  try { order = await req.json(); } catch { return json({ error: 'Bad request' }, 400); }
  if (!String(order.name || '').trim() || !/^[\d\s+()-]{7,30}$/.test(order.phone || '')) return json({ error: 'Name and phone are required' }, 400);

  let items;
  try { items = lineItems(await getProducts(env), order); } catch (e) { return json({ error: e.message }, 400); }
  const goods = items.filter((i) => !i.shipping);
  const subtotal = goods.reduce((t, i) => t + i.amount * i.qty, 0) / 100;
  const shipping = (items.find((i) => i.shipping)?.amount || 0) / 100;
  const clip = (s, n) => String(s || '').slice(0, n);
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(order.email || '') ? clip(order.email, 120) : '';
  const delivery = order.delivery === 'delivery' ? 'delivery' : 'pickup';

  try {
    await env.DB.prepare(`INSERT INTO orders (no,created_at,status,pay_method,name,phone,email,delivery,address,notes,items,subtotal,shipping,total)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      order.no, new Date().toISOString(), payMethod === 'card' ? 'pending_payment' : 'awaiting_payment', payMethod,
      clip(order.name, 80), clip(order.phone, 30), email, delivery, delivery === 'delivery' ? clip(order.address, 300) : '', clip(order.notes, 300),
      JSON.stringify(goods.map(({ id, colour, size, qty, name, amount }) => ({ id, colour, size, qty, name, price: amount / 100 }))), subtotal, shipping, subtotal + shipping,
    ).run();
  } catch {
    return json({ error: 'Could not save your order — please try again.' }, 409);
  }
  if (payMethod === 'bank') return json({ no: order.no, total: subtotal + shipping });

  const f = new URLSearchParams({
    mode: 'payment',
    success_url: `${url.origin}/?paid={CHECKOUT_SESSION_ID}`,
    cancel_url: `${url.origin}/?cancelled=1`,
    client_reference_id: order.no,
    'payment_intent_data[description]': `Order ${order.no}`,
    'metadata[order]': order.no,
  });
  if (email) f.set('customer_email', email);
  items.forEach((it, i) => {
    f.set(`line_items[${i}][price_data][currency]`, 'nzd');
    f.set(`line_items[${i}][price_data][unit_amount]`, String(it.amount));
    f.set(`line_items[${i}][price_data][product_data][name]`, it.name);
    f.set(`line_items[${i}][quantity]`, String(it.qty));
  });
  const r = await stripe(env, 'checkout/sessions', { method: 'POST', body: f });
  if (!r.ok) {
    await env.DB.prepare("UPDATE orders SET status='cancelled' WHERE no=? AND status='pending_payment'").bind(order.no).run();
    return json({ error: 'Card payment is unavailable right now.' }, 502);
  }
  const s = await r.json();
  await env.DB.prepare('UPDATE orders SET stripe_session=? WHERE no=?').bind(s.id, order.no).run();
  return json({ url: s.url });
}

// Marks an order paid and takes its items off stock — all in one transaction, and only once per order
async function markPaid(env, no) {
  const order = await env.DB.prepare('SELECT items FROM orders WHERE no=?').bind(no).first();
  if (!order) return false;
  const pending = "EXISTS (SELECT 1 FROM orders WHERE no=?1 AND status='paid' AND stock_applied=0)";
  await env.DB.batch([
    env.DB.prepare("UPDATE orders SET status='paid' WHERE no=? AND status IN ('pending_payment','awaiting_payment')").bind(no),
    ...stockChanges(env, JSON.parse(order.items), await getProducts(env), -1, pending, no),
    env.DB.prepare("UPDATE meta SET value = value + 1 WHERE key='version' AND " + pending).bind(no),
    env.DB.prepare("UPDATE orders SET stock_applied=1 WHERE no=? AND status='paid'").bind(no),
  ]);
  return true;
}
// Cancelling puts stock back if it had been taken
async function cancelOrder(env, no) {
  const order = await env.DB.prepare('SELECT items FROM orders WHERE no=?').bind(no).first();
  if (!order) throw new HttpError(404, 'Order not found');
  const taken = "EXISTS (SELECT 1 FROM orders WHERE no=?1 AND status='cancelled' AND stock_applied=1)";
  await env.DB.batch([
    env.DB.prepare("UPDATE orders SET status='cancelled' WHERE no=?").bind(no),
    ...stockChanges(env, JSON.parse(order.items), await getProducts(env), +1, taken, no),
    env.DB.prepare("UPDATE meta SET value = value + 1 WHERE key='version' AND " + taken).bind(no),
    env.DB.prepare("UPDATE orders SET stock_applied=0 WHERE no=? AND status='cancelled'").bind(no),
  ]);
}
// One UPDATE per item; `guard` (using ?1 = order no) makes them no-ops unless this order's stock change is due
// Colours are found by position, so each UPDATE also checks the colour at that position still has the same name
function stockChanges(env, items, products, sign, guard, no) {
  return items.flatMap((i) => {
    const at = products.find((p) => p.id === i.id)?.colours.findIndex((c) => c.name === i.colour) ?? -1;
    if (at < 0) return []; // product or colour was deleted since; nothing to adjust
    return [env.DB.prepare(
      `UPDATE products SET colours = json_set(colours, ?2, MAX(0, COALESCE(json_extract(colours, ?2), 0) + ?3)) WHERE id = ?4 AND json_extract(colours, ?5) = ?6 AND ${guard}`,
    ).bind(no, stockPath(at, i.size), sign * i.qty, i.id, namePath(at), i.colour)];
  });
}

// ---- Stripe ----
async function session(url, env) {
  const id = url.searchParams.get('id') || '';
  if (!env.STRIPE_SECRET_KEY || !/^cs_(test|live)_[A-Za-z0-9]+$/.test(id)) return json({ paid: false });
  const r = await stripe(env, `checkout/sessions/${id}`);
  if (!r.ok) return json({ paid: false });
  const s = await r.json();
  const paid = s.payment_status === 'paid';
  if (paid && s.client_reference_id) await markPaid(env, s.client_reference_id);
  return json({ paid, no: s.client_reference_id });
}

async function webhook(req, env) {
  if (!env.STRIPE_WEBHOOK_SECRET) return json({ error: 'Webhook not set up' }, 503);
  const raw = await req.text();
  const sig = Object.fromEntries((req.headers.get('stripe-signature') || '').split(',').map((kv) => kv.split('=')));
  if (!sig.t || !sig.v1 || Math.abs(Date.now() / 1000 - Number(sig.t)) > 300) return json({ error: 'Bad signature' }, 400);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${sig.t}.${raw}`)));
  const expected = [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (!(await same(expected, sig.v1))) return json({ error: 'Bad signature' }, 400);

  const event = JSON.parse(raw);
  const s = event.data?.object;
  if (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type) && s?.payment_status === 'paid' && s.client_reference_id) {
    await markPaid(env, s.client_reference_id);
  }
  return json({ received: true });
}

function stripe(env, path, init = {}) {
  return fetch(`https://api.stripe.com/v1/${path}`, {
    ...init,
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'content-type': 'application/x-www-form-urlencoded' },
  });
}

// ---- Admin API (already signed in) ----
async function adminApi(req, env, route, who) {
  const body = async () => { try { return await req.json(); } catch { throw new HttpError(400, 'Bad request'); } };

  if (route === 'data' && req.method === 'GET') {
    const [products, promos, v, settings] = await Promise.all([getProducts(env), getPromos(env), version(env), getSettings(env)]);
    return json({ products, promos, version: v, settings, user: who.u });
  }
  if (route === 'settings' && req.method === 'PUT') {
    const s = await body();
    const changes = SETTINGS.filter((k) => k in s);
    if (!changes.length || changes.some((k) => typeof s[k] !== 'boolean')) throw new HttpError(400, 'Invalid settings');
    await env.DB.batch(changes.map((k) => env.DB.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').bind(k, s[k] ? 1 : 0)));
    return json(await getSettings(env));
  }
  if (route === 'catalogue' && req.method === 'PUT') {
    const { products, promos, version: v } = await body();
    const err = validateProducts(products) || validatePromos(promos);
    if (err) throw new HttpError(400, err);
    // Refuse if anything changed since this admin loaded (e.g. a paid order took stock)
    if (v !== (await version(env))) throw new HttpError(409, 'Stock or products changed since you opened this page. Reload to get the latest, then make your edits again.');
    // One transaction: claim the version with a fresh random stamp, and every later statement only runs if the
    // claim won. A paid order bumping the version in between makes the claim (and so the whole save) a no-op.
    const nv = 2 + Math.floor(Math.random() * 2 ** 50);
    const won = "(SELECT value FROM meta WHERE key='version') = ?";
    const res = await env.DB.batch([
      env.DB.prepare("UPDATE meta SET value = ? WHERE key='version' AND value = ?").bind(nv, v),
      env.DB.prepare(`DELETE FROM products WHERE ${won}`).bind(nv),
      env.DB.prepare(`DELETE FROM promos WHERE ${won}`).bind(nv),
      ...products.map((p, i) => env.DB.prepare(`INSERT INTO products (id,cat,name,price,sizes,colours,sort) SELECT ?,?,?,?,?,?,? WHERE ${won}`)
        .bind(p.id, p.cat.trim(), p.name.trim(), p.price, JSON.stringify(p.sizes), JSON.stringify(p.colours.map((c) => ({ ...c, name: c.name.trim() }))), i, nv)),
      ...promos.map((p, i) => env.DB.prepare(`INSERT INTO promos (id,tag,title,text,until,active,sort) SELECT ?,?,?,?,?,?,? WHERE ${won}`)
        .bind(p.id, p.tag.trim(), p.title.trim(), p.text.trim(), p.until, p.active ? 1 : 0, i, nv)),
    ]);
    if (!res[0].meta.changes) throw new HttpError(409, 'Stock or products changed while you were saving. Reload to get the latest, then make your edits again.');
    return json({ version: nv });
  }
  if (route === 'orders' && req.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 200').all();
    return json(results.map((o) => ({ ...o, items: JSON.parse(o.items) })));
  }
  const m = route.match(/^orders\/(SL-\d{6}-[A-Z0-9]{4})$/);
  if (m && req.method === 'POST') {
    const { status } = await body();
    if (!STATUSES.includes(status)) throw new HttpError(400, 'Unknown status');
    const no = m[1];
    if (status === 'paid') { if (!(await markPaid(env, no))) throw new HttpError(404, 'Order not found'); }
    else if (status === 'cancelled') await cancelOrder(env, no);
    else if (status === 'shipped') {
      const r = await env.DB.prepare("UPDATE orders SET status='shipped' WHERE no=? AND status IN ('paid','shipped')").bind(no).run();
      if (!r.meta.changes) throw new HttpError(400, 'Only paid orders can be marked shipped');
    } else throw new HttpError(400, 'That status is set automatically');
    return json(await env.DB.prepare('SELECT status FROM orders WHERE no=?').bind(no).first());
  }
  if (route === 'photo' && req.method === 'POST') return json(await uploadPhoto(req, env));
  throw new HttpError(404, 'Not found');
}
