# Update 002 — Invoice and purchase details in ledgers

Suggested PR title: `Update 002: Show invoice and PO items in ledger reports`

Display saved product descriptions, quantities, unit prices and line amounts below each sale invoice or purchase invoice in Parties and Supplier ledger reports. Party details now share the same component for screen and print/PDF, including recorded line discounts. Supplier details are fetched in one batch, grouped by purchase order ID, and show fractional quantities and recorded units.

Detail lines are informational. Ledger debit, credit, running balance and date filtering calculations are unchanged. No database migration or dependency update is required.

Files for this update:
- `components/LedgerLineItems.tsx`
- `lib/ledger.ts`
- Ledger-specific changes in `app/(dashboard)/accounts/page.tsx` and `app/(dashboard)/supplier/page.tsx`
- This note

Both page files also contain pending WhatsApp changes: exclude those unrelated hunks when preparing this PR.

Validation: TypeScript passed; focused ESLint had zero errors and one existing unused-variable warning in accounts. All 135 regression tests passed. Browser checks with real login and mocked business data verified party/supplier details in the screen and print DOM, sale discounts, fractional purchase units and batched PO item lookup. PDF layout uses this same print DOM; no PDF download test was performed.
