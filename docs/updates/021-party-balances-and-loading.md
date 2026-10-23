# Update 021 — Parties loading and invoice balance reconciliation

The Parties list previously downloaded every complete invoice and cashbook entry, scanned those arrays for every account and performed a background sequence of cached-balance repair writes. It now loads a read-only overview: accounts, heads and balances derived with the exact same rules as the party ledger. Transactions are indexed once by party on the server and only necessary balance fields are queried. Products load when starting an invoice rather than competing with the initial Parties request. Loading failures are shown with a Retry action.

A selected party's ledger and live balance are read from one RepeatableRead database snapshot. The overview and targeted reads enforce authentication, active-user and Parties-module access, return no-store responses and perform no repair writes. Individual invoice/ledger details still load on demand.

Invoice printing previously used the historical `previous_balance` field, while the ledger closing reflected all current transactions. A fresh party ledger is now read before saving a new invoice, viewing an invoice, printing and downloading it. Existing invoice values are not rewritten. New saves retain signed party credit balances instead of discarding negative previous balances.

## Printed and on-screen totals

Discount/tax details precede New bill → Received amount → Previous / other balance → Total balance. The current party total is explicitly timestamped. Previous / other balance reconciles all *other* transactions (including later receipts, returns and invoices): closing balance − this invoice's new bill + its recorded received amount. This is deliberately labelled as a current reconciliation, not the original historical balance. Walk-in invoices retain their saved balance basis and receive the requested totals order.

For the reported numbers, the old snapshot gives 127,250 + 28,950 = 156,200. If the ledger now closes at 128,950, the refreshed reconciliation shows 100,000 + 28,950 = 128,950. The fixture covers this exact difference and a subsequent receipt. The actual production transaction responsible for the 27,250 difference has not been inspected from this cloud workspace. Historical date-filtered ledgers can intentionally differ from a current balance; printed documents state their balance time.

Failed ledger reads stop saving/printing rather than silently substituting zero. Save-and-print also passes the newly saved invoice explicitly, avoiding a stale React state closure. No migration, dependency change, automatic transaction, historical rewrite or production service change is included.

## Validation and deployment

Seven balance/API tests cover receipt de-duplication, opening balances, credits/refunds, walk-ins, indexed summaries, permissions, read-only snapshot responses and failed reads. Seven document-rendering tests cover totals order and reconciliation. Chromium exercises the actual Parties page with mocked network boundaries: no full-ledger/product download or repair writes on initial load; invoice details reconcile the example; print refreshes a later receipt. Multi-page A5 print/PDF checks, separate TypeScript, focused ESLint and production build are also run.

Deploy after merging using SSD Node 22 in `/home/deploy/ssd`. Preserve local changes, `.env`, database and the current rollback build; stop only `ssd-app` before replacing its build, then start it using its existing configuration. Keep port 3000, Nginx, shared PM2 and other apps unchanged. No migration is needed. Verify existing party records and print previews without creating transactions. Neither cloud test results nor HTTP 200 alone establish production deployment or the live source of a balance discrepancy.
