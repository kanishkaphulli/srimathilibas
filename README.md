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

Open `/admin` and sign in with a name and password from the `ADMIN_USERS` secret.

- **Orders:** every order is saved here.
  - Card orders become **Paid** on their own.
  - For bank transfers, click **Mark paid** when the money arrives.
  - Marking an order paid takes its items off stock. Cancelling a paid order puts them back. Refund card payments in Stripe yourself.
- **Products & Stock:** click a product to open it.
  - Each product has a list of sizes and one or more **colours**.
  - Each colour has a swatch, up to 8 photos (the first one is the main photo; use ★ to change it) and a stock table with one row per colour and one column per size.
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
- **Delivery fee:** it's `SHIPPING` in both `index.html` and `order.js`. Keep the two values the same.

## Database setup (already done)

`schema.sql` creates the tables. `node scripts/seed.mjs > seed.sql` turns `products.json` and `promos.json` into starting data. Load both with:
```bash
npx wrangler d1 execute srimathilibas --remote --file schema.sql
npx wrangler d1 execute srimathilibas --remote --file seed.sql
```
The seed never overwrites rows that already exist. After it's loaded, the admin page is where products and promos live, and the two `.json` files are only a starting copy.

## Checks

Run `node worker.test.mjs` to check pricing, stock and validation.
To run the whole site on your computer with a local copy of the database and photo storage, run `npx wrangler dev`. Set up the local database first with the commands above, using `--local` instead of `--remote`.
