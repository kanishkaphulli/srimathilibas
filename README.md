# Srimathi Libas

Website for Srimathi Libas, a shop selling Indian traditional attire for women in Auckland, New Zealand.
The site runs on Cloudflare Workers at **https://srimathilibas.kanishkaphulli.workers.dev**.

- `index.html` is the shop: promos, collections with sizes, bag, and checkout by card or bank transfer.
- `admin.html` is the admin page at `/admin`, for orders, products and stock, promos and photo uploads.
- `worker.js` is the server code: admin login, database, photos, saving orders and Stripe. `order.js` handles pricing and `validate.js` checks admin edits.
- Data lives in Cloudflare:
  - **D1 database** `srimathilibas`: products, promos and orders (see `schema.sql`)
  - **R2 bucket** `srimathilibas-photos`: uploaded photos

To deploy, run `npx wrangler deploy`.

## Admin page

Open `/admin` and sign in on the sign-in page with a name and password from the `ADMIN_USERS` secret. A session lasts 12 hours; use **Log out** (top right) to end it sooner. Changing `ADMIN_USERS` signs everyone out.

- **Orders:** every order is saved here.
  - Card orders become **Paid** on their own.
  - For bank transfers, click **Mark paid** when the money arrives.
  - Marking an order paid takes its items off stock. Cancelling a paid order puts them back. Refund card payments in Stripe yourself.
- **Products & Stock:** click a product to open it.
  - Each product has a list of sizes and one or more **colours**.
  - Each colour has up to 8 photos (the first one is the main photo; use ★ to change it) and a stock table with one row per colour and one column per size.
  - **+ Add colour** and **Change** open a palette of named colours (Red, Maroon, Rani Pink, Mustard, Royal Blue and so on) to tap. **Can't find it?** lets you type your own name, and the swatch fills in automatically when the name is a known colour.
  - Change stock with the **−** and **+** buttons, or type a number.
  - Photos can be JPG, PNG, WebP or AVIF, up to 5 MB each.
  - Click **Save & publish** to apply your changes.
- **Stock sheet (Excel):**
  - **Download stock sheet** gives an .xlsx with one row per product colour: `Product ID | Product | Colour | XS | S | M | …`.
  - Edit it in Excel or Google Sheets, then **Upload stock sheet** (.xlsx or .csv).
  - Blank cells are left unchanged. A new size column adds that size to the product, and a new colour name adds that colour, which then needs photos before it can be saved.
  - Rows that can't be used are listed in a report. Nothing is published until you click **Save & publish**.
- If stock changed while you were editing, for example because an order was paid, the save is refused so it can't undo that change. Reload the page and edit again.

To set or change the admin users, type the full list each time. It replaces the old one.
```bash
npx wrangler secret put ADMIN_USERS --name srimathilibas
```
Enter the list as one line: `kanishka:a-long-password,priya:another-password`

## Card payments (Stripe)

Stripe charges 2.65% + NZ$0.30 per NZ card payment, with no monthly fee. Card payment stays hidden on the shop until the key is set.

1. Store your secret key (Stripe dashboard → Developers → API keys). Start with a `sk_test_…` key.
   ```bash
   npx wrangler secret put STRIPE_SECRET_KEY --name srimathilibas
   ```
2. Set up a webhook so orders are marked paid even if the customer closes the tab before coming back to the site.
   - In Stripe, go to Developers → Webhooks → Add endpoint.
   - Use the URL `https://srimathilibas.kanishkaphulli.workers.dev/api/stripe-webhook`.
   - Choose the events `checkout.session.completed` and `checkout.session.async_payment_succeeded`.
   - Copy the signing secret (`whsec_…`) and store it:
   ```bash
   npx wrangler secret put STRIPE_WEBHOOK_SECRET --name srimathilibas
   ```

## Other settings

- **Bank transfer:** put your account number in `BANK` near the top of the script in `index.html`. Until you do, customers are told you'll send bank details on WhatsApp.
- **Delivery fee:** it's `SHIPPING` in `order.js`. The shop reads it from the server, so there's only one place to change it.
- **Rate limits:** each internet connection can try to sign in 10 times a minute and place 30 orders a minute (`ratelimits` in `wrangler.jsonc`).

## Database setup (already done)

`schema.sql` creates the tables. `node scripts/seed.mjs > seed.sql` turns `products.json` and `promos.json` into starting data. Load both with:
```bash
npx wrangler d1 execute srimathilibas --remote --file schema.sql
npx wrangler d1 execute srimathilibas --remote --file seed.sql
```
The seed never overwrites rows that already exist. After it's loaded, the admin page is where products and promos live, and the two `.json` files are only a starting copy.

## Tests

```bash
npm test            # everything: unit + API (about 30 seconds the first time Wrangler starts)
npm run test:unit   # pricing, validation, stock sheet, sessions (instant)
npm run test:api    # the real Worker on a throwaway database
npm run deploy      # runs all tests first, deploys only if they pass
```

- `tests/unit.test.mjs` checks `order.js`, `validate.js`, `stock-sheet.js` and `session.js`.
- `tests/api.test.mjs` starts `wrangler dev` against a **fresh database and photo store in a temporary folder**, seeded from `schema.sql`, `products.json` and `promos.json`, with test-only admin logins and no Stripe key. It never touches the live site or your local dev data, and the temporary folder is deleted afterwards.
- The API tests cover:
  - **The public shop:** catalogue and settings, plus confirming that private files are never served.
  - **Admin sign-in:** redirects when signed out, wrong passwords, cookie flags, every listed admin, tampered sessions and logout.
  - **Orders and stock:** bank orders, the delivery charge, rejected orders, stock changing exactly once on paid and on cancel, and sign-in required to change orders.
  - **Admin catalogue:** saving edits, refusing stale saves, the planner switch and photo uploads.
- Card payments are tested against a small **fake Stripe** inside the tests (`STRIPE_API` points the Worker at it; leave `STRIPE_API` unset in production).
- **Not covered:** page layout and clicking through the shop in a real browser (that needs Chrome, which isn't installed here), and real Stripe payments.
