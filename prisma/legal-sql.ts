/** Prints SQL that updates the given legal pages from docs/legal (for applying through a SQL console). */
import { loadLegalDocs } from "./publish-legal";

const slugs = process.argv.slice(2);
const q = (s: string) => {
  if (s.includes("$lg$")) throw new Error("delimiter clash");
  return "$lg$" + s + "$lg$";
};
const lines = loadLegalDocs()
  .filter((d) => slugs.length === 0 || slugs.includes(d.slug))
  .map((d) => `update "CmsPage" set title=${q(d.title)}, body=${q(d.body)}, "seoDescription"=${q(d.seoDescription)}, published=true, "updatedAt"=now() where slug=${q(d.slug)};`);
console.log(lines.join("\n"));
