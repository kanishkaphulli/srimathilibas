// Order pricing, shared by worker.js and worker.test.mjs
export const SHIPPING = 12; // keep in sync with SHIPPING in index.html

// Validates the order against the catalogue and returns Stripe line items (amounts in cents).
// Never trusts prices from the browser.
export function lineItems(catalogue, order, shipping = SHIPPING) {
  if (!/^SL-\d{6}-[A-Z0-9]{4}$/.test(order?.no || '')) throw new Error('Invalid order number');
  if (!Array.isArray(order.items) || !order.items.length || order.items.length > 20) throw new Error('Your bag is empty');
  const items = order.items.map(({ id, size, qty }) => {
    const p = catalogue.find((x) => x.id === id);
    if (!p) throw new Error('An item in your bag is no longer available');
    const stock = p.sizes?.[size];
    if (!Number.isInteger(qty) || qty < 1) throw new Error('Invalid quantity');
    if (!(stock >= qty)) throw new Error(`Sorry, only ${stock || 0} of ${p.name} (${size}) left`);
    return { name: `${p.name} (${size})`, amount: Math.round(p.price * 100), qty };
  });
  if (order.delivery === 'delivery') {
    if (!String(order.address || '').trim()) throw new Error('Delivery address is required');
    items.push({ name: 'NZ courier delivery', amount: Math.round(shipping * 100), qty: 1 });
  }
  return items;
}
