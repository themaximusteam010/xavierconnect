import { db } from "@/server/db";
import { guard } from "@/server/auth/admin-guard";
import { moderateReviewAction } from "@/app/actions/admin-ops";
import { FilterBar, qs } from "@/components/admin/filters";
import { PageHeader } from "@/components/ui/page-header";
import { FlashFromQuery, StatusBadge, Badge } from "@/components/ui/feedback";
import { SubmitButton } from "@/components/ui/submit-button";
import { Pagination } from "@/components/ui/pagination";
import type { Prisma } from "@prisma/client";

export const metadata = { title: "Reviews" };

export default async function Reviews({ searchParams }: { searchParams: Promise<{ status?: string; rating?: string; verified?: string; q?: string; page?: string; ok?: string; error?: string }> }) {
  await guard("listing.moderate");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const where: Prisma.ReviewWhereInput = {
    ...(sp.status ? { status: sp.status as never } : {}),
    ...(sp.rating ? { rating: Number(sp.rating) } : {}),
    ...(sp.verified ? { verified: sp.verified === "1" } : {}),
    ...(sp.q ? { OR: [{ body: { contains: sp.q, mode: "insensitive" } }, { vendor: { businessName: { contains: sp.q, mode: "insensitive" } } }] } : {}),
  };
  const [rows, total, reported] = await Promise.all([
    db.review.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * 30, take: 30, include: { user: { select: { name: true } }, vendor: { select: { businessName: true } }, product: { select: { name: true, slug: true } }, service: { select: { title: true, slug: true } } } }),
    db.review.count({ where }),
    db.report.findMany({ where: { targetType: "REVIEW", status: "OPEN" }, select: { targetId: true } }),
  ]);
  const flagged = new Set(reported.map((r) => r.targetId));
  return (
    <>
      <PageHeader title="Reviews" description="Only customers with a paid order can review. Hiding a review removes it from the public rating; reviews are never edited by staff." />
      <FlashFromQuery ok={sp.ok} error={sp.error} />
      <FilterBar action="/admin/reviews" values={sp} fields={[
        { type: "search", name: "q", placeholder: "Text or vendor" },
        { type: "select", name: "status", label: "Status", options: [["PUBLISHED", "Published"], ["HIDDEN", "Hidden"], ["FLAGGED", "Flagged"]] },
        { type: "select", name: "rating", label: "Rating", options: [["1", "1 star"], ["2", "2 stars"], ["3", "3 stars"], ["4", "4 stars"], ["5", "5 stars"]] },
        { type: "select", name: "verified", label: "Purchase", options: [["1", "Verified purchase"], ["0", "Unverified"]] },
      ]} />
      <ul className="space-y-3">
        {rows.length === 0 && <li className="rounded-lg border border-line bg-white p-8 text-center text-sm text-ink-muted">No reviews match.</li>}
        {rows.map((r) => (
          <li key={r.id} className="rounded-lg border border-line bg-white p-4 text-[13px]">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="font-medium">{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</span>
              <StatusBadge status={r.status} />{r.verified && <Badge tone="success">verified purchase</Badge>}{flagged.has(r.id) && <Badge tone="warning">reported</Badge>}
              <span className="text-ink-muted">{r.user.name} on {r.product ? <a href={`/p/${r.product.slug}`} className="text-brand">{r.product.name}</a> : r.service ? <a href={`/services/${r.service.slug}`} className="text-brand">{r.service.title}</a> : "—"} · {r.vendor.businessName} · {r.createdAt.toLocaleDateString("en-NG", { dateStyle: "medium" })}</span>
            </div>
            {r.title && <p className="font-medium">{r.title}</p>}
            <p className="whitespace-pre-line text-ink-2">{r.body}</p>
            {r.vendorResponse && <p className="mt-2 border-l-2 border-line pl-3 text-ink-muted">Seller: {r.vendorResponse}</p>}
            <form action={moderateReviewAction} className="mt-2"><input type="hidden" name="id" value={r.id} />
              {r.status === "PUBLISHED" ? <SubmitButton name="status" value="HIDDEN" size="sm" variant="secondary">Hide</SubmitButton> : <SubmitButton name="status" value="PUBLISHED" size="sm" variant="secondary">Publish</SubmitButton>}
            </form>
          </li>
        ))}
      </ul>
      <Pagination page={page} pages={Math.ceil(total / 30)} href={(n) => qs("/admin/reviews", { ...sp, page: n, ok: undefined, error: undefined })} />
    </>
  );
}
