# Update 033 — Correct kit/packet stock database constraints

## Confirmed failure

A party invoice for one kit containing four vials deducts four base units. The
v26 SQL constraint `invoice_items_stock_deducted_valid` still required
`stock_deducted_qty <= qty`, comparing four vials with one kit. PostgreSQL rejects
the invoice-item insert with error 23514, and the transaction rolls back.

This was reproduced in an isolated PostgreSQL schema using the legacy SQL
constraint and the real invoice API: quantity 1, packet factor 4, rate 19,154,
25% product discount, amount 14,365.50. The failed save left no invoice or stock
allocation and preserved the pre-sale quantity. Fresh schemas created with
`prisma db push` omit these SQL-only checks, which is why earlier tests passed.

## Correction

New repeatable migration `migration-v40-packaging-stock-constraints.sql`:

- Replaces the invoice check with a positive factor, nonnegative stock deduction
  and a deduction no greater than `round(qty * unit_factor, 2)`.
- Replaces the similarly outdated v33/v34 return checks. Return rows retain
  nonnegative checks; triggers enforce their upper bounds using the original
  invoice/purchase item's saved unit factor. The API still enforces cumulative
  return limits, original-batch availability and transaction locking.
- Changes validation only; does not rewrite quantities, prices, invoice amounts,
  return records or stock history. All migration DDL is transactional.

`db:upgrade:packaging` now applies v39 then v40. The combined inventory upgrade
also ends with v39/v40, so running it cannot leave the original unit-only checks
active. For an existing v39 deployment, use the narrowly scoped
`db:upgrade:packaging-constraints` command.

## Validation

The PostgreSQL integration suite explicitly installs the legacy invoice and
return checks before reproducing the failure. After v40, the same party sale
deducts four vials; its customer return restores four; a supplier return removes
four. Negative/excessive deductions and returns, and zero invoice unit factors,
remain rejected directly by PostgreSQL. The migration is rerun with existing
return data to verify repeatability and preservation.

The remaining suite covers purchases, loose and packet sales, fractional stock,
invoice edits/deletes, conversions including existing returns, FIFO/history,
overselling and concurrent saves. The full inventory upgrade is also exercised
twice against existing packaged stock and return data. Results are recorded in
the delivery report; local verification is not production verification.

## SSD-only deployment

Use `/home/deploy/ssd` and its existing deploy-owned PM2 application. Record the
current revision, preserve local changes and `.env`, and take a verified backup
of only SSD's database using the existing secure backup procedure. Do not print
database credentials. Retain the backup/previous build until verification.

After this update is merged and pulled, with the existing v39 packaging schema:

```bash
npm ci
npm run db:upgrade:packaging-constraints
npm run db:generate
npm run build
```

Stop only SSD before replacing its active build, using its actual existing PM2
process; restart it only after a successful build. Do not assume a systemd unit
exists. Leave other apps, shared PostgreSQL/Nginx services, WhatsApp keys/sessions
and the port-3000 proxy mapping unchanged. No worker restart is required.

If v39 columns are missing, stop and inspect prerequisite migrations; do not
silently drop validation or modify production quantities. The broader
`db:upgrade:packaging` command is for installing v39 plus v40 when appropriate.

Inspect `pg_get_constraintdef` for the invoice check and verify both return
triggers exist. Verify normal app/assets publicly and directly. With an
operator-approved real transaction or an isolated SSD test database, record
before/after base-unit stock for one kit sale and the applicable return, confirm
exactly one invoice, and check application logs for constraint errors. Do not
create artificial business transactions, send messages or edit stock just to
test production. Inspect the original failed attempt before retrying it to avoid
duplicating a document.

Pull/build/client generation alone cannot repair an already-deployed SQL check.
Do not roll back to the old unit-only constraints after kit deductions exist:
they would reject valid packaged records. Retain v40 validation while rolling
back application code if needed, and assess any database restore separately.
