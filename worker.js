// Cloudflare Worker: serves the static site, plus
//  - /admin*            locked to the users in the ADMIN_USERS secret ("name:password,name2:password2")
//  - /products.json etc served fresh from GitHub, so admin saves show without redeploying
//  - /api/checkout      creates a Stripe Checkout session, priced on the server from products.json
//  - /api/session       tells the shop whether a returning Stripe session was actually paid
// Secrets (set with `npx wrangler secret put NAME`): ADMIN_USERS, STRIPE_SECRET_KEY

import { lineItems } from './order.js';

const DATA = 'https://raw.githubusercontent.com/kanishkaphulli/srimathilibas/main/';
const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === '/admin' || path.startsWith('/admin.') || path.startsWith('/admin/')) {
      const denied = await checkAdmin(req, env);
      return denied || env.ASSETS.fetch(req);
    }
    if (path === '/products.json' || path === '/promos.json') return fresh(path, env, req);
    if (path === '/api/payments') return json({ card: !!env.STRIPE_SECRET_KEY });
    if (path === '/api/checkout' && req.method === 'POST') return checkout(req, env, url);
    if (path === '/api/session') return session(url, env);
    if (path.startsWith('/api/')) return json({ error: 'Not found' }, 404);
    return env.ASSETS.fetch(req);
  },
};

// ---- Admin login (HTTP Basic over HTTPS) ----
async function checkAdmin(req, env) {
  const ask = (msg) => new Response(msg, { status: 401, headers: { 'www-authenticate': 'Basic realm="Srimathi Libas Admin", charset="UTF-8"', 'cache-control': 'no-store' } });
  if (!env.ADMIN_USERS) return new Response('Admin is locked: no admin users are set up yet.', { status: 503 });
  const m = (req.headers.get('authorization') || '').match(/^Basic\s+(.+)$/i);
  if (!m) return ask('Sign in required');
  let given;
  try { given = new TextDecoder().decode(Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0))); } catch { return ask('Sign in required'); }
  for (const pair of env.ADMIN_USERS.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (await same(given, pair)) return null;
  }
  return ask('Wrong name or password');
}
// Constant-time compare of SHA-256 digests, so timing doesn't leak how much of a password matched
async function same(a, b) {
  const enc = (s) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  const [x, y] = await Promise.all([enc(a), enc(b)]);
  return crypto.subtle.timingSafeEqual(x, y);
}

// ---- Catalogue straight from GitHub (falls back to the deployed copy) ----
async function fresh(path, env, req) {
  if (env.LOCAL_DATA) return env.ASSETS.fetch(req); // local `wrangler dev` uses the files on disk
  try {
    const r = await fetch(DATA + path.slice(1), { cf: { cacheTtl: 30, cacheEverything: true } });
    if (r.ok) return new Response(r.body, { headers: { 'content-type': 'application/json', 'cache-control': 'no-cache' } });
  } catch {}
  return env.ASSETS.fetch(req);
}
async function products(env, url) {
  return (await fresh('/products.json', env, new Request(new URL('/products.json', url)))).json();
}

// ---- Stripe ----
async function checkout(req, env, url) {
  if (!env.STRIPE_SECRET_KEY) return json({ error: 'Card payment is not set up yet.' }, 503);
  let order;
  try { order = await req.json(); } catch { return json({ error: 'Bad request' }, 400); }
  if (!String(order.name || '').trim() || !/^[\d\s+()-]{7,30}$/.test(order.phone || '')) return json({ error: 'Name and phone are required' }, 400);

  let items;
  try { items = lineItems(await products(env, url), order); } catch (e) { return json({ error: e.message }, 400); }

  const clip = (s, n) => String(s || '').slice(0, n);
  const f = new URLSearchParams({
    mode: 'payment',
    success_url: `${url.origin}/?paid={CHECKOUT_SESSION_ID}`,
    cancel_url: `${url.origin}/?cancelled=1`,
    client_reference_id: order.no,
    'payment_intent_data[description]': `Order ${order.no}`,
    'metadata[order]': order.no,
    'metadata[name]': clip(order.name, 80),
    'metadata[phone]': clip(order.phone, 30),
    'metadata[delivery]': order.delivery === 'delivery' ? clip(order.address, 300) : 'Pickup in Auckland',
    'metadata[notes]': clip(order.notes, 300),
  });
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(order.email || '')) f.set('customer_email', clip(order.email, 120));
  items.forEach((it, i) => {
    f.set(`line_items[${i}][price_data][currency]`, 'nzd');
    f.set(`line_items[${i}][price_data][unit_amount]`, String(it.amount));
    f.set(`line_items[${i}][price_data][product_data][name]`, it.name);
    f.set(`line_items[${i}][quantity]`, String(it.qty));
  });

  const r = await stripe(env, 'checkout/sessions', { method: 'POST', body: f });
  if (!r.ok) return json({ error: 'Card payment is unavailable right now.' }, 502);
  return json({ url: (await r.json()).url });
}

async function session(url, env) {
  const id = url.searchParams.get('id') || '';
  if (!env.STRIPE_SECRET_KEY || !/^cs_(test|live)_[A-Za-z0-9]+$/.test(id)) return json({ paid: false });
  const r = await stripe(env, `checkout/sessions/${id}`);
  if (!r.ok) return json({ paid: false });
  const s = await r.json();
  return json({ paid: s.payment_status === 'paid', no: s.client_reference_id });
}

function stripe(env, path, init = {}) {
  return fetch(`https://api.stripe.com/v1/${path}`, {
    ...init,
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'content-type': 'application/x-www-form-urlencoded' },
  });
}
