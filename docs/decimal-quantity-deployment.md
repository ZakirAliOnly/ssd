# Decimal invoice quantities and prices

Before starting this version against an existing database, apply both pending invoice migrations and regenerate Prisma:

```sh
npm run db:upgrade:item-discounts
npm run db:upgrade:decimal-quantities
npm run db:generate
npm run build
```

Quantities and stock movements support two decimal places. Existing integer quantities retain their values. Invoice price × quantity uses the exact entered decimals and rounds only the final monetary result to two decimal places. Currency displays retain fractional rupees instead of rounding to whole rupees.

The stock migration converts product balances, FIFO batches, allocations, and tracked invoice/purchase quantities together. Mirrored quick-invoice and quotation quantities also become decimal so invoice copies retain the original quantity. No database migration is run by editing the source files.
