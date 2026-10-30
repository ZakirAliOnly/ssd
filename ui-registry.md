# UI Registry

### Delivery challan serial numbers

Files: app/(dashboard)/delivery-challan/page.tsx, app/api/delivery-challans/route.ts
Last updated: 2026-10-15

Show a read-only Challan No in the editor using text-sm font-bold, and its DC001-style number in the existing blue print title bar using white 11px bold text. Allocate one persisted serial per invoice, preserve it on reprints and include it in PDF filenames. Keep the invoice reference separate. Disable output until assignment succeeds. Apply scripts/migration-v35-delivery-challans.sql on other databases before deploying.

### Shared print credit

Files: components/PrintFooter.tsx, public/brand/footer.svg
Last updated: 2026-10-15

Every print/PDF credit reads exactly "Software developed by AddsMint.com". Reuse PrintFooter for full-page documents and thermal sales/return receipts. Default is centered black 11px semibold with 12px top margin; thermal receipts use 10px and 8px top margin. Keep the footer together across page breaks and the SVG asset text identical.

### Party ledger product details

File: app/(dashboard)/accounts/page.tsx
Last updated: 2026-10-15

In screen and printed/PDF ledgers, show the saved product name (invoice item category) in semibold with the description wrapping beneath it. Fall back to description or Item for missing names; omit duplicate descriptions. Preserve existing 11px screen and 10px print product-row typography and numeric columns.

### Party list pagination

File: app/(dashboard)/accounts/page.tsx
Last updated: 2026-10-15

Use a wrapping footer inside the existing white account-list card, with a gray-100 top border, px-5 py-4 spacing and gray-800 text-sm labels. Controls use white backgrounds, gray-200 borders, rounded-[8px], px-3 py-2, gray-50 hover and a blue focus-visible outline. Disabled navigation uses opacity-50 and cursor-not-allowed. Show the record range and total, page count, Previous/Next and labelled 10/25/50/100 rows-per-page selector (default 25). Filter before slicing, reset on search/head/page-size changes, clamp the page after deletion and preserve continuous row numbering.

### Returns module

File: app/(dashboard)/returns/page.tsx
Last updated: 2026-10-14

| Property | Class / token |
| --- | --- |
| Background | bg-white panels; var(--gray-50) form fields |
| Border | var(--gray-100) panels and table cells; var(--gray-200) inputs |
| Radius | rounded-[14px] panels; rounded-[8px] inputs and buttons |
| Text | text-2xl font-extrabold page title; text-lg font-bold invoice heading; text-sm body |
| Secondary text | var(--gray-800) |
| Spacing | p-4 / sm:p-5 panels; existing DT table cell padding |
| Focus | focus-visible:outline-2 focus-visible:outline-[var(--blue)] |
| Accent | var(--blue-deeper) table headers and confirm action; var(--blue-pale) selected invoice |

Use separate neutral and primary button color classes. Neutral buttons use white backgrounds and var(--gray-900) text; primary return action buttons use var(--red) backgrounds and white text. Disabled return action buttons use var(--gray-200) backgrounds and var(--gray-800) text at full opacity, including on hover. Share only spacing, borders and interaction classes so conflicting background utilities cannot hide the label.

**Pattern notes:** Sales Invoice Return and Supplier Invoice Return use matching tab buttons with a blue active state. Paginate invoice search; the Return button opens a native dialog with a labeled title, keyboard focus containment, a sticky header and Close action. Dialog width is viewport minus 24px (maximum 5xl), maximum height 90dvh, with vertical scrolling and a translucent backdrop. Block closing while saving or while the save result is uncertain. Use visible labels for search, date, reason and quantities. Tables scroll horizontally on small screens, amounts align right and quantities align center. Review and confirm inline in the modal; show original, returned and remaining quantities and immutable return history. A whole-invoice return selects all remaining quantities. Sales returns restore stock; supplier returns remove unsold stock from the original purchase batch. Cash refunds are separate.

