// Starts the real Worker (wrangler dev) against a throwaway database and photo store,
// seeded from schema.sql + products.json/promos.json. Nothing touches the live site or your local dev data.
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url)); // decodes %20 etc. (this folder path has spaces)
export const ADMIN = { name: 'tester', password: 'test-only-pass' };
export const ADMIN2 = { name: 'second', password: 'second-test-pass' };
export const WEBHOOK_SECRET = 'whsec_test_only';

// A tiny stand-in for Stripe's Checkout API: create, read and expire sessions. pay(id) acts as the customer paying.
async function fakeStripe() {
  const sessions = {}, created = [];
  let n = 0;
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
      const m = req.url.match(/^\/v1\/checkout\/sessions(?:\/([\w]+))?(\/expire)?$/);
      if (!m) return send(404, {});
      if (req.method === 'POST' && !m[1]) {
        const form = Object.fromEntries(new URLSearchParams(raw));
        const id = `cs_test_fake${++n}`;
        sessions[id] = { id, url: `https://checkout.stripe.test/${id}`, status: 'open', payment_status: 'unpaid', client_reference_id: form.client_reference_id };
        created.push(form);
        return send(200, sessions[id]);
      }
      const s = sessions[m[1]];
      if (!s) return send(404, {});
      if (m[2]) { if (s.status !== 'open') return send(400, { error: 'not open' }); s.status = 'expired'; return send(200, s); }
      return send(200, s);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${server.address().port}`, sessions, created,
    pay(id) { Object.assign(sessions[id], { status: 'complete', payment_status: 'paid' }); },
    close: () => new Promise((r) => server.close(r)),
  };
}

// Use the node/npx that are running these tests: npm's PATH may not include them
const NODE = process.execPath, NPX = join(dirname(process.execPath), 'npx');
const ENV = { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH || ''}` };
const wrangler = (args, opts = {}) => execFileSync(NPX, ['--yes', 'wrangler@4', ...args], { cwd: ROOT, stdio: 'pipe', env: ENV, ...opts });

export async function startServer() {
  const dir = mkdtempSync(join(tmpdir(), 'srimathi-test-'));
  const state = join(dir, 'state');
  // Test-only secrets; Stripe calls go to the local fake
  const stripe = await fakeStripe();
  const envFile = join(dir, 'test.env');
  writeFileSync(envFile, [`ADMIN_USERS=${ADMIN.name}:${ADMIN.password},${ADMIN2.name}:${ADMIN2.password}`,
    'STRIPE_SECRET_KEY=sk_test_fake', `STRIPE_WEBHOOK_SECRET=${WEBHOOK_SECRET}`, `STRIPE_API=${stripe.url}`, ''].join('\n'));
  const seed = join(dir, 'seed.sql');
  writeFileSync(seed, execFileSync(NODE, ['scripts/seed.mjs'], { cwd: ROOT }));
  for (const file of [join(ROOT, 'schema.sql'), seed]) wrangler(['d1', 'execute', 'srimathilibas', '--local', '--persist-to', state, '--file', file]);

  const port = 8800 + Math.floor(Math.random() * 900);
  const proc = spawn(NPX, ['--yes', 'wrangler@4', 'dev', '--port', String(port), '--ip', '127.0.0.1', '--persist-to', state,
    '--env-file', envFile, '--show-interactive-dev-session=false'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: ENV });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });

  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; ; i++) {
    if (proc.exitCode !== null) throw new Error('wrangler dev exited:\n' + log);
    try { if ((await fetch(base + '/api/settings')).ok) break; } catch {}
    if (i > 120) { proc.kill(); await stripe.close(); throw new Error('wrangler dev did not start in time:\n' + log); }
    await new Promise((r) => setTimeout(r, 500));
  }

  return {
    base,
    stripe,
    log: () => log,
    // fetch relative to the server; never follows redirects so tests can see them
    get: (path, init = {}) => fetch(base + path, { redirect: 'manual', ...init }),
    async stop() {
      proc.kill('SIGTERM');
      await new Promise((r) => (proc.exitCode !== null ? r() : proc.once('exit', r)));
      await stripe.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

// Signs in through the real form and returns a Cookie header value
export async function signIn(server, who = ADMIN) {
  const res = await server.get('/admin/login', { method: 'POST', body: new URLSearchParams({ name: who.name, password: who.password }) });
  if (res.status !== 303) throw new Error(`sign-in failed: ${res.status}`);
  return res.headers.get('set-cookie').split(';')[0];
}
