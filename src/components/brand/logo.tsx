import Link from "next/link";
import { cn } from "@/lib/cn";

/** The woven-X mark. Mirrors public/brand/xc-mark.svg; swap both if the master logo changes. */
export function LogoMark({ className, mono }: { className?: string; mono?: boolean }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={cn("shrink-0", className)}>
      {!mono && <rect width="64" height="64" rx="14" fill="var(--color-brand)" />}
      <g stroke={mono ? "currentColor" : "#fff"} strokeWidth="8" strokeLinecap="round" fill="none">
        <path d="M19 19 L45 45" />
        <path d="M45 19 L38.6 25.4 M25.4 38.6 L19 45" />
      </g>
    </svg>
  );
}

export function Logo({ className, href = "/", invert }: { className?: string; href?: string; invert?: boolean }) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-2.5", className)} aria-label="XavierConnect home">
      <LogoMark className="size-8" />
      <span className={cn("text-[19px] font-bold tracking-[-0.03em]", invert ? "text-white" : "text-ink")}>
        Xavier<span className={invert ? "text-blue-300" : "text-brand"}>Connect</span>
      </span>
    </Link>
  );
}