### Head Account Statement

File: app/(dashboard)/reports/page.tsx and components/SupplierStatementReport.tsx
Last updated: 2026-10-13

| Property | Class / token |
| --- | --- |
| Background | bg-white; var(--gray-50) inputs and totals |
| Border | border border-[var(--gray-100)]; var(--gray-200) selector |
| Border radius | rounded-xl statement; rounded-[8px] selector |
| Text | text-lg font-extrabold report title; text-xs date; 13px table |
| Spacing | p-4 statement; 12px table cells; 6px 5px print cells |
| Focus | focus-visible:outline-2 focus-visible:outline-[var(--blue)] |
| Accent | var(--blue-deeper) table header and filter label |

**Pattern notes:** Select a head account by ID and include all parties assigned through head_id, including parties with no activity. Reuse the party statement table for screen and print: opening balance, debit, credit, closing balance, and totals. Summary names are plain text. Right-align currency columns with tabular numerals; retain horizontal scrolling on narrow screens.

### Numeric input behavior

Last updated: 2026-10-13

Hide native spinner buttons globally with textfield appearance and WebKit spin-button overrides. Dashboard number inputs blur on mouse-wheel scrolling so their values remain unchanged while the page continues scrolling. Preserve normal typing and keyboard input.

Product add and edit forms use an editable ProductStockField. Edit submissions send changed quantities with the original stock snapshot so concurrent sales cannot be overwritten; unchanged quantities are omitted. Keep the existing field styling and two-decimal quantity input.

Purchase invoice quantity fields may be cleared while typing; do not replace an empty field with 1 or clamp draft quantities to 1 during recalculation. Keep a default of 1 for new lines and allow positive quantities with two decimal places; the save validation rejects unfinished or zero quantities.

### Product search

File: app/(dashboard)/products/page.tsx
Last updated: 2026-10-12

| Property | Class / token |
| --- | --- |
| Background | var(--gray-50) |
| Border | border-[1.5px] border-[var(--gray-200)] |
| Border radius | rounded-[9px] |
| Text — primary | text-[13px], var(--gray-900) |
| Text — secondary | var(--gray-800) |
| Spacing | pl-9 pr-10 py-2; toolbar px-5 py-3 |
| Hover state | hover:bg-[var(--blue-pale)] on clear button |
| Focus state | focus-visible:ring-2 focus-visible:ring-[var(--blue)] |
| Shadow | none |
| Accent usage | var(--blue-deeper) for empty-state action |

**Pattern notes:** Match the existing catalogue inputs. Use a leading Lucide Search icon, accessible input and clear-button names, full width on mobile, and a compact toolbar field on larger screens.

### Stock reports

File: components/StockReport.tsx and app/(dashboard)/reports/page.tsx
Last updated: 2026-10-13

| Property | Class / token |
| --- | --- |
| Background | bg-white; var(--gray-50) for totals and filter inputs |
| Border | border border-[var(--gray-100)]; filter border-[1.5px] var(--gray-200) |
| Border radius | rounded-[14px] report panel; rounded-[8px] product selector |
| Text — primary | existing DT table tokens; text-lg font-extrabold heading |
| Text — secondary | text-xs var(--gray-800) |
| Spacing | p-4 panel; DT.tdDense table cells |
| Focus state | focus-visible:outline-2 focus-visible:outline-[var(--blue)] |
| Shadow | var(--shadow-sm) |
| Accent usage | existing ReportTypeCard blue active state; var(--red) for incomplete history |

**Pattern notes:** Reuse ReportTypeCard and the report date controls. Filter by product ID with SearchableSelect; display names only, newest first, at most 10 suggestions, with case-insensitive matching across the full product list. Share StockReport between screen and print. Include per-product original sales invoices in the date range with invoice number, date, customer, quantity, historical unit price and line amount; explain that returns and invoice-wide discounts affect the summary. Include a separate Description column after Product; preserve line breaks, wrap long descriptions, and show a dash when absent. Left-align descriptive columns, center quantity headers/values/totals, and right-align currency headers/values/totals with matching cell padding and monospace values. Explain unavailable historical balances in visible copy.

