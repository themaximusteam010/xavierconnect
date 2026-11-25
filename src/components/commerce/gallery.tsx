"use client";
import { useState } from "react";
import { ProductImage } from "./product-image";
import { cn } from "@/lib/cn";

export function Gallery({ images, name }: { images: { url: string; alt: string }[]; name: string }) {
  const [i, setI] = useState(0);
  if (!images.length) return <ProductImage alt={name} sizes="large" className="rounded-lg" />;
  return (
    <div className="flex flex-col-reverse gap-3 sm:flex-row">
      {images.length > 1 && (
        <div className="flex gap-2 sm:flex-col">
          {images.map((im, idx) => (
            <button key={im.url} onClick={() => setI(idx)} aria-label={`Show image ${idx + 1}`} aria-current={idx === i} className={cn("size-16 overflow-hidden rounded-md border-2", idx === i ? "border-ink" : "border-transparent opacity-70 hover:opacity-100")}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={im.url} alt="" className="size-full object-cover" />
            </button>
          ))}
        </div>
      )}
      <div className="flex-1 overflow-hidden rounded-lg">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={images[i].url} alt={images[i].alt || name} className="aspect-square w-full bg-sunken object-cover" />
      </div>
    </div>
  );
}
