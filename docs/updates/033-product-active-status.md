# Update 033 — Active and inactive products

Edit Product has Active and Inactive buttons. New products default to active. The Products page defaults to active items, with Inactive and All views for finding and reactivating hidden products.

Catalog API reads exclude inactive products by default, covering invoice, purchase, quotation and report selectors. Product management explicitly requests both statuses. The stock report excludes inactive products. Invoice and purchase saves reject inactive products even when selected in a stale form. Existing financial history and returns remain available; reactivate a product before editing a document containing it.

Deployment: run `npm run db:upgrade:product-status` against SSD's database before deploying the regenerated Prisma client/application. The idempotent migration adds `products.is_active` with a true default; it preserves existing products and stock. No other database or service should be changed.

Validation: 57 tests passed covering status persistence, catalog hiding, reactivation, stale sales/purchase rejection, product validation, stock edits, purchases, invoice stock transactions and returns. Prisma client regenerated. Database migration has not been applied to a live database.
