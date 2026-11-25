"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

const KEY = "xc_recent";
interface Item { slug: string; name: string; image: string | null; price: string }

/** Stored per browser only (localStorage). Never sent to the server. */
export function rememberViewed(item: Item) {
  try {
    const list: Item[] = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    const next = [item, ...list.filter((i) => i.slug !== item.slug)].slice(0, 12);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {}
}

export function RememberViewed(props: Item) {
  useEffect(() => rememberViewed(props), [props]);
  return null;
}

export function RecentlyViewed({ title = "Recently viewed", exclude }: { title?: string; exclude?: string }) {
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => {
    try { setItems((JSON.parse(localStorage.getItem(KEY) ?? "[]") as Item[]).filter((i) => i.slug !== exclude).slice(0, 6)); } catch {}
  }, [exclude]);
  if (!items.length) return null;
  return (
    <section className="container-x py-10">
      <h2 className="mb-5 text-lg font-semibold">{title}</h2>
      <ul className="grid grid-cols-3 gap-4 sm:grid-cols-6">
        {items.map((i) => (
          <li key={i.slug}>
            <Link href={`/p/${i.slug}`} className="group block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {i.image ? <img src={i.image} alt="" className="aspect-square w-full rounded-md bg-sunken object-cover" /> : <div className="aspect-square w-full rounded-md bg-sunken" />}
              <p className="mt-2 line-clamp-2 text-[13px] text-ink-2 group-hover:text-ink">{i.name}</p>
              <p className="tabular text-[13px] font-medium">{i.price}</p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
