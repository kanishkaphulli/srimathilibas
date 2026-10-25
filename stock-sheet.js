// Stock spreadsheet for the admin page: one row per product colour, one column per size.
//   Product ID | Product | Colour | XS | S | M | ...
// Used by admin.html (with SheetJS for .xlsx) and worker.test.mjs.

const ID = /^product\s*id$/i, NAME = /^product(\s*name)?$/i, COLOUR = /^colou?r$/i;

// Rows (array of arrays) for downloading the current stock
export function stockRows(products) {
  const sizes = [...new Set(products.flatMap((p) => p.sizes))];
  return [
    ['Product ID', 'Product', 'Colour', ...sizes],
    ...products.flatMap((p) => p.colours.map((c) => [p.id, p.name, c.name, ...sizes.map((s) => (p.sizes.includes(s) ? c.stock[s] ?? 0 : ''))])),
  ];
}

// Applies an uploaded sheet to a copy of the products. Blank cells leave stock unchanged.
// Unknown sizes are added to the product; unknown colours are added (they still need photos before saving).
export function applyStockSheet(products, rows) {
  const out = structuredClone(products);
  const problems = [], newColours = [], newSizes = [];
  let changed = 0;
  const head = (rows[0] || []).map((h) => String(h ?? '').trim());
  const idCol = head.findIndex((h) => ID.test(h)), nameCol = head.findIndex((h) => NAME.test(h)), colourCol = head.findIndex((h) => COLOUR.test(h));
  if ((idCol < 0 && nameCol < 0) || colourCol < 0) {
    return { products: out, changed, newColours, newSizes, problems: ['The first row must have the headings "Product ID" (or "Product"), "Colour" and then one column per size.'] };
  }
  const sizeCols = head.map((h, i) => [h, i]).filter(([h, i]) => h && ![idCol, nameCol, colourCol].includes(i));
  if (sizeCols.some(([h]) => /["\\]/.test(h) || h.length > 20)) problems.push('Size headings can’t contain quotes and must be 20 characters or fewer.');

  rows.slice(1).forEach((row, i) => {
    const line = `Row ${i + 2}`;
    const cell = (c) => (c < 0 ? '' : String(row[c] ?? '').trim());
    if (row.every((v) => String(v ?? '').trim() === '')) return;
    const id = cell(idCol), name = cell(nameCol);
    const p = (id && out.find((x) => x.id === id)) || (name && out.find((x) => x.name.trim().toLowerCase() === name.toLowerCase()));
    if (!p) return problems.push(`${line}: no product with ID "${id}"${name ? ` or name "${name}"` : ''} — add it in the admin page first`);
    let colourName = cell(colourCol);
    if (!colourName && p.colours.length === 1) colourName = p.colours[0].name;
    if (!colourName) return problems.push(`${line}: colour is missing for ${p.name}`);
    let c = p.colours.find((x) => x.name.trim().toLowerCase() === colourName.toLowerCase());
    if (!c) {
      c = { name: colourName.slice(0, 30), hex: '#888888', photos: [], stock: {} };
      p.colours.push(c);
      newColours.push(`${p.name} — ${c.name}`);
    }
    for (const [size, col] of sizeCols) {
      const raw = cell(col);
      if (raw === '' || /["\\]/.test(size) || size.length > 20) continue;
      const q = Number(raw);
      if (!Number.isInteger(q) || q < 0 || q > 10000) { problems.push(`${line}, size ${size}: "${raw}" isn’t a whole number of 0 or more`); continue; }
      if (!p.sizes.includes(size)) { p.sizes.push(size); newSizes.push(`${p.name} — ${size}`); }
      if (c.stock[size] !== q) { c.stock[size] = q; changed++; }
    }
  });
  return { products: out, changed, newColours, newSizes, problems };
}
