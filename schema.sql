-- Run once: npx wrangler d1 execute srimathilibas --remote --file schema.sql
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  cat TEXT NOT NULL,
  name TEXT NOT NULL,
  price REAL NOT NULL,
  img TEXT NOT NULL,
  sizes TEXT NOT NULL,          -- JSON object, size -> stock, e.g. {"S":2,"M":3}
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS promos (
  id TEXT PRIMARY KEY,
  tag TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  until TEXT NOT NULL DEFAULT '', -- YYYY-MM-DD or empty
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
  no TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL,          -- pending_payment | awaiting_payment | paid | shipped | cancelled
  pay_method TEXT NOT NULL,      -- card | bank
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  delivery TEXT NOT NULL,        -- pickup | delivery
  address TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  items TEXT NOT NULL,           -- JSON array of {id,size,qty,name,price}
  subtotal REAL NOT NULL,
  shipping REAL NOT NULL,
  total REAL NOT NULL,
  stripe_session TEXT NOT NULL DEFAULT '',
  stock_applied INTEGER NOT NULL DEFAULT 0  -- 1 once this order's items were taken off stock
);
CREATE INDEX IF NOT EXISTS orders_created ON orders (created_at DESC);

-- Catalogue version: bumped on every product/promo/stock change, so an admin save can't overwrite newer stock
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
INSERT OR IGNORE INTO meta (key, value) VALUES ('version', 1);
