-- PaymentWebhookEvent: claim row is inserted in the same transaction as the
-- side effects, so processed_at must be nullable for in-flight/failed claims.
ALTER TABLE "PaymentWebhookEvent" ADD COLUMN "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "PaymentWebhookEvent" ALTER COLUMN "processed_at" DROP NOT NULL;
ALTER TABLE "PaymentWebhookEvent" ALTER COLUMN "processed_at" DROP DEFAULT;

CREATE INDEX "PaymentWebhookEvent_processed_at_received_at_idx" ON "PaymentWebhookEvent"("processed_at", "received_at");

-- AuthSession: refresh-token families for rotation reuse detection
ALTER TABLE "AuthSession" ADD COLUMN "family_id" UUID;
UPDATE "AuthSession" SET "family_id" = "id" WHERE "family_id" IS NULL;
ALTER TABLE "AuthSession" ALTER COLUMN "family_id" SET NOT NULL;

CREATE INDEX "AuthSession_family_id_revoked_at_idx" ON "AuthSession"("family_id", "revoked_at");

-- Notification: dedupe key so retried jobs cannot duplicate user-visible effects
ALTER TABLE "Notification" ADD COLUMN "dedupe_key" TEXT;
CREATE UNIQUE INDEX "Notification_dedupe_key_key" ON "Notification"("dedupe_key");

-- EmailDelivery: claim table making transactional email sends idempotent
CREATE TABLE "EmailDelivery" (
    "id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "claimed_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailDelivery_idempotency_key_key" ON "EmailDelivery"("idempotency_key");
CREATE INDEX "EmailDelivery_claimed_at_created_at_idx" ON "EmailDelivery"("claimed_at", "created_at");
