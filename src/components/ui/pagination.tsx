import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

export function Pagination({ page, pages, href }: { page: number; pages: number; href: (p: number) => string }) {
  if (pages <= 1) return null;
  const nums = Array.from(new Set([1, page - 1, page, page + 1, pages].filter((n) => n >= 1 && n <= pages))).sort((a, b) => a - b);
  const item = "inline-flex h-9 min-w-9 items-center justify-center rounded-md px-2 text-sm";
  return (
    <nav aria-label="Pagination" className="mt-10 flex items-center justify-center gap-1">
      {page > 1 ? <Link rel="prev" href={href(page - 1)} className={cn(item, "hover:bg-sunken")} aria-label="Previous page"><ChevronLeft className="size-4" /></Link> : <span className={cn(item, "text-ink-faint")}><ChevronLeft className="size-4" /></span>}
      {nums.map((n, i) => (
        <span key={n} className="flex items-center">
          {i > 0 && n - nums[i - 1] > 1 && <span className="px-1 text-ink-faint">…</span>}
          <Link href={href(n)} aria-current={n === page ? "page" : undefined} className={cn(item, n === page ? "bg-ink text-white" : "hover:bg-sunken")}>{n}</Link>
        </span>
      ))}
      {page < pages ? <Link rel="next" href={href(page + 1)} className={cn(item, "hover:bg-sunken")} aria-label="Next page"><ChevronRight className="size-4" /></Link> : <span className={cn(item, "text-ink-faint")}><ChevronRight className="size-4" /></span>}
    </nav>
  );
}
