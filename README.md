# Srimathi Libas

Website for Srimathi Libas, a shop selling Indian traditional attire for women in Auckland, New Zealand.

- `index.html` is the shop: promos, collections, bag, checkout. Orders are sent to the shop on WhatsApp or by email.
- `admin.html` is the admin page for products, stock and promos.
- `products.json` and `promos.json` hold the data. The admin page edits them.

## Hosting (GitHub Pages)

Go to **Settings → Pages**, set Source to **Deploy from a branch**, then pick `main` and `/ (root)`.
The site goes live at `https://kanishkaphulli.github.io/srimathilibas/`.

## Using the admin page

1. Create a **fine-grained token** at GitHub → Settings → Developer settings → Fine-grained tokens.
   Set Repository access to **Only `srimathilibas`** and Permissions to **Contents: Read and write**.
2. Open `https://kanishkaphulli.github.io/srimathilibas/admin.html`, paste the token, then click **Connect**.
3. Edit stock, prices, products or promos, then click **Save & publish**. The site updates within about a minute.

Without a token, anyone can open the admin page but nobody can save changes. Keep the token private.
The page saves it only in the browser of the device you use.
