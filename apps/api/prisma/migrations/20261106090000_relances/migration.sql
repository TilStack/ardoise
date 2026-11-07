-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('WHATSAPP', 'SMS');

-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('SCHEDULED', 'SENDING', 'SENT', 'FAILED', 'SKIPPED', 'CANCELLED');

-- AlterTable
ALTER TABLE "merchants" ADD COLUMN     "reminder_channel" "Channel" NOT NULL DEFAULT 'WHATSAPP',
ADD COLUMN     "reminder_send_hour" INTEGER NOT NULL DEFAULT 9,
ADD COLUMN     "reminder_template" TEXT,
ADD COLUMN     "reminders_enabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "reminders" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "cycle_start" TIMESTAMP(3) NOT NULL,
    "step" INTEGER NOT NULL,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "channel" "Channel" NOT NULL,
    "status" "ReminderStatus" NOT NULL DEFAULT 'SCHEDULED',
    "sent_channel" "Channel",
    "amount" INTEGER,
    "message" TEXT,
    "payment_link_id" UUID,
    "provider_ref" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reminders_status_scheduled_at_idx" ON "reminders"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "reminders_merchant_id_status_idx" ON "reminders"("merchant_id", "status");

-- CreateIndex
CREATE INDEX "reminders_customer_id_sent_at_idx" ON "reminders"("customer_id", "sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "reminders_customer_id_cycle_start_step_key" ON "reminders"("customer_id", "cycle_start", "step");

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_payment_link_id_fkey" FOREIGN KEY ("payment_link_id") REFERENCES "payment_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;

