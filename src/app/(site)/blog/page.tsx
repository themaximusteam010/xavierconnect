import Link from "next/link";
import { db } from "@/server/db";
import { EmptyState } from "@/components/ui/feedback";
export const metadata = { title: "Blog", description: "Business tips, shopping guides and marketplace news from XavierConnect." };
export default async function Blog() {
  const posts = await db.blogPost.findMany({ where: { publishedAt: { lte: new Date() } }, orderBy: { publishedAt: "desc" }, take: 30 });
  return (
    <div className="container-x max-w-4xl py-12">
      <h1 className="text-3xl font-semibold">Blog</h1>
      <p className="mt-2 text-ink-muted">Business tips, shopping guides, seller stories and marketplace news.</p>
      {posts.length === 0 ? <EmptyState title="No articles yet" className="mt-8">Our editorial team is preparing the first articles.</EmptyState> : (
        <ul className="mt-8 divide-y divide-line">
          {posts.map((p) => <li key={p.id} className="py-6"><p className="eyebrow">{p.category}</p><Link href={`/blog/${p.slug}`} className="mt-1 block text-xl font-semibold hover:text-brand">{p.title}</Link><p className="mt-2 text-ink-2">{p.excerpt}</p><p className="mt-2 text-[13px] text-ink-muted">{p.publishedAt?.toLocaleDateString("en-NG", { dateStyle: "long" })}</p></li>)}
        </ul>
      )}
    </div>
  );
}
