# Update 035 — Repair Products status filtering

The Products page requests `.in("is_active", [true, false])` so its local
Active/Inactive/All picker can display both statuses. The generic database route
translated this to Prisma `{ is_active: { in: [true, false] } }`. Prisma's Boolean
filter supports equals/not, not `in`; the list failed before loading any rows.

The route now translates product Boolean inclusion into Boolean conditions,
preserving other filters, relations, sort order and the existing active-only
default for ordinary invoice/PO product lookups. Empty lists explicitly match
nothing, duplicates are harmless, and malformed non-Boolean values receive a
400 validation response. String/numeric inclusion filters are unchanged.

This fixes a query error, not stock calculations. It changes no product records,
quantities, prices or database schema and does not alter Update 034 reversal
rules. The original active-status feature predates Update 034.

## Validation

`npm run test:product-status` exercises the real API and PostgreSQL/Prisma in an
isolated schema. It covers both statuses and category relation, the active-only
default, single status and equality filters, search/other predicates, empty and
duplicate values, malformed values, ordinary string inclusion and exact counts.
Existing unit tests and TypeScript/build checks are also run for this update.

## SSD-only deployment

After merge, preserve local changes and `.env` and retain the previous SSD build.
Review stashed edits to `app/api/db/route.ts` before applying any; they may replace
this fix or the return safeguards. Pull main with `--ff-only` in
`/home/deploy/ssd`, install with `npm ci`, stop only the existing root-owned PM2
id 10 `ssd-app` before replacing its active build, run `npm run build`, and
restart only that app after success with its preserved environment. No migration
is required for this update on the already-upgraded production database.

Verify Products loads without the Prisma error, Active/Inactive/All status and
search work, and invoice/PO pickers still default to active products. Verify
public CSS/pages and actual port-3000 listener. Leave `ssd-backend` on 3012,
other apps, shared PostgreSQL/Nginx, database contents and WhatsApp sessions
untouched. No artificial production transactions are needed.
