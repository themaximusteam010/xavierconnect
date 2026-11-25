import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { deleteAddressAction, setDefaultAddressAction } from "@/app/actions/account";
import { PageHeader } from "@/components/ui/page-header";
import { AddressForm } from "@/components/account-forms";
import { Badge } from "@/components/ui/feedback";

export const metadata = { title: "Addresses" };

export default async function Addresses() {
  const u = await requireUser("/account/addresses");
  const list = await db.address.findMany({ where: { userId: u.id }, orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }] });
  return (
    <>
      <PageHeader title="Addresses" />
      {list.length > 0 && (
        <ul className="mb-10 grid gap-3 sm:grid-cols-2">
          {list.map((a) => (
            <li key={a.id} className="rounded-lg border border-line p-4 text-sm">
              <div className="mb-1 flex items-center gap-2"><span className="font-medium">{a.label ?? a.fullName}</span>{a.isDefault && <Badge tone="brand">Default</Badge>}</div>
              <p className="text-ink-2">{a.fullName} · {a.phone}</p>
              <p className="text-ink-2">{a.line1}{a.line2 ? `, ${a.line2}` : ""}, {a.city}, {a.state}</p>
              <div className="mt-3 flex gap-4 text-[13px]">
                {!a.isDefault && <form action={setDefaultAddressAction}><input type="hidden" name="id" value={a.id} /><button className="text-brand">Make default</button></form>}
                <form action={deleteAddressAction}><input type="hidden" name="id" value={a.id} /><button className="text-ink-muted hover:text-danger">Delete</button></form>
              </div>
            </li>
          ))}
        </ul>
      )}
      <h2 className="mb-4 font-semibold">Add an address</h2>
      <AddressForm />
    </>
  );
}
