import Link from "next/link";
import { db } from "@/server/db";
import { ButtonLink } from "@/components/ui/button";
export const metadata = { title: "Help Centre" };
const TOPICS: [string, string, string][] = [
  ["Getting started", "Create an account, confirm your email and set up addresses.", "/faq#buying"],
  ["Buying products", "Multi-seller carts, checkout, delivery options and tracking.", "/faq#buying"],
  ["Payments", "Accepted methods, when sellers are paid, and failed payments.", "/faq#payments"],
  ["Returns and refunds", "Return windows, how to request a refund, and timelines.", "/legal/returns"],
  ["Shipping", "How each seller ships and how to track every shipment.", "/legal/shipping"],
  ["Digital downloads", "Where to find your files, download limits and expiry.", "/faq#digital-downloads"],
  ["Bookings", "Booking a service, rescheduling and cancellations.", "/faq#bookings"],
  ["Selling on XavierConnect", "Applying, listing products, fulfilment and withdrawals.", "/faq#selling"],
  ["Account security", "Passwords, signing out of all devices and suspicious activity.", "/account/settings"],
];
export default async function Help() {
  const count = await db.faq.count();
  return (
    <div className="container-x py-12">
      <h1 className="text-3xl font-semibold">Help Centre</h1>
      <p className="mt-2 text-ink-muted">Answers to common questions, and a direct line to our support team.</p>
      <ul className="mt-8 grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-3" id="selling">
        {TOPICS.map(([t, d, href]) => <li key={t} className="bg-white"><Link href={href} className="block h-full p-5 hover:bg-canvas"><p className="font-medium">{t}</p><p className="mt-1 text-sm text-ink-muted">{d}</p></Link></li>)}
      </ul>
      <div className="mt-10 flex flex-col gap-4 rounded-lg bg-canvas p-6 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="font-medium">Still need help?</p><p className="text-sm text-ink-muted">Browse all {count} answers in the FAQ, or open a ticket and we'll reply within one business day.</p></div>
        <div className="flex gap-2"><ButtonLink href="/faq" variant="secondary">Read the FAQ</ButtonLink><ButtonLink href="/account/support">Open a ticket</ButtonLink></div>
      </div>
    </div>
  );
}
