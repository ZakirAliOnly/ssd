# Update 036 — Preserve legacy stock during customer returns

Customer returns recalculated product stock from batches even when the existing
on-hand quantity had no batch history. Reproduced through the returns API harness:
six units on hand plus a one-unit return incorrectly became one unit, instead of
seven.

While holding the existing product lock, seed an opening batch from the current
on-hand quantity only if the product has no batches at all. Then restore the
returned stock and synchronize the total as usual. Depleted tracked batches are
left intact. Opening stock, return records, credits and totals commit together in
the existing transaction; request retries remain idempotent.

Validation: the new regression test failed with `1 !== 7` before the fix and
passes afterward, including a retry and a subsequent return of the remaining
quantity. A separate test verifies restoration to a fully depleted tracked batch.
All 64 focused inventory, invoice, customer/supplier return, return history,
return policy, stock report and stock edit tests pass using the rollback-capable
API harness and unit tests after rebasing onto current main. These checks do not
verify the deployed database or browser.

No schema migration is required. This change preserves existing on-hand stock
for future returns; it does not reconstruct stock already lost by earlier
returns. Those balances require reconciliation against physical stock and history.

