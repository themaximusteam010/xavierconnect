import Link from "next/link";
import { db } from "@/server/db";
import { guard } from "@/server/auth/admin-guard";
import { saveCategoryAction } from "@/app/actions/admin-ops";
import { PageHeader } from "@/components/ui/page-header";
import { FlashFromQuery, Badge } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/table";
import { Input, Select, Checkbox } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";

export const metadata = { title: "Categories" };

export default async function Categories({ searchParams }: { searchParams: Promise<{ kind?: string; edit?: string; ok?: string; error?: string }> }) {
  await guard("category.manage");
  const sp = await searchParams;
  const kind = (["PRODUCT", "SERVICE", "DIGITAL"].includes(sp.kind ?? "") ? sp.kind : "PRODUCT") as "PRODUCT" | "SERVICE" | "DIGITAL";
  const cats = await db.category.findMany({ where: { kind }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: { _count: { select: { products: true, services: true, children: true } } } });
  const roots = cats.filter((c) => !c.parentId);
  const editing = sp.edit ? cats.find((c) => c.id === sp.edit) : undefined;
  const ordered = roots.flatMap((r) => [r, ...cats.filter((c) => c.parentId === r.id)]);
  return (
    <>
      <PageHeader title="Categories" description="Categories drive navigation, search filters and category-level commission rules. Categories are never deleted, so existing listings and ledger history keep their reference." />
      <FlashFromQuery ok={sp.ok} error={sp.error} />
      <nav className="mb-4 flex gap-1 border-b border-line text-sm">{(["PRODUCT", "SERVICE", "DIGITAL"] as const).map((k) => <Link key={k} href={`/admin/categories?kind=${k}`} className={`-mb-px border-b-2 px-3 py-2 ${kind === k ? "border-ink font-medium" : "border-transparent text-ink-muted"}`}>{k.toLowerCase()}</Link>)}</nav>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Table>
          <thead><tr><Th>Name</Th><Th>Slug</Th><Th className="text-right">Listings</Th><Th className="text-right">Order</Th><Th /></tr></thead>
          <tbody>{ordered.map((c) => (
            <tr key={c.id}>
              <Td className={c.parentId ? "pl-8" : "font-medium"}>{c.parentId && "↳ "}{c.name}{c.isFeatured && <Badge tone="info" className="ml-2">featured</Badge>}</Td>
              <Td className="font-mono text-[12px] text-ink-muted">{c.slug}</Td>
              <Td className="tabular text-right">{c._count.products + c._count.services}</Td>
              <Td className="tabular text-right">{c.sortOrder}</Td>
              <Td><Link href={`/admin/categories?kind=${kind}&edit=${c.id}`} className="text-[12px] text-brand">Edit</Link></Td>
            </tr>
          ))}</tbody>
        </Table>
        <form action={saveCategoryAction} className="h-fit space-y-3 rounded-lg border border-line bg-white p-4 text-[13px]" key={editing?.id ?? "new"}>
          <p className="font-semibold">{editing ? `Edit “${editing.name}”` : "New category"}</p>
          {editing && <input type="hidden" name="id" value={editing.id} />}
          <input type="hidden" name="kind" value={kind} />
          <label className="block">Name<Input name="name" defaultValue={editing?.name} required minLength={2} maxLength={60} /></label>
          <label className="block">Parent<Select name="parentId" defaultValue={editing?.parentId ?? ""}><option value="">None (top level)</option>{roots.filter((r) => r.id !== editing?.id).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></label>
          <label className="block">Sort order<Input name="sortOrder" type="number" min={0} max={999} defaultValue={editing?.sortOrder ?? 0} /></label>
          <Checkbox name="isFeatured" label="Show on the homepage" defaultChecked={editing?.isFeatured} />
          <div className="flex gap-2"><SubmitButton size="sm">Save</SubmitButton>{editing && <Link href={`/admin/categories?kind=${kind}`} className="text-[12px] leading-8 text-ink-muted">Cancel</Link>}</div>
        </form>
      </div>
    </>
  );
}
