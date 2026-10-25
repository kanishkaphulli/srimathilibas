// Order pricing, shared by worker.js and worker.test.mjs
export const SHIPPING = 12; // keep in sync with SHIPPING in index.html

// Stock for one colour + size of a product (0 when either doesn't exist)
export const stockOf = (p, colour, size) => p?.colours?.find((c) => c.name === colour)?.stock?.[size] || 0;
// Product label on orders: the colour is only worth naming when there's a choice
export const itemName = (p, colour, size) => `${p.name}${p.colours.length > 1 ? ` — ${colour}` : ''} (${size})`;

// Validates the order against the catalogue and returns line items (amounts in cents).
// Never trusts prices from the browser.
export function lineItems(catalogue, order, shipping = SHIPPING) {
  if (!/^SL-\d{6}-[A-Z0-9]{4}$/.test(order?.no || '')) throw new Error('Invalid order number');
  if (!Array.isArray(order.items) || !order.items.length || order.items.length > 20) throw new Error('Your bag is empty');
  const wanted = {}; // same product+colour+size on two lines must still fit the stock together
  const items = order.items.map(({ id, colour, size, qty }) => {
    const p = catalogue.find((x) => x.id === id);
    if (!p) throw new Error('An item in your bag is no longer available');
    if (!Number.isInteger(qty) || qty < 1) throw new Error('Invalid quantity');
    const stock = stockOf(p, colour, size);
    const key = JSON.stringify([id, colour, size]);
    wanted[key] = (wanted[key] || 0) + qty;
    if (stock < wanted[key]) throw new Error(`Sorry, only ${stock} of ${itemName(p, colour, size)} left`);
    return { id, colour, size, qty, name: itemName(p, colour, size), amount: Math.round(p.price * 100) };
  });
  if (order.delivery === 'delivery') {
    if (!String(order.address || '').trim()) throw new Error('Delivery address is required');
    items.push({ name: 'NZ courier delivery', amount: Math.round(shipping * 100), qty: 1, shipping: true });
  }
  return items;
}

// SQLite JSON paths into products.colours (size names can't contain quotes; see validate.js)
export const stockPath = (i, size) => `$[${i}].stock."${String(size).replace(/["\\]/g, '')}"`;
export const namePath = (i) => `$[${i}].name`;
