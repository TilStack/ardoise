-- CreateEnum
CREATE TYPE "Operator" AS ENUM ('MTN', 'ORANGE');

-- CreateEnum
CREATE TYPE "EntryType" AS ENUM ('DEBT', 'CASH_REPAYMENT', 'MOBILE_PAYMENT', 'REVERSAL');

-- CreateEnum
CREATE TYPE "Direction" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "TxStatus" AS ENUM ('CREATED', 'PENDING', 'SUCCESS', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ProviderEventKind" AS ENUM ('INITIATE', 'WEBHOOK', 'STATUS_POLL');

-- CreateTable
CREATE TABLE "merchants" (
    "id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "shop_name" TEXT,
    "plan" TEXT NOT NULL DEFAULT 'FREE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_challenges" (
    "id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "client_uuid" UUID,
    "merchant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "operator" "Operator",
    "consent_reminders" BOOLEAN NOT NULL DEFAULT true,
    "credit_limit" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "client_uuid" UUID,
    "merchant_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "type" "EntryType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "label" TEXT,
    "reverses_id" UUID,
    "transaction_id" UUID,
    "created_by" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_lines" (
    "id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "account" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "direction" "Direction" NOT NULL,

    CONSTRAINT "ledger_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_links" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "merchant_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "payment_link_id" UUID,
    "provider" TEXT NOT NULL,
    "provider_ref" TEXT,
    "amount" INTEGER NOT NULL,
    "confirmed_amount" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'XAF',
    "phone" TEXT NOT NULL,
    "operator" "Operator" NOT NULL,
    "status" "TxStatus" NOT NULL DEFAULT 'CREATED',
    "failure_reason" TEXT,
    "review_required" BOOLEAN NOT NULL DEFAULT false,
    "last_polled_at" TIMESTAMP(3),
    "finalized_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_events" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "kind" "ProviderEventKind" NOT NULL,
    "provider_ref" TEXT,
    "transaction_id" UUID,
    "signature_ok" BOOLEAN,
    "payload" JSONB NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "entry_id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "merchants_phone_key" ON "merchants"("phone");

-- CreateIndex
CREATE INDEX "otp_challenges_phone_created_at_idx" ON "otp_challenges"("phone", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "customers_client_uuid_key" ON "customers"("client_uuid");

-- CreateIndex
CREATE UNIQUE INDEX "customers_merchant_id_phone_key" ON "customers"("merchant_id", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_client_uuid_key" ON "ledger_entries"("client_uuid");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_reverses_id_key" ON "ledger_entries"("reverses_id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_transaction_id_key" ON "ledger_entries"("transaction_id");

-- CreateIndex
CREATE INDEX "ledger_entries_customer_id_occurred_at_idx" ON "ledger_entries"("customer_id", "occurred_at");

-- CreateIndex
CREATE INDEX "ledger_entries_merchant_id_occurred_at_idx" ON "ledger_entries"("merchant_id", "occurred_at");

-- CreateIndex
CREATE INDEX "ledger_lines_account_idx" ON "ledger_lines"("account");

-- CreateIndex
CREATE UNIQUE INDEX "payment_links_token_hash_key" ON "payment_links"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_reference_key" ON "transactions"("reference");

-- CreateIndex
CREATE INDEX "transactions_status_created_at_idx" ON "transactions"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_provider_provider_ref_key" ON "transactions"("provider", "provider_ref");

-- CreateIndex
CREATE INDEX "provider_events_provider_ref_idx" ON "provider_events"("provider_ref");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_number_key" ON "receipts"("number");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_entry_id_key" ON "receipts"("entry_id");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_reverses_id_fkey" FOREIGN KEY ("reverses_id") REFERENCES "ledger_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_lines" ADD CONSTRAINT "ledger_lines_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_payment_link_id_fkey" FOREIGN KEY ("payment_link_id") REFERENCES "payment_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_events" ADD CONSTRAINT "provider_events_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
