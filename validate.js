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
    if (typeof p.img !== 'string' || !/^(https:\/\/|\/photos\/)/.test(p.img) || p.img.length > 500) return `${n}: add a photo or an image URL starting with https://`;
    const sizes = p.sizes && typeof p.sizes === 'object' && !Array.isArray(p.sizes) ? Object.entries(p.sizes) : [];
    if (!sizes.length || sizes.length > 20) return `${n}: add at least one size, e.g. S:2, M:3`;
    if (sizes.some(([k, q]) => !k.trim() || k.length > 20 || /["\\]/.test(k) || !Number.isInteger(q) || q < 0 || q > 10000))
      return `${n}: sizes must look like S:2, M:3 (whole numbers, 0 or more)`;
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
