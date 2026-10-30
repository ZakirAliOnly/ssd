const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// Run the inventory prerequisites and decimal conversion together, so a failed
// upgrade cannot leave only some of the required stock columns installed.
const migrations = [
  "migration-v25-product-categories.sql",
  "migration-v26-product-stock.sql",
  "migration-v27-product-expiry.sql",
  "migration-v28-purchase-product-expiry.sql",
  "migration-v30-stock-batches.sql",
  "migration-v31-invoice-item-discount.sql",
  "migration-v32-decimal-quantities.sql",
  "migration-v33-invoice-returns.sql",
  "migration-v34-supplier-returns.sql",
  "migration-v39-product-packaging.sql",
  "migration-v40-packaging-stock-constraints.sql",
];
const sql = migrations.map(file => fs.readFileSync(path.join(__dirname, file), "utf8")
  .replace(/^\s*(BEGIN|COMMIT);\s*$/gm, "")).join("\n");
// A Prisma-created schema can already contain kit sales but lack SQL checks.
// Install the packaging-aware invoice check before v26; otherwise v26 tries to
// validate its obsolete unit-only bound before v40 gets a chance to replace it.
// Legacy rows receive factor 1. This prelude shares the upgrade transaction.
const packagingStockPrelude = `
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS stock_deducted_qty NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS unit_factor NUMERIC(14,2) NOT NULL DEFAULT 1;
ALTER TABLE invoice_items DROP CONSTRAINT IF EXISTS invoice_items_stock_deducted_valid;
ALTER TABLE invoice_items ADD CONSTRAINT invoice_items_stock_deducted_valid
  CHECK (unit_factor > 0 AND stock_deducted_qty >= 0
    AND stock_deducted_qty <= round(qty * unit_factor, 2));
`;
const result = spawnSync(process.execPath, [require.resolve("prisma/build/index.js"),
  "db", "execute", "--stdin", "--schema", "prisma/schema.prisma"], {
  cwd: path.join(__dirname, ".."), input: `BEGIN;\n${packagingStockPrelude}\n${sql}\nCOMMIT;\n`, encoding: "utf8",
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
