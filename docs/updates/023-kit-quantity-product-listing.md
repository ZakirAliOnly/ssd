# Update 023 — Kit quantity entry and clear product listing

Configured vial products accept **stock quantity in kits only**. Vials per kit and price per vial define the conversion: 3 kits × 10 vials gives 30 vials, and a vial selling price of 100 gives a kit price of 1,000. The separate extra-loose-vial stock input is removed from both Add Product flows and Edit Product. Ordinary unconfigured products keep their unit quantity field.

The listing shows kit quantity first and total vials as a calculated figure. It labels cost and selling prices per kit and per vial in the same order, with separate margins for each unit (including custom kit prices). Stock value remains total physical stock × base-unit cost. Optional outer boxes retain their own labelled prices. No stored price or stock record is relabelled or converted automatically.

After a loose sale, the kit balance can be fractional: selling one vial from 3 kits of ten leaves 2.9 kits / 29 vials. Editing an existing product shows that equivalent kit quantity without rounding away its physical stock. Changing pack size during new-product entry keeps the entered kit count and recalculates vial stock; existing-product pack-size edits preserve physical stock and historical document factors. A transient empty size field retains the last valid conversion for new entry. Manual kit-price overrides remain available.

## Validation

Browser checks exercise the actual Products page and invoice Add Product modal against mocked API boundaries. They verify labelled stock/cost/prices/margins, kit-only input, decimal kit typing, negative input rejection, preservation of existing stock/cost/custom prices, automatic price/stock calculations, and changing vials per kit after entering quantity. The listing was visually reviewed with production CSS.

Targeted product/unit/stock/validation tests, focused ESLint, standalone TypeScript and production build are run. This update changes UI only; no schema, dependency or inventory/accounting API changes are needed. No production transactions were created.

After merge, deploy in `/home/deploy/ssd` using SSD Node 22. Preserve local changes, `.env`, database and a rollback build; stop only `ssd-app` before replacing its build and start it with its existing configuration after a successful build. Preserve port 3000, Nginx, shared PM2 and other apps. No migrations. Verify existing product display/edit forms without changing live stock.
