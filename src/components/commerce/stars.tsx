import { Star } from "lucide-react";
import { cn } from "@/lib/cn";

export function Stars({ value, count, className, size = 14 }: { value: number; count?: number; className?: string; size?: number }) {
  if (count === 0) return <span className={cn("text-[12px] text-ink-muted", className)}>No reviews yet</span>;
  return (
    <span className={cn("inline-flex items-center gap-1", className)} aria-label={`Rated ${value.toFixed(1)} out of 5${count != null ? ` from ${count} reviews` : ""}`}>
      <span className="flex" aria-hidden>
        {[1, 2, 3, 4, 5].map((i) => (
          <Star key={i} width={size} height={size} className={i <= Math.round(value) ? "fill-amber-400 text-amber-400" : "fill-line text-line"} />
        ))}
      </span>
      {count != null && <span className="tabular text-[12px] text-ink-muted">({count})</span>}
    </span>
  );
}
