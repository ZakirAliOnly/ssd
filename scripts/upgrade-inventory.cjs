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
];
const sql = migrations.map(file => fs.readFileSync(path.join(__dirname, file), "utf8")
  .replace(/^\s*(BEGIN|COMMIT);\s*$/gm, "")).join("\n");
const result = spawnSync(process.execPath, [require.resolve("prisma/build/index.js"),
  "db", "execute", "--stdin", "--schema", "prisma/schema.prisma"], {
  cwd: path.join(__dirname, ".."), input: `BEGIN;\n${sql}\nCOMMIT;\n`, encoding: "utf8",
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
