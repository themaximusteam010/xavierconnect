import { db } from "@/server/db";
export const metadata = { title: "Frequently asked questions" };
export default async function Faq() {
  const faqs = await db.faq.findMany({ orderBy: [{ category: "asc" }, { sortOrder: "asc" }] });
  const cats = [...new Set(faqs.map((f) => f.category))];
  const jsonLd = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.question, acceptedAnswer: { "@type": "Answer", text: f.answer } })) };
  return (
    <div className="container-x max-w-3xl py-12">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <h1 className="mb-8 text-3xl font-semibold">Frequently asked questions</h1>
      {cats.map((c) => (
        <section key={c} id={c.toLowerCase().replace(/\s+/g, "-")} className="mb-8">
          <h2 className="eyebrow mb-3">{c}</h2>
          <div className="divide-y divide-line rounded-lg border border-line">
            {faqs.filter((f) => f.category === c).map((f) => (
              <details key={f.id} className="group px-4 py-3"><summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">{f.question}<span className="text-ink-muted transition-transform group-open:rotate-45">+</span></summary><p className="mt-2 text-sm leading-6 text-ink-2">{f.answer}</p></details>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
