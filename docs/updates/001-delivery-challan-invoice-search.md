# Update 001 — Delivery challan search by invoice number

Suggested PR title: `Update 001: Search delivery challan invoices by number`

The delivery challan selector previously showed only the latest 300 invoices. A new search field queries saved invoices by full or partial invoice number, case-insensitively, including older invoices. Requests are debounced and stale responses ignored. Clearing the search restores recent invoices; the selected challan remains selected while searching. Loading, error and no-result messages explain the result.

Implementation: `app/(dashboard)/delivery-challan/page.tsx`.
No schema migration or dependency changes are needed for this update.
Keep the pending WhatsApp deployment changes separate from this PR.

Validation: TypeScript and page ESLint passed. Browser checks with a real login and mocked invoice/challan responses passed for full/partial search, older invoice selection, no matches, clearing search, preserving selection and mobile width.
