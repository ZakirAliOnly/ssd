# Update 031 - Keep invoice product pages full

When invoice rows fit a sheet but their totals did not, pagination previously moved as many trailing rows as could fit beside the totals onto the next sheet. This could leave only four products on page one and ten on page two despite the large gap on page one.

Keep pages filled in original product order. When totals require a continuation sheet, move only the final product with them if it fits; an unusually tall text fragment gets a totals-only continuation. If all products and totals fit, keep a single page. Printing and PDF export share this pagination. Preserve Update 030's A5 header margin and the existing prices, quantities, discounts and totals.

No migration or dependencies. Deploy from `/home/deploy/ssd`, preserve `.env`, build with SSD Node 22 and restart only `ssd-app`. Keep SSD's working port 3000 mapping and leave other apps and shared services untouched.

Validation: four focused pagination checks and TypeScript passed. An isolated browser sandbox rendered the actual invoice component and print helpers with sample data. The same 14-product fixture split 5/9 with the previous algorithm and 13/1 with the fix. A four-product fixture remained on one sheet. A 30-product stress fixture with very long descriptions retained all rows in order without sheet overflow. Totals appeared once, top padding measured 15mm on every sheet, and PDF export generated an application/pdf document successfully. No production data was accessed or changed. Physical printer output and the native print dialog have not been verified.
