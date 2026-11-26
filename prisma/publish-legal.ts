/**
 * Publishes docs/legal/*.md to the CmsPage table (served at /legal/[slug]).
 *   npx tsx prisma/publish-legal.ts            → preview only (lists what would change)
 *   npx tsx prisma/publish-legal.ts --apply    → writes the changes
 * Pages whose text is already identical are left untouched (their "Last updated" date stays the same).
 */
import { PrismaClient } from "@prisma/client";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export function loadLegalDocs(dir = path.join(process.cwd(), "docs/legal")) {
  return readdirSync(dir).filter((f) => f.endsWith(".md")).sort().map((f) => {
    const raw = readFileSync(path.join(dir, f), "utf8");
    const m = /^---\ntitle: (.+)\ndescription: (.+)\n---\n([\s\S]*)$/.exec(raw);
    if (!m) throw new Error(`${f}: missing title/description front matter`);
    return { slug: f.replace(/\.md$/, ""), title: m[1].trim(), seoDescription: m[2].trim(), body: m[3].trim() + "\n" };
  });
}

async function main() {
  const apply = process.argv.includes("--apply");
  const db = new PrismaClient();
  try {
    for (const d of loadLegalDocs()) {
      const cur = await db.cmsPage.findUnique({ where: { slug: d.slug } });
      if (cur && cur.title === d.title && cur.body === d.body && cur.seoDescription === d.seoDescription && cur.published) { console.log(`unchanged  /legal/${d.slug}`); continue; }
      console.log(`${cur ? "update   " : "create   "}  /legal/${d.slug}  (${d.body.length} chars${cur ? `, was ${cur.body.length}` : ""})`);
      if (apply) await db.cmsPage.upsert({ where: { slug: d.slug }, create: { ...d, published: true }, update: { ...d, published: true } });
    }
    if (!apply) console.log("\nPreview only. Run with --apply to write.");
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1]?.endsWith("publish-legal.ts")) main().catch((e) => { console.error(e); process.exit(1); });
