import type { ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/** Compact data table. Scrolls horizontally on small screens instead of breaking layout. */
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto rounded-lg border border-line bg-white", className)}>
      <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">{children}</table>
    </div>
  );
}
export function Th({ className, ...p }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn("border-b border-line bg-canvas px-3 py-2.5 text-2xs font-semibold uppercase tracking-wider text-ink-muted first:pl-4 last:pr-4", className)} {...p} />;
}
export function Td({ className, ...p }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("border-b border-line px-3 py-3 align-middle text-ink-2 first:pl-4 last:pr-4 [tr:last-child_&]:border-b-0", className)} {...p} />;
}
