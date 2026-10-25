// Checks admin edits before they reach the database. Returns '' when fine, else a message for the admin.
export function validateProducts(products) {
  if (!Array.isArray(products) || products.length > 500) return 'Invalid product list';
  const ids = new Set();
  for (const [i, p] of products.entries()) {
    const n = `Product ${i + 1}`;
    if (typeof p?.id !== 'string' || !/^[\w-]{1,40}$/.test(p.id)) return `${n}: invalid id`;
    if (ids.has(p.id)) return `${n}: duplicate id`;
    ids.add(p.id);
    if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 120) return `${n}: name is required`;
    if (typeof p.cat !== 'string' || !p.cat.trim() || p.cat.length > 60) return `${n}: category is required`;
    if (typeof p.price !== 'number' || !(p.price >= 0) || p.price > 100000) return `${n}: price must be 0 or more`;
    const label = p.name.trim();

    const sizes = Array.isArray(p.sizes) ? p.sizes : [];
    if (!sizes.length || sizes.length > 20) return `${label}: add at least one size`;
    if (sizes.some((s) => typeof s !== 'string' || !s.trim() || s.length > 20 || /["\\]/.test(s))) return `${label}: size names can't be empty or contain quotes`;
    if (new Set(sizes).size !== sizes.length) return `${label}: the same size is listed twice`;

    const colours = Array.isArray(p.colours) ? p.colours : [];
    if (!colours.length || colours.length > 12) return `${label}: add at least one colour`;
    const names = new Set();
    for (const c of colours) {
      const cn = `${label} (${c?.name || 'unnamed colour'})`;
      if (typeof c?.name !== 'string' || !c.name.trim() || c.name.length > 30) return `${label}: every colour needs a name`;
      if (names.has(c.name.trim())) return `${label}: colour "${c.name}" is listed twice`;
      names.add(c.name.trim());
      if (typeof c.hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(c.hex)) return `${cn}: pick a swatch colour`;
      if (!Array.isArray(c.photos) || !c.photos.length) return `${cn}: add at least one photo`;
      if (c.photos.length > 8) return `${cn}: up to 8 photos per colour`;
      if (c.photos.some((u) => typeof u !== 'string' || !/^(https:\/\/|\/photos\/)/.test(u) || u.length > 500)) return `${cn}: a photo link is invalid`;
      const stock = c.stock && typeof c.stock === 'object' && !Array.isArray(c.stock) ? Object.entries(c.stock) : null;
      if (!stock) return `${cn}: stock is missing`;
      for (const [s, q] of stock) {
        if (!sizes.includes(s)) return `${cn}: stock for unknown size "${s}"`;
        if (!Number.isInteger(q) || q < 0 || q > 10000) return `${cn}, size ${s}: stock must be a whole number, 0 or more`;
      }
    }
  }
  return '';
}

export function validatePromos(promos) {
  if (!Array.isArray(promos) || promos.length > 50) return 'Invalid promo list';
  const ids = new Set();
  for (const [i, p] of promos.entries()) {
    const n = `Promo ${i + 1}`;
    if (typeof p?.id !== 'string' || !/^[\w-]{1,40}$/.test(p.id) || ids.has(p.id)) return `${n}: invalid id`;
    ids.add(p.id);
    if (typeof p.title !== 'string' || !p.title.trim() || p.title.length > 120) return `${n}: title is required`;
    if (typeof p.tag !== 'string' || p.tag.length > 30) return `${n}: label is too long`;
    if (typeof p.text !== 'string' || p.text.length > 500) return `${n}: details are too long`;
    if (typeof p.until !== 'string' || (p.until && !/^\d{4}-\d{2}-\d{2}$/.test(p.until))) return `${n}: end date is invalid`;
    if (typeof p.active !== 'boolean') return `${n}: invalid active setting`;
  }
  return '';
}
