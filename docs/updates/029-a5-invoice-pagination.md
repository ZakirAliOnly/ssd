# Update 029 — A5 portrait invoice alignment and pagination

Use A5 portrait (148 × 210 mm) in the current shared invoice system, with 10 mm top/bottom and 4 mm side insets on every page. Compact table and totals typography for the narrower paper. Preserve measured pagination, repeated headings, page numbers, tall-row continuation and current invoice calculations from Updates 019–027. Fix html2canvas font measurement under Tailwind to avoid clipped PDF text.

This supersedes the 8.5 × 6.5 inch size at the user’s explicit request. No migrations or service configuration changes.

Validation: TypeScript and all seven current invoice-document tests passed. Rendered actual shared templates and PDF export for 0, 3, 12, 35 and 60 items with no sheet overflow; inspected a rendered A5 page.
