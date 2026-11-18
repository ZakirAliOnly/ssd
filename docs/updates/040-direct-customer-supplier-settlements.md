# Update 040 — Customer pays supplier directly

Payment Methods now has **Record direct payment** for a customer paying a supplier on SSD's behalf. Choose each account separately, enter amount, date, optional reference and notes, then review both resulting balances before confirming. This workflow is admin-only, consistent with the existing Payment Methods page.

The customer's receivable and the supplier's payable decrease together. Cash, bank, wallet balances and cash-flow totals remain unchanged. Cash Book shows one business event in a separate **Direct settlement history** section, labelled **No cash movement**, with both parties, date, amount, reference and status. The two underlying ledger credits use the existing noncash `Adjustment` channel and cannot be edited or deleted separately.

Customer and supplier IDs are stored independently, so matching names do not merge their roles. The supplier credit applies to remaining opening dues first, then oldest unpaid purchase invoices (including a uniquely identified legacy supplier-name purchase). Invoice settlement is recalculated on the customer side without changing original invoice receipts. Supplier statements reconstruct the opening balance using both cash and direct-settlement allocations, avoiding double-counting.

Amounts must be positive, have at most two decimal places, and fit within both current outstanding balances. No advances or overpayments are permitted. Duplicate party names, inactive customers, and inconsistent supplier credit/overpayment history block saving for review. Dates must be valid, between 2000-01-01 and the business's current date. Server-side balances are rechecked inside a serializable transaction; transaction conflicts retry, and the request ID prevents duplicate submissions.

**Reverse** requires an admin and a reason. It appends both opposite ledger entries on the current business date, restores exactly the supplier opening/purchase allocations, recalculates customer invoices, and preserves the original event and audit history. Repeated reversal requests do not repeat its effect. If purchase payment history has been reduced below an original allocation or party ownership is inconsistent, reversal stops without partial changes. Purchase invoices carrying allocation history cannot be edited/deleted; record corrections separately. This does not reverse any real transfer made outside SSD.

## Database and deployment

Requires the additive, repeatable SSD-only v43 upgrade:

```sh
npm ci
npm run db:upgrade:direct-settlements
npm run build
```

Back up the SSD database and preserve `.env`, sessions and local changes first. Run in `/home/deploy/ssd` against SSD's database only. Restart only the verified SSD PM2 application (currently root-owned id 10 `ssd-app`, port 3000). Leave `ssd-backend` on 3012, other applications, shared PostgreSQL, and Nginx unchanged. The same-origin guard uses the existing HTTPS proxy rules: preserve Host and overwrite X-Forwarded-Proto. No live deployment is performed by this change.

## Verification

`npm run test:direct-settlements` uses an isolated local PostgreSQL schema. It applies the actual migration twice and checks same-name roles, unchanged method balances, invoice and purchase allocation, idempotency, simultaneous submissions, maximum amounts, reversal, later payments, permissions, proxy origins, protected entries, foreign keys and complete rollback after an injected failure.

Also run `node --test tests/*.test.mjs`, `npm run test:ledger-ownership`, `npx tsc --noEmit --incremental false`, and `npm run build`. Browser verification uses synthetic data in an isolated local schema; it covers desktop/mobile form previews, confirmation, saving, Cash Book history and reversal. Screenshots are previews, not production transactions.
