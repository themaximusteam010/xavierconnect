-- CreateEnum
CREATE TYPE "ProviderMode" AS ENUM ('SANDBOX', 'LIVE');

-- CreateEnum
CREATE TYPE "ProviderApproval" AS ENUM ('NOT_REQUIRED', 'NOT_STARTED', 'APPLIED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "BeneficiaryStatus" AS ENUM ('PENDING_VERIFICATION', 'VERIFIED', 'REJECTED', 'DISABLED');

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "feesMinor" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PaymentEvent" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "deadLetteredAt" TIMESTAMP(3),
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'PAYMENT',
ADD COLUMN     "nextRetryAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Payout" ADD COLUMN     "beneficiaryId" TEXT,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'NGN',
ADD COLUMN     "fxRate" DECIMAL(24,12),
ADD COLUMN     "initiatedAt" TIMESTAMP(3),
ADD COLUMN     "method" TEXT NOT NULL DEFAULT 'LOCAL',
ADD COLUMN     "providerFeeMinor" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "providerKey" TEXT,
ADD COLUMN     "settlementAmountMinor" BIGINT,
ADD COLUMN     "settlementCurrency" TEXT;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "mfaVerifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN     "costCurrency" TEXT,
ADD COLUMN     "costMinor" BIGINT,
ADD COLUMN     "destinationCountry" TEXT,
ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "international" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "labelUrl" TEXT,
ADD COLUMN     "lastEventAt" TIMESTAMP(3),
ADD COLUMN     "originCountry" TEXT,
ADD COLUMN     "providerKey" TEXT,
ADD COLUMN     "providerShipmentId" TEXT,
ADD COLUMN     "service" TEXT,
ADD COLUMN     "trackingUrl" TEXT,
ADD COLUMN     "weightGrams" INTEGER;

-- AlterTable
ALTER TABLE "ShipmentEvent" ADD COLUMN     "providerEventId" TEXT;

-- AlterTable
ALTER TABLE "ShippingMethod" ADD COLUMN     "destinationCountries" TEXT[];

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mfaRecoveryCodes" TEXT[];

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "handlingDays" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "internationalShipping" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "payoutCurrency" TEXT NOT NULL DEFAULT 'NGN',
ADD COLUMN     "region" TEXT;

-- AlterTable
ALTER TABLE "VendorOrder" ADD COLUMN     "deliveryEvidence" TEXT,
ADD COLUMN     "processingFeeMinor" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "settlementCurrency" TEXT NOT NULL DEFAULT 'NGN';

-- CreateTable
CREATE TABLE "IntegrationProvider" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "mode" "ProviderMode" NOT NULL DEFAULT 'SANDBOX',
    "approval" "ProviderApproval" NOT NULL DEFAULT 'NOT_STARTED',
    "countries" TEXT[],
    "currencies" TEXT[],
    "methods" TEXT[],
    "credentialsEnc" TEXT,
    "credentialHint" TEXT,
    "webhookSecretEnc" TEXT,
    "feeBps" INTEGER NOT NULL DEFAULT 0,
    "feeFixedMinor" BIGINT NOT NULL DEFAULT 0,
    "notes" TEXT,
    "lastCheckAt" TIMESTAMP(3),
    "lastCheckOk" BOOLEAN,
    "lastCheckMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutCorridor" (
    "id" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DISABLED',
    "complianceApproved" BOOLEAN NOT NULL DEFAULT false,
    "complianceNote" TEXT,
    "minPayoutMinor" BIGINT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutCorridor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Beneficiary" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "routingType" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "bankCode" TEXT,
    "branch" TEXT,
    "accountHolderName" TEXT NOT NULL,
    "verifiedName" TEXT,
    "accountLast4" TEXT NOT NULL,
    "detailsEnc" TEXT,
    "providerRecipientRef" TEXT,
    "status" "BeneficiaryStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "failureReason" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Beneficiary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FxQuote" (
    "id" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "sourceCurrency" TEXT NOT NULL,
    "targetCurrency" TEXT NOT NULL,
    "sourceAmountMinor" BIGINT NOT NULL,
    "targetAmountMinor" BIGINT NOT NULL,
    "rate" DECIMAL(24,12) NOT NULL,
    "feeMinor" BIGINT NOT NULL DEFAULT 0,
    "providerQuoteRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "payoutId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FxQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutEvent" (
    "id" TEXT NOT NULL,
    "payoutId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayoutEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationLog" (
    "id" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "httpStatus" INTEGER,
    "durationMs" INTEGER,
    "reference" TEXT,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAlert" (
    "id" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "link" TEXT,
    "count" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,

    CONSTRAINT "AdminAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationRecord" (
    "id" TEXT NOT NULL,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "providerKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "internalAmountMinor" BIGINT,
    "providerAmountMinor" BIGINT,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "detail" TEXT,

    CONSTRAINT "ReconciliationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PickupAddress" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "city" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "postalCode" TEXT,
    "country" TEXT NOT NULL,
    "providerAddressCodes" JSONB,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PickupAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingQuote" (
    "id" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "vendorOrderId" TEXT,
    "providerRequestRef" TEXT,
    "courierId" TEXT,
    "serviceCode" TEXT NOT NULL,
    "courierName" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "etaText" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShippingQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomsDeclaration" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "contents" TEXT NOT NULL,
    "declaredValueMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "originCountry" TEXT NOT NULL,
    "hsCodes" TEXT[],
    "incoterm" TEXT NOT NULL,
    "insured" BOOLEAN NOT NULL DEFAULT false,
    "items" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomsDeclaration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationProvider_key_key" ON "IntegrationProvider"("key");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutCorridor_country_currency_providerKey_key" ON "PayoutCorridor"("country", "currency", "providerKey");

-- CreateIndex
CREATE INDEX "Beneficiary_vendorId_status_idx" ON "Beneficiary"("vendorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FxQuote_payoutId_key" ON "FxQuote"("payoutId");

-- CreateIndex
CREATE INDEX "PayoutEvent_payoutId_idx" ON "PayoutEvent"("payoutId");

-- CreateIndex
CREATE INDEX "IntegrationLog_providerKey_createdAt_idx" ON "IntegrationLog"("providerKey", "createdAt");

-- CreateIndex
CREATE INDEX "IntegrationLog_status_createdAt_idx" ON "IntegrationLog"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdminAlert_dedupeKey_key" ON "AdminAlert"("dedupeKey");

-- CreateIndex
CREATE INDEX "AdminAlert_resolvedAt_severity_idx" ON "AdminAlert"("resolvedAt", "severity");

-- CreateIndex
CREATE INDEX "ReconciliationRecord_runAt_idx" ON "ReconciliationRecord"("runAt");

-- CreateIndex
CREATE INDEX "ReconciliationRecord_status_idx" ON "ReconciliationRecord"("status");

-- CreateIndex
CREATE INDEX "PickupAddress_vendorId_idx" ON "PickupAddress"("vendorId");

-- CreateIndex
CREATE INDEX "ShippingQuote_vendorOrderId_idx" ON "ShippingQuote"("vendorOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomsDeclaration_shipmentId_key" ON "CustomsDeclaration"("shipmentId");

-- CreateIndex
CREATE UNIQUE INDEX "ShipmentEvent_providerEventId_key" ON "ShipmentEvent"("providerEventId");

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_beneficiaryId_fkey" FOREIGN KEY ("beneficiaryId") REFERENCES "Beneficiary"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Beneficiary" ADD CONSTRAINT "Beneficiary_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FxQuote" ADD CONSTRAINT "FxQuote_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutEvent" ADD CONSTRAINT "PayoutEvent_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickupAddress" ADD CONSTRAINT "PickupAddress_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomsDeclaration" ADD CONSTRAINT "CustomsDeclaration_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─── Hand-written: carry existing NG payout accounts into the beneficiary model (no data removed) ───
INSERT INTO "Beneficiary" ("id","vendorId","providerKey","country","currency","routingType","bankName","bankCode",
  "accountHolderName","verifiedName","accountLast4","providerRecipientRef","status","isDefault","verifiedAt","createdAt","updatedAt")
SELECT 'ben_' || pa."id", pa."vendorId",
       CASE WHEN pa."providerRecipientCode" = 'sandbox' THEN 'sandbox-payouts' ELSE 'manual' END,
       'NG', 'NGN', 'NUBAN', pa."bankName", pa."bankCode", pa."accountName", pa."accountName", pa."accountNumberLast4",
       pa."providerRecipientCode", CASE WHEN pa."verifiedAt" IS NOT NULL THEN 'VERIFIED'::"BeneficiaryStatus" ELSE 'PENDING_VERIFICATION'::"BeneficiaryStatus" END,
       true, pa."verifiedAt", pa."createdAt", now()
FROM "PayoutAccount" pa
WHERE NOT EXISTS (SELECT 1 FROM "Beneficiary" b WHERE b."id" = 'ben_' || pa."id");

-- A payout can only be PAID with a provider/bank reference.
ALTER TABLE "Payout" ADD CONSTRAINT payout_paid_needs_reference CHECK ("status" <> 'PAID' OR "providerRef" IS NOT NULL);

-- On Supabase, keep the Data API (anon/authenticated) locked out of new tables. No-op elsewhere.
DO $$
DECLARE t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    FOREACH t IN ARRAY ARRAY['IntegrationProvider','PayoutCorridor','Beneficiary','FxQuote','PayoutEvent','IntegrationLog','AdminAlert','ReconciliationRecord','PickupAddress','ShippingQuote','CustomsDeclaration'] LOOP
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    END LOOP;
  END IF;
END $$;
