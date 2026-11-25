import Link from "next/link";
import { Logo } from "@/components/brand/logo";
export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <Logo />
      <h1 className="mt-6 text-2xl font-semibold">We couldn't find that page</h1>
      <p className="max-w-sm text-sm text-ink-muted">The link may be broken, or the listing may have been removed by the seller.</p>
      <div className="flex gap-4 text-sm"><Link href="/" className="font-medium text-brand">Go home</Link><Link href="/shop" className="font-medium text-brand">Browse the shop</Link></div>
    </div>
  );
}
