-- Currencies become per-company data instead of a fixed enum (LAK/THB/USD).
-- Columns keep the ISO 4217 code as text; the enum type is dropped first because a
-- table named "Currency" creates a composite type with the same name.
ALTER TABLE "ExchangeRate" ALTER COLUMN "currency" TYPE VARCHAR(3) USING "currency"::text;

ALTER TABLE "Product" ALTER COLUMN "priceCurrency" DROP DEFAULT,
ALTER COLUMN "priceCurrency" TYPE VARCHAR(3) USING "priceCurrency"::text,
ALTER COLUMN "priceCurrency" SET DEFAULT 'LAK',
ALTER COLUMN "costCurrency" DROP DEFAULT,
ALTER COLUMN "costCurrency" TYPE VARCHAR(3) USING "costCurrency"::text,
ALTER COLUMN "costCurrency" SET DEFAULT 'LAK';

ALTER TABLE "StockDocument" ALTER COLUMN "currency" DROP DEFAULT,
ALTER COLUMN "currency" TYPE VARCHAR(3) USING "currency"::text,
ALTER COLUMN "currency" SET DEFAULT 'LAK';

ALTER TABLE "Payment" ALTER COLUMN "currency" TYPE VARCHAR(3) USING "currency"::text;
ALTER TABLE "DebtPayment" ALTER COLUMN "currency" TYPE VARCHAR(3) USING "currency"::text;
ALTER TABLE "CashMovement" ALTER COLUMN "currency" TYPE VARCHAR(3) USING "currency"::text;
ALTER TABLE "Expense" ALTER COLUMN "currency" TYPE VARCHAR(3) USING "currency"::text;

DROP TYPE "Currency";

CREATE TABLE "Currency" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text, true),
    "code" VARCHAR(3) NOT NULL,
    "name" TEXT NOT NULL,
    "nameI18n" JSONB,
    "symbol" TEXT NOT NULL DEFAULT '',
    "decimals" INTEGER NOT NULL DEFAULT 2,
    "cashRounding" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "isBase" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Currency_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Currency_tenantId_idx" ON "Currency"("tenantId");
CREATE UNIQUE INDEX "Currency_tenantId_code_key" ON "Currency"("tenantId", "code");
ALTER TABLE "Currency" ADD CONSTRAINT "Currency_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Back-fill: every existing company gets the three currencies it could use before.
INSERT INTO "Currency" ("id", "tenantId", "code", "name", "nameI18n", "symbol", "decimals", "isBase", "sortOrder", "updatedAt")
SELECT gen_random_uuid()::text, t."id", c.code, c.name, c.i18n::jsonb, c.symbol, c.decimals, c.is_base, c.sort, CURRENT_TIMESTAMP
FROM "Tenant" t
CROSS JOIN (VALUES
    ('LAK', 'Lao kip', '{"lo":"ກີບ","th":"กีบ","en":"Lao kip"}', '₭', 0, true, 0),
    ('THB', 'Thai baht', '{"lo":"ບາດ","th":"บาท","en":"Thai baht"}', '฿', 2, false, 1),
    ('USD', 'US dollar', '{"lo":"ໂດລາ","th":"ดอลลาร์สหรัฐ","en":"US dollar"}', '$', 2, false, 2)
) AS c(code, name, i18n, symbol, decimals, is_base, sort);
