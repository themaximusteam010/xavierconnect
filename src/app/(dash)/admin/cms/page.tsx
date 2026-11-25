import { db } from "@/server/db";
import { guard } from "@/server/auth/admin-guard";
import { saveBannerAction, toggleBannerAction, toggleSectionAction } from "@/app/actions/admin";
import { PageHeader } from "@/components/ui/page-header";
import { FlashFromQuery, StatusBadge } from "@/components/ui/feedback";
import { Input, Select } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";

export const metadata = { title: "Content" };

export default async function Content({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await guard("cms.manage");
  const sp = await searchParams;
  const [sections, banners] = await Promise.all([db.homepageSection.findMany({ orderBy: { sortOrder: "asc" } }), db.banner.findMany({ orderBy: [{ placement: "asc" }, { sortOrder: "asc" }] })]);
  return (
    <>
      <PageHeader title="Content" description="Control the homepage layout and promotional banners. Changes are live immediately." />
      <FlashFromQuery ok={sp.ok} error={sp.error} />
      <section className="mb-10">
        <h2 className="mb-3 font-semibold">Homepage sections</h2>
        <ul className="divide-y divide-line rounded-lg border border-line bg-white">
          {sections.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <span className="w-32 font-mono text-[12px] text-ink-muted">{s.type}</span>
              <form action={toggleSectionAction} className="flex flex-1 flex-wrap items-center gap-2">
                <input type="hidden" name="id" value={s.id} /><input type="hidden" name="op" value="save" />
                <Input name="title" defaultValue={s.title ?? ""} placeholder="Default title" className="h-8 w-56" aria-label="Title" />
                <Input name="subtitle" defaultValue={s.subtitle ?? ""} placeholder="Subtitle (optional)" className="h-8 w-64" aria-label="Subtitle" />
                <SubmitButton size="sm" variant="ghost">Save</SubmitButton>
              </form>
              <StatusBadge status={s.active ? "ACTIVE" : "ARCHIVED"} />
              <form action={toggleSectionAction} className="flex gap-1">
                <input type="hidden" name="id" value={s.id} />
                <button name="op" value="up" className="rounded px-2 py-1 hover:bg-sunken" aria-label="Move up">↑</button>
                <button name="op" value="down" className="rounded px-2 py-1 hover:bg-sunken" aria-label="Move down">↓</button>
                <button name="op" value="toggle" className="rounded px-2 py-1 text-[12px] text-brand hover:bg-sunken">{s.active ? "Hide" : "Show"}</button>
              </form>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="mb-3 font-semibold">Banners</h2>
        <div className="space-y-3">
          {[...banners, null].map((b) => (
            <form key={b?.id ?? "new"} action={saveBannerAction} className="grid gap-2 rounded-lg border border-line bg-white p-4 text-sm sm:grid-cols-6">
              <input type="hidden" name="id" value={b?.id ?? ""} />
              <Select name="placement" defaultValue={b?.placement ?? "HOME_MID"} aria-label="Placement"><option value="HOME_MID">Homepage</option></Select>
              <Input name="eyebrow" defaultValue={b?.eyebrow ?? ""} placeholder="Eyebrow" aria-label="Eyebrow" />
              <Input name="title" defaultValue={b?.title ?? ""} placeholder={b ? "Title" : "New banner title"} className="sm:col-span-2" aria-label="Title" required />
              <Select name="tone" defaultValue={b?.tone ?? "blue"} aria-label="Style"><option value="blue">Light blue</option><option value="charcoal">Charcoal</option><option value="light">Neutral</option></Select>
              <div className="flex items-center gap-2">{b && <StatusBadge status={b.active ? "ACTIVE" : "ARCHIVED"} />}</div>
              <Input name="body" defaultValue={b?.body ?? ""} placeholder="Body text" className="sm:col-span-3" aria-label="Body" />
              <Input name="ctaLabel" defaultValue={b?.ctaLabel ?? ""} placeholder="Button label" aria-label="Button label" />
              <Input name="ctaHref" defaultValue={b?.ctaHref ?? ""} placeholder="/shop" aria-label="Button link" />
              <div className="flex gap-2"><SubmitButton size="sm">{b ? "Save" : "Add"}</SubmitButton>{b && <SubmitButton size="sm" variant="ghost" formAction={toggleBannerAction}>{b.active ? "Hide" : "Show"}</SubmitButton>}</div>
            </form>
          ))}
        </div>
      </section>
    </>
  );
}
