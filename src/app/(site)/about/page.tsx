import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { Markdown } from "@/lib/markdown";
export const metadata = { title: "About XavierConnect" };
export default async function About() {
  const p = await db.cmsPage.findUnique({ where: { slug: "about" } });
  if (!p) notFound();
  return <div className="container-x max-w-3xl py-12"><p className="eyebrow mb-2">A Xavier Enterprise company</p><h1 className="mb-8 text-3xl font-semibold">{p.title}</h1><Markdown source={p.body} /></div>;
}
