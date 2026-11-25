import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/server/db";
import { Markdown } from "@/lib/markdown";
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const p = await db.blogPost.findUnique({ where: { slug: (await params).slug } });
  return p ? { title: p.title, description: p.excerpt, alternates: { canonical: `/blog/${p.slug}` }, openGraph: { type: "article", title: p.title } } : {};
}
export default async function Post({ params }: { params: Promise<{ slug: string }> }) {
  const p = await db.blogPost.findFirst({ where: { slug: (await params).slug, publishedAt: { lte: new Date() } }, include: { author: { select: { name: true } } } });
  if (!p) notFound();
  return (
    <article className="container-x max-w-3xl py-12">
      <p className="eyebrow">{p.category}</p>
      <h1 className="mt-2 text-3xl font-semibold leading-tight">{p.title}</h1>
      <p className="mb-8 mt-3 text-sm text-ink-muted">{p.author?.name ?? "XavierConnect"} · {p.publishedAt?.toLocaleDateString("en-NG", { dateStyle: "long" })}</p>
      <Markdown source={p.body} />
    </article>
  );
}