### Shared document print header

Files: components/PrintHeader.tsx, public/brand/letterhead.svg
Last updated: 2026-10-13

| Property | Style |
| --- | --- |
| Background | #fff |
| Border | 2px solid #0284c7 under letterhead |
| Text — primary | Georgia bold business name, #111 |
| Text — secondary | Arial semibold contact details, #0369a1 |
| Spacing | gap 20px; header padding 0 0 10px; document top padding 6mm |
| Shadow | none |

**Pattern notes:** All document types use the supplied reference letterhead: large blue triangular logo on the left, centered bold black serif business name and blue contact lines on the right, with a full-width blue rule underneath. Omit email and sales-manager lines across all documents. Use the corrected middle mobile number 03342427408. Thermal receipts use the same shared SVG header with larger proportional contact text. Challans omit delivery number and receiver/delivery/signature fields in both editor and output.

### Invoice print header

File: components/PrintHeader.tsx (invoice variant)
Last updated: 2026-10-14

Reuse the default letterhead typography, logo, spacing, address, and phone details. Omit the business email and the Ejaz Gill / Sales Manager line in invoice print and PDF templates for Accounts and Quick Invoice. Other document headers retain their existing variants.

### Invoice product rows and discounts

File: app/(dashboard)/accounts/page.tsx, app/(dashboard)/quick-invoice/page.tsx, components/InvoiceLineDiscount.tsx
Last updated: 2026-10-13

Product selectors display the product name only. Keep code searchable without showing it as a prefix; omit serial/category metadata and FIFO expiry notes beneath the editor's selector.

| Property | Class / token |
| --- | --- |
| Background | existing white inputs and var(--blue-pale) row hover |
| Border | existing var(--gray-200) inputs and var(--gray-100) table cells |
| Text — primary | existing bold numeric input classes; DT table heading tokens |
| Spacing | existing px-2 py-2 or py-3 cell spacing |
| Focus | existing blue input focus borders |
| Print discount | 11px semibold #111, margin-top 3px |

**Pattern notes:** Product and Description occupy separate columns. Top-align every row cell. Center quantity/discount headings, right-align totals. Qty and Rate allow two decimal places (step 0.01); quantities must be positive. Currency values retain up to two decimal places without rounding to whole rupees. Discount percentage accepts 0–100 with two decimal places. Print percentage and deducted amount beneath the product; show invoice-wide discounts separately.

### Delivery challan products

File: app/(dashboard)/delivery-challan/page.tsx
Last updated: 2026-10-15

Use white panels with rounded-[14px], var(--gray-100) borders, p-5 spacing, and var(--shadow-sm). The screen table uses 13px text, p-2 cells, blue-deeper headings, left-aligned wrapping product details and centered tabular quantities. Show products and quantities when an invoice opens. Print/PDF columns are S.#, Product and Qty with black 1px borders. Omit rates, amounts, monetary totals and invoice prices from the challan interface and output.

### A5 delivery challan and party invoice

Files: app/(dashboard)/delivery-challan/page.tsx, app/(dashboard)/accounts/page.tsx, app/globals.css
Last updated: 2026-10-15

Print and downloaded PDFs use A5 portrait (148 x 210mm) with 6mm content insets. Use named print pages to scope sizing to these documents. Party invoice columns use 6% / 42% / 10% / 20% / 22%, 11px body text, 9px column headings and 5px 3px cells. Preserve the blue letterhead and totals styling.

### Walk-in thermal receipt

File: app/(dashboard)/quick-invoice/page.tsx
Last updated: 2026-10-15

