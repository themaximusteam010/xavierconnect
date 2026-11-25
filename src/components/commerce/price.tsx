import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/cn";

export function Price({ price, sale, className, size = "md" }: { price: bigint | string; sale?: bigint | string | null; className?: string; size?: "sm" | "md" | "lg" }) {
  const p = BigInt(price);
  const s = sale != null ? BigInt(sale) : null;
  const onSale = s != null && s < p;
  const pct = onSale ? Number(((p - s!) * 100n) / p) : 0;
  const main = size === "lg" ? "text-2xl" : size === "sm" ? "text-sm" : "text-[15px]";
  return (
    <div className={cn("tabular flex flex-wrap items-baseline gap-x-2", className)}>
      <span className={cn("font-semibold text-ink", main)}>{formatMoney(onSale ? s! : p)}</span>
      {onSale && (
        <>
          <span className="text-[13px] text-ink-muted line-through">{formatMoney(p)}</span>
          <span className="text-[12px] font-medium text-danger">−{pct}%</span>
        </>
      )}
    </div>
  );
}
