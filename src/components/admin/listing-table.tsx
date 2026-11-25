import Link from "next/link";
import { toggleFeaturedAction } from "@/app/actions/admin";
import { StatusBadge, Badge } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/table";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatMoney } from "@/lib/money";

export type ListingRow = { id: string; name: string; href: string; vendor: string; vendorId: string; category: string; status: string; priceMinor: bigint | null; stock?: number | null; sales?: number; rating: number; ratingCount: number; featured: boolean; updatedAt: Date; country?: string };

export function ListingTable({ rows, canFeature, showStock }: { rows: ListingRow[]; canFeature?: boolean; showStock?: boolean }) {
  return (
    <Table>
      <thead><tr><Th>Listing</Th><Th>Vendor</Th><Th>Category</Th><Th className="text-right">Price</Th>{showStock && <Th className="text-right">Stock</Th>}<Th className="text-right">Rating</Th><Th>Status</Th><Th>Updated</Th>{canFeature && <Th />}</tr></thead>
      <tbody>
        {rows.length === 0 && <tr><Td colSpan={9} className="py-8 text-center text-ink-muted">Nothing matches these filters.</Td></tr>}
        {rows.map((r) => (
          <tr key={r.id} className="hover:bg-canvas">
            <Td><a href={r.href} target="_blank" rel="noopener noreferrer" className="font-medium text-ink hover:text-brand">{r.name}</a>{r.featured && <Badge tone="info" className="ml-2">featured</Badge>}</Td>
            <Td><Link href={`/admin/vendors/${r.vendorId}`} className="hover:text-brand">{r.vendor}</Link>{r.country && r.country !== "NG" && <span className="ml-1 text-[11px] text-ink-muted">{r.country}</span>}</Td>
            <Td>{r.category}</Td>
            <Td className="tabular text-right">{r.priceMinor != null ? formatMoney(r.priceMinor) : "—"}</Td>
            {showStock && <Td className={`tabular text-right ${r.stock != null && r.stock <= 0 ? "text-danger" : ""}`}>{r.stock ?? "∞"}</Td>}
            <Td className="tabular text-right">{r.ratingCount ? `${r.rating.toFixed(1)} (${r.ratingCount})` : "—"}</Td>
            <Td><StatusBadge status={r.status} /></Td>
            <Td className="whitespace-nowrap">{r.updatedAt.toLocaleDateString("en-NG", { dateStyle: "medium" })}</Td>
            {canFeature && <Td>{r.status === "PUBLISHED" && <form action={toggleFeaturedAction}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="kind" value="product" /><SubmitButton size="sm" variant="ghost">{r.featured ? "Unfeature" : "Feature"}</SubmitButton></form>}</Td>}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
