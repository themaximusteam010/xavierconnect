import { db } from "@/server/db";
import { requireVendor } from "@/server/auth/session";
import { vendorAccountCode } from "@/server/domain/ledger";
import { resolveRange } from "@/components/admin/date-range";
import { FilterBar, qs } from "@/components/admin/filters";
import { PageHeader } from "@/components/ui/page-header";
import { ButtonLink } from "@/components/ui/button";
import { Table, Td, Th } from "@/components/ui/table";
import { Pagination } from "@/components/ui/pagination";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Transactions" };

export default async function Transactions({ searchParams }: { searchParams: Promise<{ range?: string; from?: string; to?: string; bucket?: string; page?: string }> }) {
  const { vendorId } = await requireVendor("finance");
  const sp = await searchParams;
  const r = resolveRange(sp, "90d");
  const page = Math.max(1, Number(sp.page) || 1);
  const bucket = (["pending", "available", "payout_hold"] as const).find((b) => b === sp.bucket);
  const where = { account: bucket ? { code: vendorAccountCode(vendorId, bucket) } : { vendorId }, createdAt: { gte: r.from, lt: r.to } };
  const [entries, total] = await Promise.all([
    db.ledgerEntry.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * 50, take: 50, include: { account: { select: { code: true } }, transaction: { select: { kind: true, reference: true, description: true } } } }),
    db.ledgerEntry.count({ where }),
  ]);
  const label = (code: string) => code.endsWith(":pending") ? "Pending" : code.endsWith(":available") ? "Available" : "Withdrawal hold";
  return (
    <>
      <PageHeader title="Transactions" description={`${r.label} · every movement in your XavierConnect balance. Entries are never edited; corrections appear as new entries.`} actions={<ButtonLink variant="secondary" href={qs("/vendor-export/statement", { range: sp.range ?? "90d", from: sp.from, to: sp.to })}>Download statement (CSV)</ButtonLink>} />
      <FilterBar action="/vendor/transactions" values={sp} fields={[{ type: "select", name: "bucket", label: "Balance", options: [["pending", "Pending"], ["available", "Available"], ["payout_hold", "Withdrawal hold"]] }, { type: "range" }]} />
      <Table>
        <thead><tr><Th>Date</Th><Th>Type</Th><Th>Description</Th><Th>Reference</Th><Th>Balance</Th><Th className="text-right">Amount</Th></tr></thead>
        <tbody>
          {entries.length === 0 && <tr><Td colSpan={6} className="py-8 text-center text-ink-muted">No transactions in this period.</Td></tr>}
          {entries.map((e) => (
            <tr key={e.id}>
              <Td className="whitespace-nowrap">{e.createdAt.toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}</Td>
              <Td className="text-[12px]">{e.transaction.kind.toLowerCase().replace(/_/g, " ")}</Td>
              <Td>{e.transaction.description}</Td>
              <Td className="font-mono text-[12px]">{e.transaction.reference}</Td>
              <Td>{label(e.account.code)}</Td>
              <Td className={`tabular text-right ${e.creditMinor > 0n ? "text-success" : ""}`}>{e.creditMinor > 0n ? `+${formatMoney(e.creditMinor)}` : `−${formatMoney(e.debitMinor)}`}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Pagination page={page} pages={Math.ceil(total / 50)} href={(n) => qs("/vendor/transactions", { ...sp, page: n })} />
    </>
  );
}
