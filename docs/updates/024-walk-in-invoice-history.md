# Update 024 — Walk-in invoice history pagination and filters

Walk-in Invoice history now uses database pagination with **15 invoices per page**, replacing the fixed latest-50 query. First, Previous, Next and Last controls allow access to all matching saved walk-in invoices, including older records. The footer shows the visible range, matching invoice count and current/total page count.

A combined month/year picker filters by the invoice date. Payment status offers All, Paid, Unpaid and Partial. Filters apply together in the database before counting or pagination. Changing a filter or using Clear filters returns to page 1. Filter controls stay visible for empty results, allowing users to recover without reloading. The initial state shows all months and all payment statuses.

A dedicated read-only endpoint checks authentication, active-user status and Walk-in Invoice module permission. Count and page rows are read in one RepeatableRead transaction, sorted newest-created first with an ID tie-breaker. Requested pages clamp to the last available page after records are removed. Only the displayed 15 invoice headers are returned, with the dates and money types expected by existing row actions.

The UI cancels superseded requests and ignores their results. Loading/error states and Retry are explicit. Payment, save/edit and deletion refresh the latest selected history filters rather than stale filters captured when a mutation began. Changing history pages or filters does not refetch the catalogue or dashboard totals. Existing invoice operations, financial calculations and dashboard total scope are unchanged; an unused account lookup that was coupled to history refresh is removed.

## Validation

- Six endpoint tests pass: 64 invoices across five pages, older-than-50 access, party exclusion, each status, combined month/year, leap-month/December bounds, JSON date/money compatibility, empty results, page clamping, invalid parameters and access control.
- Chromium exercises the actual Walk-in Invoice page with mocked network boundaries: 15 rows, matching counts, access to the oldest invoice, filter combinations/reset, empty results, Retry, stale-response protection and no unrelated refetches. Mobile overflow checks pass, and the desktop layout was visually reviewed with production CSS.
- Production build, separate TypeScript and focused ESLint checks pass.
- No production records or messages were created. No schema, dependency or migration changes are required.

## SSD-only deployment

After merge, deploy main in `/home/deploy/ssd` with SSD Node 22. Preserve local changes, `.env`, database and the working rollback build. Stop only `ssd-app` before replacing its build, then start it using its existing configuration after a successful build; restore the previous build if deployment fails. Keep port 3000, Nginx, shared PM2 and other apps unchanged. Verify public/direct assets and existing walk-in history after browser login without creating transactions.
