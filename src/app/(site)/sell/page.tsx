import { db } from "@/server/db";
import { ButtonLink } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Sell on XavierConnect", description: "Open a store, list products and services, and get paid to your Nigerian bank account." };

export default async function Sell() {
  const [plans, global] = await Promise.all([
    db.subscriptionPlan.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    db.commissionRule.findFirst({ where: { scope: "GLOBAL", active: true } }),
  ]);
  return (
    <>
      <section className="border-b border-line bg-canvas">
        <div className="container-x grid gap-10 py-14 lg:grid-cols-[1.3fr_1fr] lg:py-20">
          <div>
            <p className="eyebrow mb-3">Sell on XavierConnect</p>
            <h1 className="max-w-xl text-[34px] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[44px]">Your store, your customers, paid to your bank.</h1>
            <p className="mt-4 max-w-lg text-[16px] leading-7 text-ink-2">Sell physical products, take bookings for your services, or deliver digital files. We handle checkout, payment collection and buyer protection; you focus on your business.</p>
            <div className="mt-7 flex flex-wrap gap-3"><ButtonLink href="/sell/apply" size="lg">Start your application</ButtonLink><ButtonLink href="/legal/vendor-agreement" size="lg" variant="secondary">Read the vendor agreement</ButtonLink></div>
          </div>
          <ol className="space-y-5 self-center">
            {[
              ["Create your account and confirm your email", "Takes two minutes."],
              ["Tell us about your business", "Individual sellers, registered businesses and service providers are all welcome."],
              ["Upload one form of ID", "We verify every seller before they can take payments. Registered businesses can also upload their CAC certificate."],
              ["Set up your storefront, payouts and delivery", "Add your logo, bank account and delivery prices."],
              ["Get approved and start listing", "Most applications are reviewed within two business days."],
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-4"><span className="tabular flex size-7 shrink-0 items-center justify-center rounded-full bg-ink text-[13px] font-semibold text-white">{i + 1}</span><div><p className="font-medium">{t}</p><p className="text-sm text-ink-muted">{d}</p></div></li>
            ))}
          </ol>
        </div>
      </section>
      <section className="container-x py-14">
        <h2 className="text-xl font-semibold">Plans</h2>
        <p className="mt-1 text-sm text-ink-muted">Start free. Commission is only charged when you make a sale{global ? ` (default ${global.rateBps / 100}%)` : ""}.</p>
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <thead><tr className="border-b border-line">{["", ...plans.map((p) => p.name)].map((h) => <th key={h} className="py-3 pr-4 font-semibold">{h}</th>)}</tr></thead>
            <tbody>
              <tr className="border-b border-line"><td className="py-3 pr-4 text-ink-muted">Monthly fee</td>{plans.map((p) => <td key={p.id} className="tabular py-3 pr-4">{p.key === "ENTERPRISE" ? "Talk to us" : p.priceMinor === 0n ? "Free" : formatMoney(p.priceMinor)}</td>)}</tr>
              <tr className="border-b border-line"><td className="py-3 pr-4 text-ink-muted">Commission per sale</td>{plans.map((p) => <td key={p.id} className="tabular py-3 pr-4">{p.commissionBps != null ? `${p.commissionBps / 100}%` : "Negotiated"}</td>)}</tr>
              <tr className="border-b border-line"><td className="py-3 pr-4 text-ink-muted">Active listings</td>{plans.map((p) => <td key={p.id} className="tabular py-3 pr-4">{p.listingLimit?.toLocaleString() ?? "Unlimited"}</td>)}</tr>
              <tr><td className="py-3 pr-4 text-ink-muted">Includes</td>{plans.map((p) => <td key={p.id} className="py-3 pr-4 align-top text-ink-2">{p.features.join(" · ")}</td>)}</tr>
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-[13px] text-ink-muted">Every seller starts on Starter. Plan upgrades are available from your dashboard after approval.</p>
      </section>
    </>
  );
}
