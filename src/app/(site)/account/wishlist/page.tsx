import { Heart } from "lucide-react";
import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { productCardInclude } from "@/server/services/catalog";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/feedback";
import { ProductGrid } from "@/components/commerce/product-card";
import { ButtonLink } from "@/components/ui/button";

export const metadata = { title: "Wishlist" };

export default async function Wishlist() {
  const u = await requireUser("/account/wishlist");
  const items = await db.wishlistItem.findMany({ where: { userId: u.id, product: { status: "PUBLISHED", deletedAt: null } }, orderBy: { createdAt: "desc" }, include: { product: { include: productCardInclude } } });
  return (
    <>
      <PageHeader title="Wishlist" />
      {items.length === 0 ? <EmptyState icon={Heart} title="Nothing saved yet" action={<ButtonLink href="/shop" variant="secondary">Browse products</ButtonLink>}>Tap “Save to wishlist” on any product to keep it here.</EmptyState> : <ProductGrid products={items.map((i) => i.product)} />}
    </>
  );
}
