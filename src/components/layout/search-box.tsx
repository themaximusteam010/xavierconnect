"use client";
import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

interface Suggestion { type: "product" | "store" | "category"; label: string; href: string }

export function SearchBox({ defaultValue = "", className = "" }: { defaultValue?: string; className?: string }) {
  const [q, setQ] = useState(defaultValue);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const router = useRouter();
  const listId = useId();
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setItems([]); return; }
    const t = setTimeout(async () => {
      ctrl.current?.abort();
      ctrl.current = new AbortController();
      try {
        const res = await fetch(`/api/search/suggest?q=${encodeURIComponent(term)}`, { signal: ctrl.current.signal });
        if (res.ok) { setItems((await res.json()).items); setActive(-1); }
      } catch {}
    }, 180);
    return () => clearTimeout(t);
  }, [q]);

  function go(href?: string) {
    setOpen(false);
    router.push(href ?? `/shop?q=${encodeURIComponent(q.trim())}`);
  }

  return (
    <form role="search" className={`relative ${className}`} onSubmit={(e) => { e.preventDefault(); go(active >= 0 ? items[active]?.href : undefined); }}>
      <label htmlFor={`${listId}-input`} className="sr-only">Search products, services and stores</label>
      <input
        id={`${listId}-input`}
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, -1)); }
          if (e.key === "Escape") setOpen(false);
        }}
        role="combobox"
        aria-expanded={open && items.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder="Search products, services and stores"
        className="h-11 w-full rounded-md border border-line-strong bg-white pl-4 pr-12 text-[15px] placeholder:text-ink-faint focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15"
      />
      <button type="submit" aria-label="Search" className="absolute right-1 top-1 flex h-9 w-10 items-center justify-center rounded bg-brand text-white hover:bg-brand-hover">
        <Search className="size-4" />
      </button>
      {open && items.length > 0 && (
        <ul id={listId} role="listbox" className="absolute inset-x-0 top-full z-50 mt-1 overflow-hidden rounded-md border border-line bg-white py-1 shadow-pop">
          {items.map((s, i) => (
            <li key={s.href} role="option" aria-selected={i === active}>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); go(s.href); }} className={`flex w-full items-center justify-between px-4 py-2 text-left text-sm ${i === active ? "bg-sunken" : "hover:bg-sunken"}`}>
                <span className="truncate text-ink">{s.label}</span>
                <span className="ml-3 shrink-0 text-2xs uppercase tracking-wider text-ink-faint">{s.type}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
