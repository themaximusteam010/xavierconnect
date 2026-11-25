/**
 * Small server-rendered SVG charts. One series per chart, brand blue, tabular labels, accessible
 * table fallback via <title>/<desc>. Values are numbers for drawing only (money is formatted separately).
 */
import { cn } from "@/lib/cn";

export function BarChart({ data, height = 160, format = (n: number) => n.toLocaleString("en-NG"), label }: { data: { label: string; value: number }[]; height?: number; format?: (n: number) => string; label: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const w = 100 / Math.max(1, data.length);
  const total = data.reduce((a, d) => a + d.value, 0);
  const every = Math.ceil(data.length / 8);
  return (
    <figure>
      <svg viewBox={`0 0 100 ${height / 4}`} preserveAspectRatio="none" className="block h-40 w-full" role="img" aria-label={`${label}: total ${format(total)}`}>
        {[0.25, 0.5, 0.75].map((g) => <line key={g} x1="0" x2="100" y1={(height / 4) * g} y2={(height / 4) * g} stroke="var(--color-line)" strokeWidth="0.15" vectorEffect="non-scaling-stroke" />)}
        {data.map((d, i) => {
          const h = (d.value / max) * (height / 4 - 1);
          return (
            <rect key={i} x={i * w + w * 0.15} y={height / 4 - h} width={w * 0.7} height={Math.max(h, d.value > 0 ? 0.3 : 0)} fill="var(--color-brand)" rx="0.3">
              <title>{`${d.label}: ${format(d.value)}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="mt-1 flex text-[10px] text-ink-faint">
        {data.map((d, i) => <span key={i} className="flex-1 truncate text-center">{i % every === 0 ? d.label : ""}</span>)}
      </div>
    </figure>
  );
}

export function HBars({ data, format = (n: number) => n.toLocaleString("en-NG"), empty = "No data in this period." }: { data: { label: string; value: number; href?: string }[]; format?: (n: number) => string; empty?: string }) {
  if (!data.length || data.every((d) => d.value === 0)) return <p className="py-6 text-center text-sm text-ink-muted">{empty}</p>;
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <ul className="space-y-2.5">
      {data.map((d) => (
        <li key={d.label} className="text-[13px]">
          <div className="flex justify-between gap-3"><span className="truncate text-ink-2">{d.href ? <a href={d.href} className="hover:text-brand">{d.label}</a> : d.label}</span><span className="tabular shrink-0 font-medium">{format(d.value)}</span></div>
          <div className="mt-1 h-1.5 rounded-full bg-sunken"><div className="h-1.5 rounded-full bg-brand" style={{ width: `${(d.value / max) * 100}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

const TONES = ["var(--color-success)", "var(--color-warning)", "var(--color-danger)", "var(--color-ink-faint)", "var(--color-brand)"];

export function StatusSplit({ data }: { data: { label: string; value: number }[] }) {
  const total = data.reduce((a, d) => a + d.value, 0);
  if (!total) return <p className="py-6 text-center text-sm text-ink-muted">No payments in this period.</p>;
  return (
    <div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-sunken" role="img" aria-label={data.map((d) => `${d.label} ${d.value}`).join(", ")}>
        {data.map((d, i) => d.value > 0 && <div key={d.label} style={{ width: `${(d.value / total) * 100}%`, background: TONES[i % TONES.length] }} />)}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-2 text-[13px]">
        {data.map((d, i) => (
          <li key={d.label} className="flex items-center gap-2"><span className="size-2.5 rounded-sm" style={{ background: TONES[i % TONES.length] }} /><span className="text-ink-2">{d.label}</span><span className={cn("tabular ml-auto font-medium")}>{d.value}</span></li>
        ))}
      </ul>
    </div>
  );
}

export function Panel({ title, children, action, className }: { title: string; children: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-lg border border-line bg-white", className)}>
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5"><h2 className="text-[13px] font-semibold">{title}</h2>{action}</header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Kpi({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "danger" | "warning" | "success" }) {
  return (
    <div className="rounded-lg border border-line bg-white px-4 py-3">
      <p className="text-[12px] text-ink-muted">{label}</p>
      <p className={cn("tabular mt-0.5 text-lg font-semibold", tone === "danger" && "text-danger", tone === "warning" && "text-warning", tone === "success" && "text-success")}>{value}</p>
      {sub && <p className="mt-0.5 text-2xs text-ink-muted">{sub}</p>}
    </div>
  );
}
