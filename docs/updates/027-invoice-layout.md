# Update 027 — Balanced invoice composition

Invoice printing and PDF export keep the 8.5 × 6.5 inch sheet and 6 mm safety inset from Update 026, with a revised shared layout for sales, walk-in, purchase and return documents.

- Sales descriptions grow from 24% to 30% of the table width; return descriptions grow from 26% to 38%. Purchase product names receive more space while expiry stays visible.
- Item text grows from 13 px to 15 px with a heavier weight, clearer headings, and more cell padding. Quantity units stay smaller beside the quantity and can wrap when needed.
- Totals follow the item table instead of being pushed to the bottom of the sheet. Labels and amounts use separate aligned columns with enough line spacing to keep rules away from text. The final balance has a distinct outline and larger bold text.
- The letterhead and document/customer details have clearer spacing. The footer remains at the bottom with page numbering.

The existing measured pagination uses the revised row, header and summary heights. Financial values, discount order and balance calculations are unchanged. No database migration is required.

## Application coverage

| Entry point | Shared print and PDF layout |
| --- | --- |
| Invoices | Redirects to Quick Invoice; uses the walk-in template below |
| Quick Invoice / walk-in drafts and saved invoices | `SalesInvoiceDocument` with `walkIn`, using the shared pagination and PDF exporter |
| Parties / Accounts invoices | `SalesInvoiceDocument`, using the shared pagination and PDF exporter, preserving the refreshed party balance |
| Supplier purchase invoices / POs | `PurchaseOrderPdfDocument`, which renders `InvoiceDocument`, using the shared pagination and PDF exporter |
| Sales and supplier returns | `InvoiceDocument`, using shared print pagination |

All these documents inherit the same typography, spacing, totals alignment and physical paper size from `app/invoice-print.css`. Party and supplier account statements remain separate A4 reports.

## Validation

The production build, TypeScript check and all 7 existing invoice-document tests passed. Chromium fixtures exercised the shared React template, compiled global styles and actual pagination/PDF helper for a two-item invoice matching the reported composition, a 70-line invoice, a purchase, a return and long notes. Checks covered sheet overflow, complete product text, totals, repeated page numbering and 6 mm edge clearance. The sample's total remains 16,500; its totals follow the table without overlapping labels, amounts or row boundaries. Browser PDFs and single/multipage downloaded PDFs retain 612 × 468 point pages (8.5 × 6.5 inches).

Physical output still needs an operator check on the HP LaserJet P2015/M1132, with matching custom paper, Actual size / 100% and browser headers/footers disabled. Deploy only SSD in /home/deploy/ssd using its existing process manager, preserving .env and other apps/services.
