# Update 019 — A5 landscape invoices and returns

Party invoices, walk-in invoices, purchase invoices/POs, sales returns and supplier returns now use the same black-on-white A5 landscape layout (210 × 148 mm). Quantity and its smaller unit label share one line. Rate and amount cells contain numbers without an `Rs` prefix; totals identify PKR.

Each printed or downloaded page repeats the business logo/contact header, document number, customer/supplier, date, column headings and footer with `Page X of Y`. Returns also repeat their original invoice/PO reference. Rows are measured at the actual print width before pagination. Normal rows stay together, totals remain together on the last page, and unusually long descriptions or notes continue without dropping text. PDF export captures individual complete sheets rather than cropping a tall image across pages.

Existing saved amounts, historical unit rates, discounts, taxes, balances and return credit wording are retained. This update changes presentation only: no stock/accounting operations, schema, dependencies, WhatsApp code or settings change. Reports, ledgers and delivery challans retain their existing formats.

## Validation

- Production build, separate TypeScript check, focused ESLint and five document-rendering tests pass.
- Chromium printing checks pass with the actual templates, print wrappers, CSS and pagination helper: party invoice (12 lines, 1 page), walk-in invoice (65 lines, 5 pages), PO (40 lines, 3 pages), sales return (35 lines, 3 pages), supplier return (1 page), and long descriptions/notes (9 pages).
- Checks cover A5 landscape dimensions, complete text, repeated header/date/footer/page numbering, row/totals boundaries, single-line units and black text. Actual downloadable walk-in, PO and return PDFs also have the expected page size/count. Representative first and continuation pages were visually reviewed.
- Existing `node --test tests/*.test.mjs`: 142 pass, 1 fails. The unchanged `tests/product-units.test.mjs` expects a packet option to be absent when pieces-per-packet is 1; the unchanged current helper includes it. This pre-existing packaging expectation is outside this print update.
- No production transactions or WhatsApp messages were created. Live VPS printing/authenticated verification remains a deployment check.

## SSD-only deployment

After merging, deploy in `/home/deploy/ssd` with its existing Node 22 configuration. Preserve local changes, `.env`, database and WhatsApp encryption key/session. Stop only `ssd-app` before replacing its active build; pull the merged main, build successfully, then start only `ssd-app` using its existing configuration. Retain a rollback build until verification succeeds. No migration, worker restart, port/Nginx change or shared PM2 restart is needed for this print-only update.

Verify fresh JavaScript assets publicly and on port 3000, then use existing saved documents to check party, walk-in, PO and both return print previews and PDF downloads. Select A5 landscape, 100% scale and disable browser-generated headers/footers. Check a multi-page document for repeated context and an intact final totals block; do not recreate invoices or send notifications for this verification.