Draft and saved walk-in invoices share an 80mm thermal print/PDF template with 3mm padding, black text on white, Arial 11px body, an 18px bold business heading and dashed separators. Products occupy full-width rows; quantities and rates appear beneath each product with amounts aligned right. Totals span the receipt width. Receipt height follows the content, without A4 filler space or image banners.

### Return thermal receipt

File: app/(dashboard)/returns/page.tsx
Last updated: 2026-10-15

Match the walk-in receipt: 80mm paper, 3mm padding, Arial 11px black on white, 18px bold business heading and dashed separators. Print saved return ID, source invoice, party/supplier, return date, reason, returned products, quantities, credited amounts, total credit and operator. Label sales versus supplier returns and state that no cash refund was recorded. Automatically print only after the saved record is fetched; allow reprints from immutable return history. Keep the editor and native dialog out of print output.

### A4 report printing

Files: app/globals.css, app/(dashboard)/reports/page.tsx, app/(dashboard)/invoice-report/page.tsx
Last updated: 2026-10-15

Reports and ledger statements use named A4 print pages with 10mm margins; the 12-column stock report uses A4 landscape. Remove dashboard inner padding during print. Report tables fill the printable width with fixed layout, zero minimum widths, 10px text, 5px 4px cells and wrapping content. Remove horizontal scroll clipping and nowrap rules in print, repeat table headers and keep ordinary rows together. Use block report flow for page breaks. Keep these rules scoped to report/ledger templates so invoice and thermal receipt sizes remain independent.

### Daily Statement report

Files: components/DailyStatementReport.tsx, app/(dashboard)/reports/page.tsx
Last updated: 2026-10-15

Extend the existing report-card selector and single-date generate flow. Reuse the same DailyStatementReport for screen and A4 print. KPI panels use var(--gray-100) borders, rounded-[12px], px-4 py-3, blue-deeper totals, and gray-800 notes. Use a responsive one/two/four-column KPI grid and four columns on print. Detail tables reuse DT styles with right-aligned monetary values, wrapping descriptions, horizontal scrolling on screen and A4 wrapping in print.

Income is real cashbook inflow across payment methods. Show recorded expenses, sales return credits, supplier return credits, all cash out, net cash movement, sales invoices and purchase invoices separately. Exclude opening balances and Adjustment entries from cash metrics. Explain pending expenses, non-cash credits and double counting. Fetch invoices by invoice date and returns by return date, including returns against older invoices. List invoice/return activity, expense records and cash movements even when one section has no records.

### Party invoice settlement

Files: app/(dashboard)/accounts/page.tsx, lib/partyInvoiceSettlement.ts
Last updated: 2026-10-15

Party invoice lists show Received on invoice, Remaining and Status separately. Preserve the original on-invoice receipts for ledger deduplication; ledger payments change remaining balance and status without generating duplicate cash entries. Settle general credits against opening debt, then invoices ordered by invoice date, creation time and ID. Show Partial until the remaining invoice balance reaches zero. Return credits reduce the original invoice, excess credit carries forward, and walk-in/supplier invoices stay separate. Recalculate on payment create/edit/delete, invoice changes, sales returns and opening the party invoice list.

### Conditional invoice discount print summary

Files: components/InvoiceDiscountSummary.tsx, components/InvoiceLineDiscount.tsx
Last updated: 2026-10-15

Share the summary between A5 party invoice and 80mm walk-in print/PDF. When discounts have a positive monetary amount, show Subtotal before discounts, Product discounts where applied, and Invoice discount where applied (with percentage for percentage discounts). Use 11px black text, thin black separators, right-aligned deductions and a break-inside-avoid block. Hide the entire summary and per-product discount notes when nothing was deducted. Use stored line amounts and discount amounts, preserving decimals; never deduct a product discount twice. Load canonical invoice header and item data before printing a saved walk-in invoice.

### Return History tab

Files: components/ReturnHistory.tsx, app/(dashboard)/returns/page.tsx
Last updated: 2026-10-15

