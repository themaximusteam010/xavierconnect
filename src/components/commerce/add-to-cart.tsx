"use client";
import Link from "next/link";
import { useActionState, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { addToCartAction } from "@/app/actions/cart";
import { SubmitButton } from "@/components/ui/submit-button";
import { Alert } from "@/components/ui/feedback";
import { cn } from "@/lib/cn";

interface Variant { id: string; name: string; stock: number; price: string | null }

export function AddToCart({ productId, variants, stock, digital, disabled }: { productId: string; variants: Variant[]; stock: number; digital: boolean; disabled?: boolean }) {
  const [state, action] = useActionState(addToCartAction, null);
  const [variantId, setVariantId] = useState(variants.length === 1 ? variants[0].id : "");
  const [qty, setQty] = useState(1);
  const v = variants.find((x) => x.id === variantId);
  const available = variants.length ? (v?.stock ?? 0) : stock;
  const soldOut = !digital && (variants.length ? variants.every((x) => x.stock <= 0) : stock <= 0);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="variantId" value={variantId} />
      {variants.length > 0 && (
        <fieldset>
          <legend className="mb-2 text-[13px] font-medium text-ink-2">Option{v && <span className="font-normal text-ink-muted">: {v.name}</span>}</legend>
          <div className="flex flex-wrap gap-2">
            {variants.map((x) => (
              <button
                type="button"
                key={x.id}
                disabled={x.stock <= 0}
                onClick={() => { setVariantId(x.id); setQty(1); }}
                aria-pressed={variantId === x.id}
                className={cn("h-9 rounded-md border px-3 text-sm", variantId === x.id ? "border-ink bg-ink text-white" : "border-line-strong hover:border-ink", x.stock <= 0 && "cursor-not-allowed text-ink-faint line-through")}
              >
                {x.name}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      {!digital && (
        <div className="flex items-center gap-4">
          <div className="flex h-10 items-center rounded-md border border-line-strong">
            <button type="button" aria-label="Decrease quantity" className="flex size-10 items-center justify-center text-ink-2 disabled:opacity-40" onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty <= 1}><Minus className="size-4" /></button>
            <input name="quantity" value={qty} readOnly className="tabular w-10 text-center text-sm" aria-label="Quantity" />
            <button type="button" aria-label="Increase quantity" className="flex size-10 items-center justify-center text-ink-2 disabled:opacity-40" onClick={() => setQty((q) => Math.min(available, q + 1))} disabled={qty >= available}><Plus className="size-4" /></button>
          </div>
          <p className="text-[13px] text-ink-muted">
            {soldOut ? <span className="text-danger">Sold out</span> : variants.length && !v ? "Choose an option" : available <= 5 ? <span className="text-warning">Only {available} left</span> : <span className="text-success">In stock</span>}
          </p>
        </div>
      )}
      {digital && <input type="hidden" name="quantity" value="1" />}
      <div className="grid grid-cols-2 gap-2">
        <SubmitButton size="lg" variant="secondary" disabled={disabled || soldOut || (variants.length > 0 && !v)}>Add to cart</SubmitButton>
        <SubmitButton size="lg" name="buyNow" value="1" disabled={disabled || soldOut || (variants.length > 0 && !v)}>Buy now</SubmitButton>
      </div>
      {state?.message && (
        <Alert tone={state.ok ? "success" : "danger"}>
          {state.message} {state.ok && <Link href="/cart" className="font-medium underline">View cart</Link>}
        </Alert>
      )}
    </form>
  );
}
