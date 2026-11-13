# Update 039 — Separate party and supplier ledgers with the same name

## Problem and result

A customer and supplier can both be named **AS Enterprises** while having
different IDs. The party overview and interactive supplier ledger previously
selected cashbook entries by account_name, allowing payments from the other role
to enter their running balances. Report statements and invoice settlement already
had some reference checks, so screens and statements could disagree.

The fix uses supplier IDs, purchase IDs and linked cashbook IDs to exclude supplier
transactions from party balances. Known customer invoice references take
precedence over fallback wording. Clearly application-labelled legacy supplier
payments/returns/refunds are kept out of party calculations too. Generic old
name-only history is not automatically reassigned between roles.

The supplier ledger now loads by supplier ID from an authenticated read-only
endpoint and uses the same reference-aware statement calculation as Reports.
It includes linked payments whose recorded name predates a supplier rename,
avoids double-counting header payments, and carries the existing paid-opening
reconstruction. Customer receipts and adjustments no longer enter that ledger.
Ambiguous/unlinked history raises a review warning visible on screen and print.
Stale responses after switching/closing suppliers cannot replace the new ledger.

Party list balances, party ledger data, invoice-balance refresh, printed party
statements, server settlement and payment-notification balance calculations use
the shared ownership rules. The original cashbook movements still affect the
correct payment-method/cash balances. There is no automatic customer/supplier
netting: they remain separate ledgers even when they represent the same business.

## Example verified with synthetic fixtures

Customer invoice 10,000, customer receipt 1,000; supplier purchase 5,000,
supplier payment 2,500, all under AS Enterprises:

| Ledger | Correct remaining balance | Old interactive balance |
| --- | ---: | ---: |
| Party / receivable | 9,000 | 11,500 |
| Supplier / payable | 2,500 | 3,500 |

The fixture is not a read of production AS Enterprises records. No live balances
or payments were edited. This is an application-calculation/read-path correction,
not a data migration: it does not delete or rewrite cashbook entries, issue
payments, merge/rename entities, change stock, or repair previously entered manual
corrections. Existing cached account.balance may differ until its normal
ledger-based resync; the displayed party balance uses the corrected ledger.

## Validation

- `npm run test:ledger-ownership`: 13 PostgreSQL integration tests exercise the
  real party/supplier APIs with a shared-name fixture, arbitrary payment labels,
  supplier/purchase references, linked payment IDs, renamed supplier history,
  returns/reversals/refunds, ambiguous old rows, role/active-user authorization,
  unchanged cashbook records, and the corrected queued notification body.
- 191 unit tests pass, including pure ownership classification and existing
  settlement, return and statement tests. The test adapters resolve the actual
  shared helpers rather than reimplementing filtering logic.
- Production build and TypeScript checking pass. Chromium exercises the actual
  supplier component with synthetic responses: the ledger loads by ID and the
  screen/print template include only supplier rows and the expected 2,500 balance.
- Notification tests only write an isolated database outbox; no messages are
  sent. Production AS Enterprises history still needs operator verification.

## SSD-only deployment and verification

After merge, preserve local changes, `.env`, stash and rollback in
`/home/deploy/ssd`. Pull merged main using --ff-only, run npm ci, stop only the
existing SSD PM2 process before replacing its active build, build successfully
and restart only SSD with its preserved environment. Confirm the existing
root-owned id 10 `ssd-app` still owns cwd `/home/deploy/ssd` and port 3000.
Leave ssd-backend on 3012, other apps, PostgreSQL/Nginx and WhatsApp sessions
untouched. Review stashed changes before restoring any. No database migration
or manual stock/balance adjustment is required for this update.

Read-only verification on production: find both AS Enterprises entity IDs,
compare supplier-payment references and purchase-linked cashbook IDs with the
party receipt/invoice IDs, and verify each screen and printed statement contains
only its own role's movements. A supplier payment must still exist in Cash Book
and method balances while disappearing from the party ledger. Inspect warning
rows individually; do not silently reclassify or delete generic legacy entries.
Check cached-balance drift separately and retain all historical credits/refunds.
Do not create artificial transactions or send notifications for verification.