Add Return History beside Sales Invoice Return and Supplier Invoice Return, using the same blue-deeper active tab and neutral button styling. History uses white rounded-[14px] panels, gray-100 borders, p-4/sm:p-5 padding, gray-50 labelled search/select fields, 8px input/button corners, and DT table styles. Provide sales/supplier filters, case-insensitive invoice/party/product/return-ID search and 25-record pagination. Open details inline with Back to history, wrapping product descriptions, centered quantities, right-aligned credits and a thermal receipt reprint action. Preserve read-only saved records and identify Whole invoice, Remaining invoice or Selected items from actual saved quantities and earlier returns, using creation order rather than backdated return dates.

### Reference letterhead update

Files: components/PrintHeader.tsx, public/brand/letterhead.svg, app/(dashboard)/quick-invoice/page.tsx, app/(dashboard)/returns/page.tsx
Last updated: 2026-10-15

Use the shared inline SVG for all print and PDF headers. Reference proportions use a 700 x 152 viewBox, 1.3-scale triangular logo on the left, centered Georgia/Times bold 34px business name, Arial bold 13px contact lines and a 2px blue rule. Thermal variant uses a 700 x 170 viewBox with 38px name and 18px contacts. Correct middle mobile: 03342427408. Keep the static SVG asset identical to the default component. Email and sales-manager details are absent throughout.

### Stock report category filter

Files: app/(dashboard)/reports/page.tsx, app/api/reports/stock/route.ts
Last updated: 2026-10-15

Use SearchableSelect beside Product with the same gray-50 background, gray-200 border, 8px corners and blue focus outline. Search all categories, with All categories and Uncategorized options. Category changes reset Product and invalidate the generated report; product choices narrow to the category. Apply both filters on the server and identify the category in screen and printed report headings.

### Invoice and report print readability

Party invoices use A5 with 10mm margins, a 190mm printable minimum height, 12?13px detail text and 14px totals. PDF capture uses the same 10mm inset. A4 reports use 12mm margins and 12px table text with wrapping and repeated table headings. Keep numeric grids inside their container and allow descriptions to wrap. These print sizes supersede the smaller ledger typography above.

### Purchase invoice deletion

Only admins see the red trash action beside Edit in the purchase invoice list. Require confirmation, disable while deleting, and surface server errors. Server deletion reverses unused received batches atomically and blocks invoices with payments, returns or sale allocations.


### Party invoice deletion and audit

Admins see a red Delete action beside View in party invoices, and Delete Invoice beside Edit Invoice in the detail footer. Reuse confirmation and busy states; refresh party balances and return to the invoice list after deletion. All record deletions are audited by the server transaction, with record reference, amount and authenticated user. Client logActivity skips deletion to avoid duplicates.

### Packet product entry (Update 010)

Files: components/ProductPackagingFields.tsx, components/ProductStockField.tsx, components/ProductCreateModal.tsx, app/(dashboard)/products/page.tsx
Last updated: 2026-10-20

Preserve the existing sky-50 packaging fieldset, sky-200 border, rounded-xl corners and p-3 spacing. Packaging inputs use rounded-lg, gray-300 borders, p-2 and text-sm. Stock inputs retain gray-50/gray-200 tokens, 9px corners and 13px monospace numerals. Label packet stock, cost and selling price explicitly; accept the piece price in an editable labelled numeric input and autofill the editable packet price.

### Invoice selling units (Update 011)

Files: components/InvoiceUnitSelect.tsx, app/(dashboard)/accounts/page.tsx, app/(dashboard)/quick-invoice/page.tsx
Last updated: 2026-10-20

Sales use the Sell in button group described in Update 013 below. Beneath Rate, show per Piece or per Packet in text-xs with gray-800 text and mt-1 spacing. Preserve invoice row alignment and discount/total typography.

### Invoice selling unit buttons (Update 013)

