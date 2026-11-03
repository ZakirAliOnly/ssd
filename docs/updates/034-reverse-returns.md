# Update 034 — Reverse mistaken returns

Super admin can use **Returns → Return History → View details → Reverse Return**.
This reverses the whole selected return; enter any correct partial return again
afterward. The original return stays visible as Reversed, with reason, actor and
time. There is no permanent Delete button.

## Confirmation and closed dates

- Within 24 elapsed hours of `created_at`, use the normal confirmation form.
- After 24 hours, additionally type **REVERSE** after reviewing the stock/credit
  effects. The server checks this window; an entered/backdated return date does
  not determine it.
- Every reversal requires a reason and an explicit cash-refund review.
- **Return accounting period — admin** in Return History manages an inclusive
  closed-through date. Initially no dates are closed. Closing/reopening requires
  a reason and is audited. This is a return-specific lock, not a financial-year
  close for other modules.
- New returns dated in closed dates are blocked. Reversal is blocked if either
  its original return date or current business date is closed; use a reviewed
  dated stock/ledger adjustment in an open period instead.

Business dates use Asia/Karachi; the 24-hour window uses elapsed timestamps.
Authorization reloads the current user's role and active status from the database.

## Stock and money

Example: 20 vials → sell 4 → 16 → return 4 → 20 → reverse return → 16.
Sales reversal removes the quantities from the original restored batches;
supplier reversal puts quantities back into the original purchase batches.
Reversal is blocked if those original batches lack enough stock, even when a
different batch has stock. No negative stock or invented stock transfers.

The original invoice, return items, allocation history and original noncash
credit remain. A dated opposite Adjustment entry cancels that credit; affected
invoice/supplier balances are recalculated. Cancelled quantities become
returnable again. Invoices with any return history remain protected from edits
and deletion so their audit references are preserved.

Cash payments are never automatically altered. The existing model cannot always
associate a separately entered refund with a specific return; the admin must
confirm that cash refunds have been reviewed and any necessary correction made.
This is a human attestation, not automatic refund reconciliation.

Original and cancellation credits cannot be edited/deleted through Cash Book.
Stock reports retain the original event on its original date and an opposite
effect on the reversal date. History, receipts and Activity Log expose the
reversal; period changes appear in Activity Log too.

Stock movements, ledger correction, reversal metadata and audit commit in one
Serializable transaction using the existing inventory advisory lock. Repeat
requests are idempotent by return id; supported serialization/deadlock conflicts
are retried. Period changes use the same lock to prevent a cutoff/reversal race.
Reversal sends no external messages.

New legacy fallback returns save the identity of the restoration batch. Older
returns with missing allocation/restoration-batch history are blocked for manual
review rather than guessing which stock should be removed.

## Migration and validation

`migration-v41-return-reversals.sql` adds reversal metadata/ledger references,
per-batch reversal movements, a fallback restoration-batch reference and a
singleton cutoff. It is repeatable and preserves business records. SQL-only
quantity/ownership/singleton constraints are also installed on Prisma-created
tables. The combined inventory upgrade includes v41. No dependencies are added.

Tests cover current-role authorization, normal and late windows, backdating,
closed dates, returnable quantities, customer/supplier/kit reversals, insufficient
stock, duplicates/concurrency, ledger protection, legacy history, dated reports,
migration reruns and rollback after an injected ledger failure. Mobile Chromium
checks exercise normal admin, late admin and sub-user forms; real server
behavior is tested separately against an isolated PostgreSQL schema.

## SSD-only deployment

Back up only SSD's database and retain the current commit/build. Preserve local
changes, `.env`, WhatsApp keys/sessions and other apps. Confirm the existing
root-owned PM2 id 10 `ssd-app` is `/home/deploy/ssd` on port 3000. Stop only SSD
before migration/build so requests cannot write returns during the version change.

After pulling the merged update in `/home/deploy/ssd`:

```bash
npm ci
npm run db:upgrade:return-reversals
npm run db:generate
npm run build
```

Stop on migration/build failure. Restart only SSD's existing PM2 process after
success; leave `ssd-backend` on 3012, other PM2 apps and shared PostgreSQL/Nginx
untouched. Preserve the working SSD proxy mapping. No WhatsApp worker restart.
Verify public CSS/pages, actual listener, and admin versus sub-user behavior.
Use an isolated database or an operator-approved legitimate correction to verify
stock/credit effects; do not create artificial production transactions or send
messages for testing.

Keep the additive schema if rolling back an app build. Once reversals exist,
old calculation code counts them as active returns and is unsafe to redeploy.
Retain a compatible build or plan explicit reconciliation; never delete audit
rows or restore a backup blindly over subsequent live work.
