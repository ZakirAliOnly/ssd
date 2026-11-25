# Update 041 — Purchase invoice search and pagination

The Supplier page's Purchase invoices section now searches PO numbers and supplier/party names. Matching is case-insensitive and ignores surrounding spaces. Search covers the complete loaded purchase history: the former 80-header cutoff is removed. Purchase items continue to load on demand.

The table defaults to 10 rows per page, with 25 and 50 options, Previous/Next controls, current page count, and the visible result range. Changing the search or page size returns to page one. The current page is clamped when refreshed results shrink. Empty results, loading failures, and retry are shown explicitly. Supplier payable calculations and the purchase editor retain the full header list rather than only the displayed page.

Verified with TypeScript and a production build. A browser check against the actual Supplier page with 117 synthetic POs covered next/last-page boundaries, finding PO001 beyond the former 80-record limit, supplier-name matching with mixed case and spaces, page-size changes, empty results, clearing search and mobile controls. These browser checks use mocked data; production was not accessed or changed.

No database migration is required for this update.