File: components/InvoiceUnitSelect.tsx
Last updated: 2026-10-20

Use a fieldset with a text-xs semibold legend and wrapping buttons separated by gap-1.5. Buttons have 6px corners, 1px borders, px-3 py-1.5 spacing and a 36px minimum height. Selected buttons use blue-deeper background and white text; other buttons use white background, gray-200 border and blue-deeper text. Expose selection with aria-pressed and retain a visible blue keyboard focus outline. Packet size appears below in gray-800 text-xs.

### Editable piece selling price (Update 012)

Files: components/ProductPackagingFields.tsx, components/ProductCreateModal.tsx, app/(dashboard)/products/page.tsx
Last updated: 2026-10-20

Retain existing packaging input styling. Piece selling price uses a numeric input with 0.01 step. Packet selling price autofills from piece price times packet size and supports a manual override. Show an underlined text-xs Use calculated price button with mt-1 spacing when overridden. Helper text explains the calculated default and editing.

### Product units and adjacent prices (Update 014)

Files: components/ProductPackagingFields.tsx, components/ProductCreateModal.tsx, app/(dashboard)/products/page.tsx
Last updated: 2026-10-21

Reuse the packaging two-column grid with gap-3. Unit uses a labelled native select styled like the existing rounded-lg, border-gray-300, p-2, text-sm, white inputs. Put piece and packet selling prices in the same grid row; keep the calculated-price reset beneath the packet input.

### Party invoice print columns (Update 018)

Files: app/(dashboard)/accounts/page.tsx, app/globals.css
Last updated: 2026-10-22

Keep A5 portrait (148 x 210 mm), 10 mm vertical and 4 mm side margins in both browser print and PDF capture. Bill-to, item grid and totals have no extra horizontal inset. Use seven columns: SN 5%, Product 24%, Description 21%, Qty 10%, Rate 14%, Disc. % 10%, Amount 16%. Preserve Arial 13px body, compact 10px uppercase white-on-blue headers and 1px black column rules. Description preserves line breaks in its own cell; discount always shows the stored percentage, including 0%. Line amounts already include discounts. Avoid splitting item rows across printed pages.

### Colorful A4 letterhead (Update 028)

Default PrintHeader uses the original blue triangular logo and blue contact text, including email and sales contact. Explicit invoice/challan/thermal variants remain independent. Ledger debit amounts print red, credit amounts green, and balances follow the screen sign colors.

### A5 portrait invoices (Update 029)

Shared invoice sheets now measure 148 × 210 mm with 10 mm vertical and 4 mm horizontal insets. Use 12px compact line-item text and 70 mm totals. Keep measured pagination, repeated headers and page numbering. Browser printing and PDF export use identical sheets.
### A5 print header spacing and readiness (Update 030)

Files: app/invoice-print.css, lib/invoicePrint.ts, app/(dashboard)/accounts/page.tsx
Last updated: 2026-10-27

Keep A5 sheets at 148 × 210mm with 15mm top, 10mm bottom and 4mm side padding. Measurement and rendered sheets must use matching spacing; deduct both vertical paddings from pagination capacity. Party print actions say A5 Print and retain the existing button styles and busy indicator, releasing controls on preparation failure.

### Clean A4 statement letterhead (Update 032)

File: components/A4PrintHeader.tsx
Last updated: 2026-10-27

Retain the colorful A4 logo, centered business title and blue address/contact text. Show the business address, telephone and mobile numbers only; omit the email address and individual sales-manager line from shared A4 print/PDF headers.
### Product activity (Update 033)

Edit Product uses a labelled Product status fieldset with Active and Inactive buttons. Use aria-pressed, blue-deeper selected background with white text, outlined unselected buttons and visible keyboard focus. Save status with the other product fields. Default the product list to Active; offer Inactive and All filters so hidden products can be reactivated. Show an Inactive label beside inactive names in management views. Keep historical document content intact.
