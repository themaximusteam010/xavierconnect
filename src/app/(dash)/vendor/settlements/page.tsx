import Link from "next/link";
import { db } from "@/server/db";
import { requireVendor } from "@/server/auth/session";
import { STRONG_EVIDENCE } from "@/server/services/finance";
import { getSetting } from "@/server/services/settings";
import { PageHeader } from "@/components/ui/page-header";
import { Badge, StatusBadge } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/table";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Settlements" };

const EVIDENCE: Record<string, string> = { CARRIER: "carrier delivery scan", RIDER_POD: "rider proof of delivery", CUSTOMER_CONFIRMED: "buyer confirmed receipt", DIGITAL: "digital delivery", SERVICE_COMPLETED: "service completed", ADMIN: "confirmed by XavierConnect", VENDOR_CLAIM: "marked delivered by you" };

export default async function Settlements({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const { vendorId } = await requireVendor("finance");
  const sp = await searchParams;
  const settled = sp.show === "settled";
  const [rows, hold, claimHold] = await Promise.all([
    db.vendorOrder.findMany({
      where: { vendorId, ...(settled ? { settledAt: { not: null } } : { settledAt: null, status: { notIn: ["AWAITING_PAYMENT", "CANCELLED", "REFUNDED"] } }) },
      orderBy: settled ? { settledAt: "desc" } : { createdAt: "asc" }, take: 200,
      include: { disputes: { select: { status: true } } },
    }),
    getSetting(db, "settlementHoldDays"),
    getSetting(db, "vendorClaimHoldDays"),
  ]);
  const eta = (vo: (typeof rows)[number]) => {
    if (vo.disputes.some((d) => ["OPEN", "AWAITING_VENDOR", "UNDER_REVIEW"].includes(d.status))) return <Badge tone="danger">On hold — open dispute</Badge>;
    if (vo.status !== "DELIVERED" || !vo.deliveredAt) return <span className="text-ink-muted">After delivery is confirmed</span>;
    const strong = vo.deliveryEvidence && (STRONG_EVIDENCE as readonly string[]).includes(vo.deliveryEvidence);
    const days = strong ? hold : Math.max(hold, claimHold);
    const at = new Date(vo.deliveredAt.getTime() + days * 864e5);
    return <span>{at <= new Date() ? "Next settlement run" : at.toLocaleDateString("en-NG", { dateStyle: "medium" })}<span className="block text-[11px] text-ink-muted">{days}-day hold</span></span>;
  };
  return (
    <>
      <PageHeader title="Settlements" description={`Earnings move from pending to available ${hold} days after independent delivery evidence (carrier scan, rider proof, buyer confirmation, digital delivery or service completion), or ${Math.max(hold, claimHold)} days when the only evidence is your own “delivered” update. An open dispute pauses settlement.`} />
      <nav className="mb-4 flex gap-1 border-b border-line text-sm">{[["", "Upcoming"], ["settled", "Settled"]].map(([k, l]) => <Link key={k} href={k ? `/vendor/settlements?show=${k}` : "/vendor/settlements"} className={`-mb-px border-b-2 px-3 py-2 ${(sp.show ?? "") === k ? "border-ink font-medium" : "border-transparent text-ink-muted"}`}>{l}</Link>)}</nav>
      <Table>
        <thead><tr><Th>Order</Th><Th>Status</Th><Th>Delivery evidence</Th><Th className="text-right">Order total</Th><Th className="text-right">Commission</Th><Th className="text-right">Your earnings</Th><Th>{settled ? "Settled" : "Expected"}</Th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><Td colSpan={7} className="py-8 text-center text-ink-muted">{settled ? "Nothing settled yet." : "No earnings waiting."}</Td></tr>}
          {rows.map((vo) => (
            <tr key={vo.id}>
              <Td><Link href={`/vendor/orders/${vo.id}`} className="font-medium hover:text-brand">{vo.number}</Link></Td>
              <Td><StatusBadge status={vo.status} /></Td>
              <Td className="text-[12px]">{vo.deliveryEvidence ? EVIDENCE[vo.deliveryEvidence] ?? vo.deliveryEvidence : "—"}</Td>
              <Td className="tabular text-right">{formatMoney(vo.totalMinor)}</Td>
              <Td className="tabular text-right">−{formatMoney(vo.commissionMinor)}</Td>
              <Td className="tabular text-right font-medium">{formatMoney(vo.vendorNetMinor)}</Td>
              <Td>{settled ? vo.settledAt!.toLocaleDateString("en-NG", { dateStyle: "medium" }) : eta(vo)}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
