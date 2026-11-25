# Database design

Source of truth: `prisma/schema.prisma` (≈60 models). Migrations in `prisma/migrations/`. The init migration
appends hand-written SQL: ledger immutability triggers, balance constraint trigger, non-negative stock checks,
rating range check, positive payout check, and sequences for order (XC-10001…), ticket (T-1001…) and booking
(B-5001…) numbers.

## Domains
| Domain | Models |
|---|---|
| Identity | User, Role, Permission, RolePermission, UserRole (vendor-scoped via vendorId), Session (hashed token), VerificationToken (hashed), Address |
| Vendors | Vendor (status, verification level, onboarding step), VendorDocument (private key), Store (unique slug), StoreFollow, PayoutAccount (last 4 digits only), VendorSubscription, SubscriptionPlan |
| Catalogue | Category (tree, kind PRODUCT/SERVICE/DIGITAL), Product, ProductImage, ProductVariant, ProductQuestion, DigitalAsset, InventoryReservation |
| Services | Service, ServicePackage (unique per tier), ServiceAvailability (weekday + minutes, Lagos), Booking |
| Commerce | Cart (user or guest token), CartItem (unique cart+product+variantKey), Order, VendorOrder, VendorOrderEvent, OrderItem (price/commission snapshots), Coupon, WishlistItem |
| Payments & finance | Payment (unique reference), PaymentEvent (unique provider+eventKey → webhook idempotency), Refund (unique idempotencyKey), CommissionRule, LedgerAccount, LedgerTransaction (unique idempotencyKey), LedgerEntry, Payout (unique idempotencyKey) |
| Fulfilment | ShippingMethod (FLAT/WEIGHT/PICKUP, state list, free-over), Shipment (delivery partner, proof), ShipmentEvent, DownloadGrant |
| Engagement | Review (one per order item), ReviewVote, Conversation, Message, Notification, NotificationPreference, EmailOutbox |
| Trust & support | SupportTicket, TicketMessage (internal notes), Dispute, DisputeEvidence, Report, AuditLog |
| CMS | HomepageSection, Banner, CmsPage, BlogPost, Faq, PlatformSetting, NewsletterSubscriber, AnalyticsEvent |

## Conventions
- Money: `BigInt` minor units. Percentages: integer basis points (`rateBps`, 1000 = 10%).
- `createdAt` everywhere; `updatedAt` on mutable rows; `deletedAt` soft-delete on User, Product, Service.
- Snapshots: OrderItem stores name, SKU, unit price and commission at purchase time; Order stores the shipping address as JSON.
- Indexes on every foreign key used for listing, on status columns used by queues, and on `(vendorId, status)`.
- Ratings/sales/view counts on Product/Store are display caches recomputed from source rows.

## Not yet used by the UI
Conversation/Message (buyer–vendor messaging), Dispute/DisputeEvidence, ReviewVote, ProductQuestion submission,
VendorSubscription billing, BlogPost authoring — the tables exist so these can ship without schema churn.
