-- One-off, for databases created before colours existed (the live one):
--   npx wrangler d1 execute srimathilibas --remote --file migrations/0002_colours.sql
-- Each product becomes one colour ("As shown") holding its old photo and stock; sizes becomes the list of size names.
ALTER TABLE products ADD COLUMN colours TEXT NOT NULL DEFAULT '[]';
UPDATE products SET
  colours = json_array(json_object('name', 'As shown', 'hex', '#7a1f2b', 'photos', json_array(img), 'stock', json(sizes))),
  sizes = (SELECT json_group_array(key) FROM json_each(products.sizes));
ALTER TABLE products DROP COLUMN img;
UPDATE meta SET value = value + 1 WHERE key = 'version';
