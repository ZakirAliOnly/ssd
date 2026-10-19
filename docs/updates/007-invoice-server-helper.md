# Update 007 — Fix first walk-in invoice payment save

Suggested PR title: `Update 007: Fix client-only helper in invoice payment saves`

The WhatsApp outbox imported isLedgerOnlyEntry from paymentMethods.ts, a use-client module. The party balance calculation imported the same client module. Next.js therefore rejected a server-side call while saving a cashbook payment, even though plain TypeScript unit tests passed. In the walk-in flow the invoice can already be committed when its separate payment request fails.

Move the three pure bookkeeping predicates into lib/cashbookEntries.ts. Server-side outbox and balance calculations import the shared utility directly. The payment-method client module re-exports the helpers for existing UI consumers; its hooks stay client-only. No ledger rules, balances or message wording change.

Regression protection: the WhatsApp integration loader rejects runtime imports of use-client modules. Confirmed this guard failed before the fix. Added first paid walk-in save coverage with automation both disabled and enabled.

Validation: production build, TypeScript, 136 regression tests and 30 WhatsApp checks passed. A production Next.js HTTP smoke in a temporary database schema verified login, first walk-in invoice save, cashbook payment save and one queued invoice without a client-function exception. No real messages were sent. Focused lint passed for the shared/server/test changes; paymentMethods.ts retains its pre-existing react-hooks/set-state-in-effect lint error, confirmed against main.

Deployment: preserve .env and the linked Baileys session/encryption key, pull merged main, build with SSD Node 22 and restart only ssd-app. No migration or dependency changes. Keep the working SSD Nginx upstream on port 3000 and other apps untouched. Before retrying a failed transaction, check whether the invoice and its payment were already recorded to avoid duplicate records.
