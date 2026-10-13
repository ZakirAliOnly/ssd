# Invoice product discounts

Apply the new invoice-item column before starting the updated app:

```sh
npm run db:upgrade:item-discounts
npm run db:generate
npm run build
```

Existing lines default to zero discount. Each product discount reduces that line's amount; invoice-wide discounts then apply to the net subtotal, followed by applicable taxes. Stock consumption remains based on quantity. Saved lines retain the original unit price and discount percentage for editing and printing.
