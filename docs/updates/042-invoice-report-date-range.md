# Update 042 — Fix invoice report date ranges

The shared database adapter assigned each range predicate to the same `where[column]` key. Adding `lte` replaced the earlier `gte`, so Invoice Report ignored From Date and included older invoices. Each range bound now remains in Prisma's AND conditions. Both endpoints are inclusive and retained regardless of filter order. Other screens using the same adapter's date or numeric ranges benefit from this correction.

Invoice Report also ignores outdated responses after quick date changes, clears stale results on failed requests, shows errors with Retry, rejects reversed ranges and disables printing while loading or invalid. Clearing either date leaves that side of the range open. Screen totals and printed rows share the same successful result set. The default month start is derived from the same date string as the default end date.

Validation: real PostgreSQL tests in an isolated local schema cover inclusive boundaries, reversed filter order, same-day and reversed ranges, open ranges, client filtering and counts, cashbook ranges, numeric ranges and equality. Existing unit tests, TypeScript and production build are checked. Browser checks exercise the actual report component with controlled responses, including delayed outdated requests, invalid dates, failed loads, retry and print rows. No production records are modified.

No database migration is required.
