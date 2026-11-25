import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/server/db";
import { Markdown } from "@/lib/markdown";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const p = await db.cmsPage.findUnique({ where: { slug: (await params).slug } });
  return p ? { title: p.title, description: p.seoDescription ?? undefined, alternates: { canonical: `/legal/${p.slug}` } } : {};
}

export default async function LegalPage({ params }: { params: Promise<{ slug: string }> }) {
  const p = await db.cmsPage.findFirst({ where: { slug: (await params).slug, published: true } });
  if (!p) notFound();
  return (
    <div className="container-x max-w-3xl py-12">
      <h1 className="text-3xl font-semibold">{p.title}</h1>
      <p className="mb-8 mt-2 text-sm text-ink-muted">Last updated {p.updatedAt.toLocaleDateString("en-NG", { dateStyle: "long" })}</p>
      <Markdown source={p.body} />
    </div>
  );
}
