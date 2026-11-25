import { Download, FileDown } from "lucide-react";
import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/feedback";

export const metadata = { title: "Downloads" };

export default async function Downloads() {
  const u = await requireUser("/account/downloads");
  const grants = await db.downloadGrant.findMany({ where: { userId: u.id }, orderBy: { createdAt: "desc" }, include: { asset: { include: { product: { select: { name: true } } } } } });
  const now = new Date();
  return (
    <>
      <PageHeader title="Downloads" description="Files from digital products you have bought. Links are personal — please do not share them." />
      {grants.length === 0 ? <EmptyState icon={FileDown} title="No downloads yet">Digital products appear here as soon as payment is confirmed.</EmptyState> : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {grants.map((g) => {
            const expired = g.expiresAt < now;
            const left = g.maxDownloads - g.downloadsUsed;
            const usable = !g.revokedAt && !expired && left > 0;
            return (
              <li key={g.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 text-sm">
                <div>
                  <p className="font-medium">{g.asset.product.name}</p>
                  <p className="text-[13px] text-ink-muted">{g.asset.fileName} · v{g.asset.version} · {(g.asset.sizeBytes / 1_048_576).toFixed(1)} MB</p>
                  <p className="text-[12px] text-ink-muted">{g.revokedAt ? "Access revoked after refund" : expired ? "Link expired — contact support to restore" : `${left} of ${g.maxDownloads} downloads left · until ${g.expiresAt.toLocaleDateString("en-NG", { dateStyle: "medium" })}`}</p>
                </div>
                {usable && <a href={`/download/${g.id}`} className="inline-flex h-9 items-center gap-2 rounded-md bg-brand px-3 text-[13px] font-medium text-white hover:bg-brand-hover"><Download className="size-4" />Download</a>}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
