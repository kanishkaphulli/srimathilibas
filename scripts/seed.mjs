// One-off: turn products.json and promos.json into SQL for the D1 database.
// Run: node scripts/seed.mjs > seed.sql && npx wrangler d1 execute srimathilibas --remote --file seed.sql
// INSERT OR IGNORE, so running it again never overwrites edits made in the admin page.
import { readFileSync } from 'node:fs';

const read = (f) => JSON.parse(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'));
const q = (v) => (typeof v === 'number' ? String(v) : `'${String(v ?? '').replace(/'/g, "''")}'`);

const lines = [];
read('products.json').forEach((p, i) =>
  lines.push(`INSERT OR IGNORE INTO products (id,cat,name,price,img,sizes,sort) VALUES (${[p.id, p.cat, p.name, p.price, p.img, JSON.stringify(p.sizes), i].map(q).join(',')});`));
read('promos.json').forEach((p, i) =>
  lines.push(`INSERT OR IGNORE INTO promos (id,tag,title,text,until,active,sort) VALUES (${[p.id, p.tag, p.title, p.text, p.until, p.active ? 1 : 0, i].map(q).join(',')});`));
console.log(lines.join('\n'));
