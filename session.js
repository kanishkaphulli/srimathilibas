// Signed admin session tokens: "<payload>.<signature>", payload = {u: name, exp: unix seconds}.
// The signing key is derived from the ADMIN_USERS secret, so changing the admin list ends every session.
const enc = new TextEncoder();
const toB64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function key(secret) {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode('sl-admin-session:' + secret));
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function makeSession(user, secret, ttlSeconds, now = Date.now()) {
  const payload = toB64u(enc.encode(JSON.stringify({ u: user, exp: Math.floor(now / 1000) + ttlSeconds })));
  const sig = toB64u(await crypto.subtle.sign('HMAC', await key(secret), enc.encode(payload)));
  return `${payload}.${sig}`;
}

// Returns {u, exp} for a valid, unexpired token, else null. HMAC verify is constant-time.
export async function readSession(token, secret, now = Date.now()) {
  if (typeof token !== 'string' || !secret) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  try {
    if (!(await crypto.subtle.verify('HMAC', await key(secret), fromB64u(sig), enc.encode(payload)))) return null;
    const data = JSON.parse(new TextDecoder().decode(fromB64u(payload)));
    return typeof data.u === 'string' && data.exp > now / 1000 ? data : null;
  } catch {
    return null;
  }
}
