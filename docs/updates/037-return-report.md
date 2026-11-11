# Update 037 — Return Report

Reports now includes Return Report, using the existing report cards, date-range
presets, filters, shared DT table styles, banner, footer and Print / PDF layout.
Search by invoice number, customer or product; the report includes every line of
each matching customer return. Supplier returns remain in their existing history.

Columns show return date, original invoice number, customer, product/description,
reason, original invoice quantity, invoice quantity remaining before the return,
returned quantity, invoice quantity remaining afterward, stock before/after,
credit and active/reversed status. Sold quantities use the invoice unit; stock
snapshots use their saved base unit. Credits exclude reversed returns. Quantities
of unrelated products/units are not added into a misleading grand total.

New customer returns save invoice remaining and stock quantity snapshots under
the existing product locks, in the same transaction as batches, return lines and
credits. Multiple lines for the same product carry the running balance forward;
partial returns and retries preserve exact totals. Snapshots describe save time,
including for backdated returns, and are not rewritten by later sales, packaging
conversions or return reversals.

Older returns reconstruct invoice remaining quantities from all earlier returns
on that invoice, including returns outside the selected range and reversals as
of creation time. Old stock snapshots stay NULL and display as —; present stock
cannot establish reliable historical stock totals. Reversed rows retain the
original return's before/after quantities and show their reversal date.

## Database upgrade

Apply the repeatable additive migration before starting this version:

```sh
npm run db:upgrade:return-report
npm run db:generate
npm run build
```

The v42 migration adds five nullable columns to invoice_return_items. It does not
rewrite existing stock, invoice values or return records. The combined inventory
upgrade includes v42. Missing columns return an explicit report upgrade message.

For SSD deployment, work only in /home/deploy/ssd. Preserve .env, back up only
SSD's database, apply v42 with SSD's existing connection, generate/build and
restart only SSD's existing application process. Leave other apps, shared
PostgreSQL/Nginx services, WhatsApp sessions/keys and the working port-3000 proxy
mapping untouched.

## Validation

Unit/API harness checks cover authorization, invalid dates, inclusive date range,
search, historical quantities/reversals, immutable snapshots, packaged returns,
multiple lines and missing-schema errors. An isolated PostgreSQL integration
test verifies real sale/return/report transactions, request retries, later sales,
reversals, preserved snapshots and repeatable migration. Integration tests require
a local PostgreSQL DATABASE_URL and create/drop only a uniquely named test schema.

The report was also generated in a local browser against an isolated preview
database, with fractional kit returns and stock quantities in vials.
