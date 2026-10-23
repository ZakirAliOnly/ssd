# Update 020 — Kits, vials and consistent product editing

Add Product and Edit Product use the same loose-unit setup: choose Vial/Piece, enter vials per kit/box, price per vial and stock in full kits plus extra loose vials. Kit selling price calculates automatically and remains overridable. Existing custom prices are loaded when editing, while calculated prices continue to follow the loose price. Optional outer boxes retain their existing sizes and prices.

Stock remains stored in base units. Three kits of ten vials stores 30 vials; selling a kit deducts ten and selling a vial deducts one. Editing packaging sizes preserves existing physical stock and saved document conversion factors. Converting a previously unconfigured product still requires confirmation of what its existing quantity represents.

Products and stock reports show kit/packet equivalents and stock value at current cost. Report revenue and historical costs are unchanged; current-cost value is labelled separately. Invoice lines ask “How do you want to sell?” with Vial/Kit options for vial products. Legacy piece/packet/box keys and conversions are retained. No schema or dependency change is required.

Validation: targeted stock/unit/validation tests and the complete Node regression suite, separate TypeScript check, production build and focused ESLint. Chromium exercises the actual Products page with a mocked API: a new 3-kit product stores 30 vials with an automatically calculated price, while editing a saved product loads its kits, extra loose vial, prices and cost without changing its physical stock. No production records were changed.
