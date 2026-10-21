# Update 015 - Load Products and Walk-in Invoice data on demand

Products previously downloaded and rendered the entire catalogue. Walk-in Invoice fetched the entire catalogue on entry, fetched it again on opening the form, downloaded every account despite no longer using that list, and downloaded historical walk-in invoice rows just to compute summary totals. PDF libraries were also imported on page entry.

Products now fetches 25 rows at a time, with server-side search across name, code, description and category. Search resets the page, waits 250ms between keystrokes and aborts superseded requests. The count represents all matching rows. Edit loads the selected product again to preserve stock conflict checks. Code suggestions use a server aggregate over the complete catalogue, preserving the first-number convention even with prefixed codes.

Walk-in history loads 25 invoice headers at a time. Administrator totals use database aggregates over all walk-in invoices, independently of the current page; other users do not fetch these hidden cards. Product pickers request at most 20 matches only when opened, and retain the selected product's unit/price metadata across searches. Reopen/print loads only products referenced by that invoice. Payment methods load only when an invoice/payment form opens. PDF capture libraries load on download. Invoice save, stock allocation and unit-factor snapshot logic are unchanged.

The read endpoints check the active session and existing module/dependency grants, return private no-store responses, use bounded pagination with deterministic ordering, and retain explicit loading/error/empty states.

## Validation

Run `npm run test:page-loading` against a **local** PostgreSQL database; it creates and removes a temporary schema. Checks cover page boundaries, full-catalogue search, picker limits and price data, code suggestions, full-history totals, invalid pages/dates and access restrictions. Run TypeScript, focused ESLint, regression tests and a production build. Browser verification should cover pagination, search, invoice selection/reopen and print/PDF behavior using isolated fixtures.

## SSD deployment

Implementation verification: TypeScript and diff whitespace checks passed. Focused lint found a synchronous-effect warning in payment-method loading, which was corrected; lint was not rerun. The production build was blocked by failed Google Fonts downloads (Geist/Geist Mono). Database integration execution was blocked by the local test PostgreSQL listener; the expanded test/browser run was stopped at the user's request. No production performance timings are claimed.

No database migration or dependency changes are required. From `/home/deploy/ssd`, preserve local edits, `.env`, the existing WhatsApp key/session and a private SSD-only database backup. Pull the merged Update 015, use SSD's Node 22 runtime to generate Prisma and build, then restart only the existing `ssd-app` process. The WhatsApp worker can remain running. Preserve port 3000 and the working SSD-only Nginx headers/routing. Leave other apps and shared PostgreSQL/Nginx services untouched. Verify paginated products, searches beyond the first page, walk-in history/totals, product selection and stylesheet assets. Do not create real financial records or send notifications for deployment checks.
