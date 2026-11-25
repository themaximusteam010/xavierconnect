import Link from "next/link";
import { Wrench } from "lucide-react";
import { db } from "@/server/db";
import { requireVendor } from "@/server/auth/session";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, StatusBadge } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/table";
import { ButtonLink } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Services" };

export default async function VendorServices() {
  const { vendorId } = await requireVendor("services");
  const list = await db.service.findMany({ where: { vendorId, deletedAt: null }, orderBy: { updatedAt: "desc" }, include: { packages: { orderBy: { priceMinor: "asc" } }, category: true, _count: { select: { bookings: true } } } });
  return (
    <>
      <PageHeader title="Services" actions={<ButtonLink href="/vendor/services/new">Add service</ButtonLink>} />
      {list.length === 0 ? <EmptyState icon={Wrench} title="No services yet" action={<ButtonLink href="/vendor/services/new">Add a service</ButtonLink>}>List what you offer with up to three packages and your weekly hours.</EmptyState> : (
        <Table>
          <thead><tr><Th>Service</Th><Th>Category</Th><Th>Status</Th><Th>From</Th><Th className="text-right">Bookings</Th></tr></thead>
          <tbody>{list.map((s) => <tr key={s.id}><Td><Link href={`/vendor/services/${s.id}`} className="font-medium text-ink hover:text-brand">{s.title}</Link></Td><Td>{s.category.name}</Td><Td><StatusBadge status={s.status} /></Td><Td className="tabular">{s.packages[0] ? formatMoney(s.packages[0].priceMinor) : "—"}</Td><Td className="tabular text-right">{s._count.bookings}</Td></tr>)}</tbody>
        </Table>
      )}
    </>
  );
}
