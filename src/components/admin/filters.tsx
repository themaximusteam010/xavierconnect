import Link from "next/link";
import { PRESETS } from "./date-range";

type FieldDef =
  | { type: "search"; name: string; placeholder: string }
  | { type: "select"; name: string; label: string; options: [string, string][] }
  | { type: "range" };

/** GET-form filter bar: works without JavaScript, shareable URLs, keeps other params. */
export function FilterBar({ fields, values, action, extra }: { fields: FieldDef[]; values: Record<string, string | undefined>; action: string; extra?: React.ReactNode }) {
  const cls = "h-9 rounded-md border border-line-strong bg-white px-2.5 text-[13px] focus:border-brand focus:outline-none";
  const active = fields.some((f) => (f.type === "range" ? values.range : values[f.name]));
  return (
    <form action={action} className="mb-4 flex flex-wrap items-end gap-2 rounded-lg border border-line bg-white p-3">
      {fields.map((f, i) => {
        if (f.type === "search") return <input key={i} name={f.name} defaultValue={values[f.name] ?? ""} placeholder={f.placeholder} aria-label={f.placeholder} className={`${cls} w-56`} />;
        if (f.type === "select")
          return (
            <label key={i} className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wider text-ink-muted">
              {f.label}
              <select name={f.name} defaultValue={values[f.name] ?? ""} className={`${cls} min-w-36 normal-case tracking-normal text-ink`}>
                <option value="">All</option>
                {f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          );
        return (
          <div key={i} className="flex items-end gap-2">
            <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wider text-ink-muted">
              Period
              <select name="range" defaultValue={values.range ?? ""} className={`${cls} normal-case tracking-normal text-ink`}>
                <option value="">Last 30 days</option>
                {PRESETS.filter(([k]) => k !== "30d").map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <input type="date" name="from" defaultValue={values.from} aria-label="From (custom range)" className={cls} />
            <input type="date" name="to" defaultValue={values.to} aria-label="To (custom range)" className={cls} />
          </div>
        );
      })}
      <button className="h-9 rounded-md bg-ink px-3 text-[13px] font-medium text-white hover:bg-ink-2">Apply</button>
      {active && <Link href={action} className="h-9 px-2 text-[13px] leading-9 text-ink-muted hover:text-ink">Reset</Link>}
      {extra && <div className="ml-auto flex items-end gap-2">{extra}</div>}
    </form>
  );
}

export function qs(base: string, params: Record<string, string | number | undefined | null>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") u.set(k, String(v));
  const s = u.toString();
  return s ? `${base}?${s}` : base;
}
