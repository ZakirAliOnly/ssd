# UI Registry

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
