import { AlertCircle, CheckCircle2, Info, TriangleAlert, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type Tone = "info" | "success" | "warning" | "danger" | "neutral" | "brand";

const tones: Record<Tone, string> = {
  info: "bg-brand-soft text-brand-ink border-blue-200",
  brand: "bg-brand-soft text-brand-ink border-blue-200",
  success: "bg-success-soft text-success border-green-200",
  warning: "bg-warning-soft text-warning border-amber-200",
  danger: "bg-danger-soft text-danger border-red-200",
  neutral: "bg-sunken text-ink-2 border-line",
};
const icons: Record<Tone, LucideIcon> = { info: Info, brand: Info, success: CheckCircle2, warning: TriangleAlert, danger: AlertCircle, neutral: Info };

export function Alert({ tone = "info", title, children, className }: { tone?: Tone; title?: ReactNode; children?: ReactNode; className?: string }) {
  const Icon = icons[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("flex gap-3 rounded-md border px-4 py-3 text-sm", tones[tone], className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="space-y-0.5">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className="opacity-90">{children}</div>}
      </div>
    </div>
  );
}

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-2xs font-medium leading-4", tones[tone], className)}>{children}</span>;
}

const STATUS_TONE: Record<string, Tone> = {
  PUBLISHED: "success", APPROVED: "success", PAID: "success", COMPLETED: "success", DELIVERED: "success", FULFILLED: "success", SUCCEEDED: "success", CONFIRMED: "success", RESOLVED: "success", ACTIVE: "success",
  PENDING_REVIEW: "warning", SUBMITTED: "warning", PENDING_PAYMENT: "warning", AWAITING_PAYMENT: "warning", REQUESTED: "warning", PROCESSING: "info", NEW: "brand", OPEN: "warning", CHANGES_REQUESTED: "warning", PARTIALLY_FULFILLED: "info", READY_FOR_DISPATCH: "info", SHIPPED: "info", IN_TRANSIT: "info", AWAITING_PICKUP: "info", PICKED_UP: "info", AT_SORTING_FACILITY: "info", CUSTOMS_PROCESSING: "warning", OUT_FOR_DELIVERY: "info", FAILED_ATTEMPT: "danger", RETURNED: "danger", RECEIVED: "info", ESCALATED: "danger",
  REJECTED: "danger", CANCELLED: "neutral", FAILED: "danger", SUSPENDED: "danger", REFUNDED: "neutral", PARTIALLY_REFUNDED: "neutral", DRAFT: "neutral", ARCHIVED: "neutral", ABANDONED: "neutral", INITIATED: "neutral",
};

export function StatusBadge({ status }: { status: string }) {
  const label = status.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{label}</Badge>;
}

export function EmptyState({ icon: Icon, title, children, action, className }: { icon?: LucideIcon; title: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center rounded-lg border border-dashed border-line-strong px-6 py-14 text-center", className)}>
      {Icon && <Icon className="mb-3 size-6 text-ink-faint" aria-hidden />}
      <p className="font-medium text-ink">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-ink-muted">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function FlashFromQuery({ ok, error }: { ok?: string; error?: string }) {
  if (error) return <Alert tone="danger" className="mb-6">{error}</Alert>;
  if (ok) return <Alert tone="success" className="mb-6">{ok}</Alert>;
  return null;
}
