-- Update 040: atomic customer-to-supplier settlements. SSD database only.
BEGIN;
-- CreateTable
CREATE TABLE IF NOT EXISTS "direct_settlements" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "customer_name" TEXT NOT NULL,
    "supplier_name" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "date" DATE NOT NULL,
    "reference" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "opening_applied" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "customer_entry_id" UUID NOT NULL,
    "supplier_entry_id" UUID NOT NULL,
    "created_by_email" TEXT NOT NULL,
    "created_by_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversed_at" TIMESTAMPTZ(6),
    "reversal_reason" TEXT NOT NULL DEFAULT '',
    "reversed_by_email" TEXT NOT NULL DEFAULT '',
    "reversed_by_name" TEXT NOT NULL DEFAULT '',
    "customer_reversal_id" UUID,
    "supplier_reversal_id" UUID,

    CONSTRAINT "direct_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "direct_settlement_allocations" (
    "id" UUID NOT NULL,
    "settlement_id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "direct_settlement_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "direct_settlements_request_id_key" ON "direct_settlements"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "direct_settlements_customer_entry_id_key" ON "direct_settlements"("customer_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "direct_settlements_supplier_entry_id_key" ON "direct_settlements"("supplier_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "direct_settlements_customer_reversal_id_key" ON "direct_settlements"("customer_reversal_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "direct_settlements_supplier_reversal_id_key" ON "direct_settlements"("supplier_reversal_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "direct_settlements_date_created_at_idx" ON "direct_settlements"("date", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "direct_settlement_allocations_settlement_id_purchase_order__key" ON "direct_settlement_allocations"("settlement_id", "purchase_order_id");

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "direct_settlements" ADD CONSTRAINT "direct_settlements_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "direct_settlements" ADD CONSTRAINT "direct_settlements_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "direct_settlements" ADD CONSTRAINT "direct_settlements_customer_entry_id_fkey" FOREIGN KEY ("customer_entry_id") REFERENCES "cashbook"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "direct_settlements" ADD CONSTRAINT "direct_settlements_supplier_entry_id_fkey" FOREIGN KEY ("supplier_entry_id") REFERENCES "cashbook"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "direct_settlements" ADD CONSTRAINT "direct_settlements_customer_reversal_id_fkey" FOREIGN KEY ("customer_reversal_id") REFERENCES "cashbook"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "direct_settlements" ADD CONSTRAINT "direct_settlements_supplier_reversal_id_fkey" FOREIGN KEY ("supplier_reversal_id") REFERENCES "cashbook"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "direct_settlement_allocations" ADD CONSTRAINT "direct_settlement_allocations_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "direct_settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "direct_settlement_allocations" ADD CONSTRAINT "direct_settlement_allocations_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;


DO $$ BEGIN ALTER TABLE direct_settlements ADD CONSTRAINT direct_settlement_amount_valid CHECK (amount > 0 AND opening_applied >= 0 AND opening_applied <= amount AND customer_entry_id <> supplier_entry_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE direct_settlements ADD CONSTRAINT direct_settlement_reversal_valid CHECK ((reversed_at IS NULL AND customer_reversal_id IS NULL AND supplier_reversal_id IS NULL) OR (reversed_at IS NOT NULL AND customer_reversal_id IS NOT NULL AND supplier_reversal_id IS NOT NULL AND length(trim(reversal_reason)) > 0)); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE direct_settlement_allocations ADD CONSTRAINT direct_allocation_amount_valid CHECK (amount > 0); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMIT;
