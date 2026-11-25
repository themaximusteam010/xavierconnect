"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Scale } from "lucide-react";

const KEY = "xc_compare";
const read = (): string[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { return []; } };

export function CompareToggle({ slug }: { slug: string }) {
  const [list, setList] = useState<string[]>([]);
  useEffect(() => setList(read()), []);
  const on = list.includes(slug);
  const toggle = () => {
    const next = on ? list.filter((s) => s !== slug) : [...list.filter((s) => s !== slug), slug].slice(-4);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch {}
    setList(next);
  };
  return (
    <span className="flex items-center gap-3 text-[13px]">
      <button type="button" onClick={toggle} className="flex items-center gap-1.5 text-ink-2 hover:text-ink"><Scale className="size-4" />{on ? "Remove from compare" : "Add to compare"}</button>
      {list.length > 1 && <Link href={`/compare?p=${list.join(",")}`} className="font-medium text-brand hover:underline">Compare {list.length}</Link>}
    </span>
  );
}
