# Update 022 — Half Legal invoices with larger text

The shared invoice format changes from A5 landscape to half of a US Legal sheet: **8.5 × 7 inches (215.9 × 177.8 mm)**, landscape. Party invoices, walk-in invoices, purchase invoices/POs, sales returns and supplier returns use this size in both browser printing and downloaded PDFs. The party print buttons now say Half Legal.

Item and quantity text increases from 10 to 13 CSS pixels; general text and totals increase from 11 to 14. The business name, logo, contact information, headings, unit labels and footer also increase. Unit labels stay smaller than quantities on the same line. Black text, numeric rate/amount cells, repeated headers/dates/document numbers/page numbering and the current balance reconciliation are retained. Larger text can require more pages for long documents; complete rows and final totals continue to paginate within the new physical page size.

Pagination and PDF export share the new width/height constants. Measurement uses the new printable height rather than the former A5 height. Each PDF page is a complete half-Legal sheet, with no cropping of one tall image. Other report/ledger formats and delivery challans retain their existing sizes. No financial records, calculations, schema or dependencies change.

## Validation

- Existing seven invoice document tests pass, preserving discounts, prices, balances, return references and totals order.
- Chromium/PDF checks pass: a three-line invoice like the supplied example fits one page; a 12-line invoice with long descriptions uses two pages; a 65-line walk-in invoice uses six; a 40-line PO uses three; a 35-line sales return uses three; a short supplier return uses one; extensive description/notes use fourteen.
- Checked 612 × 504 PDF points (8.5 × 7 inches) for browser PDFs and actual downloadable PDFs, repeated context/page numbering, complete text, intact totals, black text and smaller single-line unit labels. A representative page was visually reviewed.
- Production build, separate TypeScript and focused ESLint checks pass.
- These are local fixture checks. Physical printer output and authenticated production pages remain deployment checks; no production transactions were created.

## SSD-only deployment and printing

After merge, deploy main in `/home/deploy/ssd` with SSD Node 22. Preserve local changes, `.env`, database and the current rollback build. Stop only `ssd-app` before replacing its active build, then start it with its existing configuration after a successful build; restore the previous build if deployment fails. No migration or dependency change is required. Leave port 3000, Nginx, shared PM2 and other apps unchanged.

Verify public/direct JavaScript assets and use existing documents for browser print/PDF checks. In the printer driver select **custom paper 8.5 × 7 inches (215.9 × 177.8 mm)**, use **100% / actual size**, and disable browser-generated headers and footers. Full Legal (8.5 × 14 inches) is a different physical sheet; selecting it alone does not change this document to half Legal. Hardware paper-size support must be checked on the actual printer.
