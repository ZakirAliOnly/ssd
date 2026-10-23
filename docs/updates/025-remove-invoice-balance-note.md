# Update 025 — Remove invoice balance explanation

Remove “Party balance as of … Other balance includes later transactions.” from the party invoice detail view and shared invoice document used for print and PDF exports. Walk-in invoices, purchase orders and returns do not contain this explanation.

The current party balance lookup, totals, discount calculations, totals order, page dimensions, repeated headers and page-number footer are unchanged.

## Validation

Seven invoice document tests pass, including an assertion that the explanation is absent while the live ledger closing and derived previous/other balance remain correct. Focused ESLint has no errors; the existing unused `editingInvoiceOldBalanceDue` warning remains in Accounts. Production build and separate TypeScript checks pass.

No dependency, schema or migration changes are required. After merge, deploy only SSD in `/home/deploy/ssd`, preserving local changes, `.env`, database, rollback build, port 3000, Nginx and other apps. Stop only `ssd-app` before replacing its active build and start it after a successful build. Verify an existing invoice's screen, print preview and PDF after login.
