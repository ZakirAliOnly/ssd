# Update 009 — Distribution packaging and loose-unit sales

Suggested PR title: `Update 009: Buy and sell products by piece, packet or box`

Products can opt into a smallest stock unit (for example Piece), pieces per packet, packets per box and optional packet/box selling prices. A size of 1 leaves that level unused. A box can also be defined directly as pieces by setting pieces per packet to 1. Stock, FIFO allocations and cost calculations use base units. Product listings show packaging, prices and equivalent quantities; equivalents do not claim that packages are physically sealed.

Both party and walk-in invoice lines have a unit selector that fills the unit price. Purchase invoices receive the selected unit and convert quantities to base units. Each saved line keeps its unit and factor, so later packaging edits do not reinterpret old transactions. Duplicate product lines are combined for stock checking, and insufficient stock rolls back the whole save. Invoice/PDF, purchase/PDF, ledger, delivery challan and WhatsApp output include the chosen unit. Notifications still use the existing queue and sending settings.

## Existing products

The migration does not reinterpret any existing quantity: unconfigured products keep their original Unit behavior. In Edit Product, enable packaging and choose whether the existing quantity represents base units, packets or boxes. Review the conversion and confirm once. The preview recalculates stock and base cost; it suggests a base selling price divided by the chosen size, which can be adjusted before saving. Packet/box prices can be entered separately; an empty/zero pack price uses base selling price × size.

The one-time transaction rescales physical batch, allocation, return and deduction history, while preserving invoice and purchase quantities, prices and amounts. Costs are divided by the same factor with eight decimal places of precision. Existing expiry dates remain. An audit entry records the original quantity, factor and converted quantity. Stale quantities, mismatched batch totals and repeated conversions are rejected. Changing packaging later affects new lines only; existing lines keep their saved size unless the user explicitly chooses a different unit. Stock adjustments are separate from conversion.

Sales returns restore base quantities using the original invoice factor. Supplier returns remove the original purchase factor and cannot exceed unsold batch stock. Reports normalize summary quantities to each product's base unit, retain original units in sales details and use batch cost snapshots. Inventory mutations and conversion share a transaction lock so a conversion cannot race a sale, purchase or return.

## Deployment on the shared VPS

1. In `/home/deploy/ssd`, preserve local changes and `.env` and create/validate an SSD-only database backup. Keep the WhatsApp encryption key and linked session unchanged.
2. Pull the merged update. Schedule a short SSD maintenance window: gracefully stop only `ssd-app` and `ssd-whatsapp-worker` before changing schema/client/build; allow the worker at least 45 seconds to finish. Preserve existing supervisor definitions and Node 22 startup commands. Do not restart the shared PM2 daemon.
3. With SSD Node 22, run `npm run db:upgrade:packaging`, `npm run db:generate`, then `npm run build`. The v39 SQL is additive, transactional and repeatable; no package/dependency changes are required. Do not run schema push or rerun earlier WhatsApp migrations.
4. Start only SSD's app and worker using their saved configuration. Confirm a fresh worker PID/start time, stable worker heartbeat and restored linked session. Keep SSD's Nginx upstream on port 3000; leave shared PostgreSQL/Nginx and other apps untouched.
5. Verify public routes and their assets, authenticated product listing, party/walk-in unit pickers, purchase picker and reports. Existing products must remain unconverted until their unit basis is confirmed by the operator. Avoid creating financial records or sending real notifications just for deployment verification. Use an agreed test product/recipient if business-level testing is requested.

Do not deploy an older inventory application after products have been converted: that code cannot interpret the new stock basis. Restore a consistent application/database pair from the pre-upgrade backup only through a coordinated recovery that accounts for any later transactions.

## Validation

`npm run test:packaging` exercises real APIs against a temporary local PostgreSQL schema, including mixed units, saved conversion snapshots, sales/supplier returns, legacy history, duplicate conversion/stale checks, competing sales, deletion and repeatable migration. `node --test tests/*.test.mjs` runs regression and unit checks. `npm run test:whatsapp` checks notification behavior without real delivery. TypeScript, focused lint and a production build are also required.

Completed locally: 19 PostgreSQL integration checks, 139 regression/unit checks, 38 WhatsApp checks, TypeScript, focused lint and production build all passed.

The production-build browser check converts 2 legacy boxes to 200 pieces, sells 1 packet plus 3 pieces (187 remaining), then receives a box (287 remaining) and saves a party packet invoice (277 remaining). It verifies price autofill, product listing and mobile layout. All fixtures use a temporary schema. No production data or real WhatsApp messages are involved.
