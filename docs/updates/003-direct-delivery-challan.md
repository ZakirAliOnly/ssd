# Update 003 — Open delivery challan directly by invoice number

Suggested PR title: `Update 003: Open delivery challan directly by invoice number`

Replace the search-plus-select workflow with an invoice number field and Open delivery challan button. Enter submits the same action. Exact invoice numbers open directly, and a unique partial match also opens directly. Multiple matches appear as clickable invoice/customer/date results; the app never silently picks among ambiguous matches. Empty queries are disabled and missing invoices show a clear message.

Exact-number lookup runs before the limited partial-result query, so an older exact match is not excluded by recent results. Search results from superseded inputs are ignored. Failed document loads hide the old editor and can be retried with the same invoice number. The form stacks on mobile. Existing invoice URL links, challan editing, print and PDF actions remain available.

Scope: `app/(dashboard)/delivery-challan/page.tsx` and this note. No dependency changes or migration required. Pending WhatsApp changes are separate.

Validation: TypeScript and page ESLint passed. Browser smoke with real login and mocked business records verified Enter/exact match, button/unique partial match, ambiguous results, no match, removal of the select dropdown and 375px layout without horizontal overflow.
