-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ShipmentStatus" ADD VALUE 'AWAITING_PICKUP';
ALTER TYPE "ShipmentStatus" ADD VALUE 'AT_SORTING_FACILITY';
ALTER TYPE "ShipmentStatus" ADD VALUE 'CUSTOMS_PROCESSING';
ALTER TYPE "ShipmentStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "IntegrationProvider" ADD COLUMN     "category" TEXT,
ADD COLUMN     "isDefault" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "maxWeightGrams" INTEGER,
ADD COLUMN     "minWeightGrams" INTEGER,
ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "zones" TEXT[];

-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "consolidationId" TEXT,
ADD COLUMN     "destinationAddress" JSONB,
ADD COLUMN     "estimatedDeliveryAt" TIMESTAMP(3),
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "lastPolledAt" TIMESTAMP(3),
ADD COLUMN     "leg" TEXT NOT NULL DEFAULT 'DIRECT',
ADD COLUMN     "method" TEXT,
ADD COLUMN     "originAddress" JSONB,
ADD COLUMN     "pickupRef" TEXT,
ADD COLUMN     "pickupScheduledAt" TIMESTAMP(3),
ADD COLUMN     "quoteId" TEXT;

-- AlterTable
ALTER TABLE "ShippingQuote" ADD COLUMN     "addressHash" TEXT,
ADD COLUMN     "cartId" TEXT,
ADD COLUMN     "costMinor" BIGINT,
ADD COLUMN     "etaDaysMax" INTEGER,
ADD COLUMN     "etaDaysMin" INTEGER,
ADD COLUMN     "markupMinor" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "methodType" TEXT,
ADD COLUMN     "restrictions" TEXT,
ADD COLUMN     "trackingAvailable" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "VendorOrder" ADD COLUMN     "shippingCostMinor" BIGINT,
ADD COLUMN     "shippingQuoteId" TEXT;

-- CreateTable
CREATE TABLE "ShippingZone" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "regions" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShippingZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentItem" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "ShipmentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentLabel" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "storageKey" TEXT,
    "url" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShipmentLabel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Warehouse" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "contactName" TEXT,
    "phone" TEXT,
    "partnerKey" TEXT,
    "role" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseReceipt" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "vendorOrderId" TEXT NOT NULL,
    "shipmentId" TEXT,
    "inboundCarrier" TEXT,
    "inboundTracking" TEXT,
    "status" TEXT NOT NULL DEFAULT 'EXPECTED',
    "weightGrams" INTEGER,
    "lengthCm" INTEGER,
    "widthCm" INTEGER,
    "heightCm" INTEGER,
    "pieces" INTEGER NOT NULL DEFAULT 1,
    "receivedAt" TIMESTAMP(3),
    "receivedById" TEXT,
    "exceptionNote" TEXT,
    "consolidationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarehouseReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FreightConsolidation" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "partnerKey" TEXT NOT NULL,
    "originWarehouseId" TEXT NOT NULL,
    "destinationCountry" TEXT NOT NULL DEFAULT 'NG',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "partnerReference" TEXT,
    "quotedCostMinor" BIGINT,
    "quotedCurrency" TEXT,
    "quoteIncludes" TEXT,
    "quoteExcludes" TEXT,
    "etd" TIMESTAMP(3),
    "eta" TIMESTAMP(3),
    "departedAt" TIMESTAMP(3),
    "arrivedAt" TIMESTAMP(3),
    "clearedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FreightConsolidation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FreightEvent" (
    "id" TEXT NOT NULL,
    "consolidationId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT,
    "location" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FreightEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingInvoice" (
    "id" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "shipmentId" TEXT,
    "consolidationId" TEXT,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNPAID',
    "fileKey" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShippingInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingReturn" (
    "id" TEXT NOT NULL,
    "vendorOrderId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "returnShipmentId" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingReturn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShippingZone_country_name_key" ON "ShippingZone"("country", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ShipmentItem_shipmentId_orderItemId_key" ON "ShipmentItem"("shipmentId", "orderItemId");

-- CreateIndex
CREATE INDEX "ShipmentLabel_shipmentId_idx" ON "ShipmentLabel"("shipmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_code_key" ON "Warehouse"("code");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseReceipt_shipmentId_key" ON "WarehouseReceipt"("shipmentId");

-- CreateIndex
CREATE INDEX "WarehouseReceipt_warehouseId_status_idx" ON "WarehouseReceipt"("warehouseId", "status");

-- CreateIndex
CREATE INDEX "WarehouseReceipt_vendorOrderId_idx" ON "WarehouseReceipt"("vendorOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "FreightConsolidation_reference_key" ON "FreightConsolidation"("reference");

-- CreateIndex
CREATE INDEX "FreightConsolidation_status_idx" ON "FreightConsolidation"("status");

-- CreateIndex
CREATE INDEX "FreightEvent_consolidationId_createdAt_idx" ON "FreightEvent"("consolidationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ShippingInvoice_providerKey_invoiceNumber_key" ON "ShippingInvoice"("providerKey", "invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ShippingReturn_returnShipmentId_key" ON "ShippingReturn"("returnShipmentId");

-- CreateIndex
CREATE INDEX "ShippingReturn_status_createdAt_idx" ON "ShippingReturn"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_idempotencyKey_key" ON "Shipment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Shipment_vendorOrderId_idx" ON "Shipment"("vendorOrderId");

-- CreateIndex
CREATE INDEX "Shipment_status_lastEventAt_idx" ON "Shipment"("status", "lastEventAt");

-- CreateIndex
CREATE INDEX "Shipment_providerKey_providerShipmentId_idx" ON "Shipment"("providerKey", "providerShipmentId");

-- CreateIndex
CREATE INDEX "ShippingQuote_cartId_vendorId_idx" ON "ShippingQuote"("cartId", "vendorId");

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_consolidationId_fkey" FOREIGN KEY ("consolidationId") REFERENCES "FreightConsolidation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentItem" ADD CONSTRAINT "ShipmentItem_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentItem" ADD CONSTRAINT "ShipmentItem_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentLabel" ADD CONSTRAINT "ShipmentLabel_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseReceipt" ADD CONSTRAINT "WarehouseReceipt_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseReceipt" ADD CONSTRAINT "WarehouseReceipt_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseReceipt" ADD CONSTRAINT "WarehouseReceipt_consolidationId_fkey" FOREIGN KEY ("consolidationId") REFERENCES "FreightConsolidation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FreightEvent" ADD CONSTRAINT "FreightEvent_consolidationId_fkey" FOREIGN KEY ("consolidationId") REFERENCES "FreightConsolidation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingInvoice" ADD CONSTRAINT "ShippingInvoice_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingInvoice" ADD CONSTRAINT "ShippingInvoice_consolidationId_fkey" FOREIGN KEY ("consolidationId") REFERENCES "FreightConsolidation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingReturn" ADD CONSTRAINT "ShippingReturn_vendorOrderId_fkey" FOREIGN KEY ("vendorOrderId") REFERENCES "VendorOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingReturn" ADD CONSTRAINT "ShippingReturn_returnShipmentId_fkey" FOREIGN KEY ("returnShipmentId") REFERENCES "Shipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Supabase: server-only tables (Prisma). Deny the public API roles, as for every other table.
DO $$
DECLARE t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    FOREACH t IN ARRAY ARRAY['ShippingZone','ShipmentItem','ShipmentLabel','Warehouse','WarehouseReceipt','FreightConsolidation','FreightEvent','ShippingInvoice','ShippingReturn'] LOOP
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('REVOKE ALL ON TABLE %I FROM anon, authenticated', t);
    END LOOP;
  END IF;
END $$;
