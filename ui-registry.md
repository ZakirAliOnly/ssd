# UI Registry

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

Product edit forms show stock quantity through ProductStockField in read-only mode, with helper text explaining that purchases add stock and sales reduce it. New-product opening stock remains editable. Product edit submissions omit quantity changes.

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
| Border radius | rounded-[14px] report panel; rounded-[8px] category selector |
| Text — primary | existing DT table tokens; text-lg font-extrabold heading |
| Text — secondary | text-xs var(--gray-800) |
| Spacing | p-4 panel; DT.tdDense table cells |
| Focus state | focus-visible:outline-2 focus-visible:outline-[var(--blue)] |
| Shadow | var(--shadow-sm) |
| Accent usage | existing ReportTypeCard blue active state; var(--red) for incomplete history |

**Pattern notes:** Reuse ReportTypeCard and the report date controls. Share StockReport between screen and print. Include a separate Description column after Product; preserve line breaks, wrap long descriptions, and show a dash when absent. Left-align descriptive columns, center quantity headers/values/totals, and right-align currency headers/values/totals with matching cell padding and monospace values. Explain unavailable historical balances in visible copy.

### Delivery challan print header

File: components/PrintHeader.tsx (challan variant)
Last updated: 2026-10-13

| Property | Style |
| --- | --- |
| Background | #fff |
| Border | 2px solid #0284c7 under letterhead |
| Text — primary | Georgia bold business name, #111 |
| Text — secondary | Arial semibold contact details, #0369a1 |
| Spacing | gap 20px; header padding 0 0 10px; document top padding 6mm |
| Shadow | none |

**Pattern notes:** Top-align enlarged triangular logo with the business name. Keep address and phone details; omit email and sales-manager lines only in this variant. Challans omit delivery number and receiver/delivery/signature fields in both editor and output.

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
