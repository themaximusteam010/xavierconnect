import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { NewsletterForm } from "./newsletter-form";

const COLS = [
  { title: "Shop", links: [["All products", "/shop"], ["Services", "/services"], ["Digital products", "/shop?type=digital"], ["Deals", "/deals"], ["Stores", "/stores"], ["Compare", "/compare"]] },
  { title: "Sell", links: [["Become a vendor", "/sell"], ["Vendor dashboard", "/vendor"], ["Vendor agreement", "/legal/vendor-agreement"], ["Seller help", "/help#selling"]] },
  { title: "Support", links: [["Help Centre", "/help"], ["FAQ", "/faq"], ["Contact us", "/contact"], ["Shipping policy", "/legal/shipping"], ["Returns", "/legal/returns"], ["Refunds", "/legal/refunds"], ["Prohibited items", "/legal/prohibited-items"]] },
  { title: "Company", links: [["About XavierConnect", "/about"], ["Blog", "/blog"], ["Terms", "/legal/terms"], ["Privacy", "/legal/privacy"], ["Cookies", "/legal/cookies"], ["Acceptable use", "/legal/acceptable-use"], ["Intellectual property", "/legal/ip-policy"]] },
];

export function SiteFooter() {
  return (
    <footer className="mt-20 border-t border-line bg-canvas pb-20 lg:pb-0">
      <div className="container-x grid gap-10 py-12 lg:grid-cols-[1.3fr_2fr]">
        <div className="max-w-sm">
          <Logo />
          <p className="mt-4 text-sm leading-6 text-ink-muted">Connecting people. Empowering businesses. A marketplace for products, services and digital goods from independent sellers across Nigeria.</p>
          <div className="mt-6">
            <p className="mb-2 text-sm font-medium text-ink">Get new arrivals and seller stories by email</p>
            <NewsletterForm />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          {COLS.map((c) => (
            <div key={c.title}>
              <p className="eyebrow mb-3">{c.title}</p>
              <ul className="space-y-2 text-sm">
                {c.links.map(([label, href]) => <li key={href}><Link href={href} className="text-ink-2 hover:text-brand">{label}</Link></li>)}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <div className="border-t border-line">
        <div className="container-x flex flex-col gap-2 py-5 text-[12px] text-ink-muted sm:flex-row sm:justify-between">
          <p>© {new Date().getFullYear()} Xavier Enterprise. XavierConnect is a Xavier Enterprise company.</p>
          <p>Prices in Nigerian Naira (₦). Payments processed by licensed providers.</p>
        </div>
      </div>
    </footer>
  );
}
