import Link from "next/link";
import { ContactForm } from "@/components/contact-form";
export const metadata = { title: "Contact us" };
export default function Contact() {
  return (
    <div className="container-x grid max-w-5xl gap-12 py-12 lg:grid-cols-[1fr_1.2fr]">
      <div>
        <h1 className="text-3xl font-semibold">Contact us</h1>
        <p className="mt-3 text-[15px] leading-7 text-ink-2">For help with an order, the fastest route is <Link href="/account/support" className="text-brand underline">opening a support ticket</Link> from your account — it links straight to your order.</p>
        <p className="mt-4 text-[15px] leading-7 text-ink-2">For partnerships, press or anything else, send us a message.</p>
      </div>
      <ContactForm />
    </div>
  );
}
