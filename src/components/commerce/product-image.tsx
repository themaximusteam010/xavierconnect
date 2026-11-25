import { ImageOff } from "lucide-react";
import { cn } from "@/lib/cn";

/** Product photo with a quiet fallback when a vendor has not uploaded one yet. */
export function ProductImage({ src, alt, className, sizes = "small" }: { src?: string | null; alt: string; className?: string; sizes?: "small" | "large" }) {
  if (!src) {
    return (
      <div className={cn("flex aspect-square w-full flex-col items-center justify-center gap-1.5 bg-sunken text-ink-faint", className)} role="img" aria-label={`${alt} — no photo yet`}>
        <ImageOff className={sizes === "large" ? "size-7" : "size-5"} aria-hidden />
        <span className="text-2xs">No photo yet</span>
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} loading="lazy" decoding="async" className={cn("aspect-square w-full bg-sunken object-cover", className)} />;
}
