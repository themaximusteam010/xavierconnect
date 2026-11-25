/**
 * Role & permission catalogue. This file is the source of truth; `prisma/seed.ts` syncs it
 * into the Role / Permission / RolePermission tables so admins can inspect them.
 *
 * Platform permissions are global. Vendor-scoped access (VENDOR, VENDOR_STAFF, SERVICE_PROVIDER)
 * is granted through a UserRole row carrying vendorId and is checked with `vendorAccess()`.
 */
export const PERMISSIONS = {
  "admin.access": "Open the admin console",
  "user.view": "View users",
  "user.manage": "Edit and suspend users",
  "staff.manage": "Create staff and assign roles",
  "vendor.view": "View vendors and applications",
  "vendor.approve": "Approve, reject and suspend vendors",
  "listing.moderate": "Approve and reject listings",
  "category.manage": "Manage categories",
  "order.view_all": "View all orders",
  "order.manage": "Intervene in orders",
  "finance.view": "View ledger and financial reports",
  "finance.payout.approve": "Approve and mark vendor payouts",
  "finance.refund.approve": "Approve refunds",
  "commission.manage": "Configure commission rules",
  "cms.manage": "Edit homepage, banners, pages and blog",
  "support.view": "View support tickets",
  "support.respond": "Reply to and resolve tickets",
  "dispute.decide": "Decide disputes",
  "audit.view": "View audit log",
  "settings.manage": "Change platform settings",
  "delivery.perform": "Update assigned deliveries",
} as const;

export type Permission = keyof typeof PERMISSIONS;
const ALL = Object.keys(PERMISSIONS) as Permission[];

export const ROLES: Record<string, { name: string; staff: boolean; vendorScoped?: boolean; permissions: Permission[] }> = {
  SUPER_ADMIN: { name: "Super Administrator", staff: true, permissions: ALL },
  MARKETPLACE_ADMIN: {
    name: "Marketplace Administrator",
    staff: true,
    permissions: ALL.filter((p) => p !== "staff.manage" && p !== "settings.manage"),
  },
  MARKETPLACE_MANAGER: {
    name: "Marketplace Manager",
    staff: true,
    permissions: ["admin.access", "vendor.view", "listing.moderate", "category.manage", "order.view_all", "order.manage", "user.view"],
  },
  FINANCE_MANAGER: {
    name: "Finance Manager",
    staff: true,
    permissions: ["admin.access", "finance.view", "finance.payout.approve", "finance.refund.approve", "commission.manage", "order.view_all", "vendor.view", "audit.view"],
  },
  VENDOR_MANAGER: {
    name: "Vendor Manager",
    staff: true,
    permissions: ["admin.access", "vendor.view", "vendor.approve", "listing.moderate", "user.view"],
  },
  SUPPORT_AGENT: {
    name: "Customer Support Agent",
    staff: true,
    permissions: ["admin.access", "support.view", "support.respond", "order.view_all", "user.view", "vendor.view"],
  },
  CONTENT_MANAGER: { name: "Content Manager", staff: true, permissions: ["admin.access", "cms.manage"] },
  CUSTOMER: { name: "Customer", staff: false, permissions: [] },
  VENDOR: { name: "Vendor", staff: false, vendorScoped: true, permissions: [] },
  SERVICE_PROVIDER: { name: "Service Provider", staff: false, vendorScoped: true, permissions: [] },
  VENDOR_STAFF: { name: "Vendor Staff", staff: false, vendorScoped: true, permissions: [] },
  DELIVERY_PARTNER: { name: "Delivery Partner", staff: false, permissions: ["delivery.perform"] },
};

export type RoleKey = keyof typeof ROLES;

/** What a vendor-scoped role may do inside a vendor workspace. */
export const VENDOR_CAPABILITIES = {
  VENDOR: ["catalog", "orders", "finance", "settings", "staff", "services"],
  SERVICE_PROVIDER: ["catalog", "orders", "finance", "settings", "staff", "services"],
  VENDOR_STAFF: ["catalog", "orders", "services"],
} as const;
export type VendorCapability = "catalog" | "orders" | "finance" | "settings" | "staff" | "services";

export interface RoleGrant {
  role: string;
  vendorId: string | null;
}

export function permissionsFor(grants: RoleGrant[]): Set<Permission> {
  const out = new Set<Permission>();
  for (const g of grants) for (const p of ROLES[g.role]?.permissions ?? []) out.add(p);
  return out;
}

export function hasVendorCapability(grants: RoleGrant[], vendorId: string, cap: VendorCapability): boolean {
  return grants.some(
    (g) =>
      g.vendorId === vendorId &&
      (VENDOR_CAPABILITIES[g.role as keyof typeof VENDOR_CAPABILITIES] as readonly string[] | undefined)?.includes(cap),
  );
}
