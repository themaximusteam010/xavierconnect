import { notFound } from "next/navigation";
import { FlaskConical } from "lucide-react";
import { db } from "@/server/db";
import { verifySigned } from "@/server/auth/tokens";
import { sandboxDecisionAction } from "@/app/actions/checkout";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Test payment", robots: { index: false } };

/** Simulated hosted payment page. Only reachable with a signed token minted by the sandbox provider. */
export default async function SandboxPay({ params, searchParams }: { params: Promise<{ reference: string }>; searchParams: Promise<{ t?: string }> }) {
  const { reference } = await params;
  const { t } = await searchParams;
  if (!t || verifySigned(t) !== reference) notFound();
  const p = await db.payment.findUnique({ where: { reference }, include: { order: true } });
  if (!p || p.provider !== "sandbox") notFound();
  return (
    <div className="container-x flex justify-center py-16">
      <div className="w-full max-w-md rounded-lg border border-line p-8">
        <div className="mb-6 flex items-center gap-2 rounded-md bg-warning-soft px-3 py-2 text-[13px] text-warning"><FlaskConical className="size-4" />Sandbox payment — no money moves</div>
        <p className="text-sm text-ink-muted">Order {p.order.number}</p>
        <p className="tabular mt-1 text-3xl font-semibold">{formatMoney(p.amountMinor)}</p>
        <p className="mt-1 text-[13px] text-ink-muted">Reference {p.reference}</p>
        {p.status !== "INITIATED" ? (
          <p className="mt-6 text-sm">This payment is already {p.status.toLowerCase()}.</p>
        ) : (
          <form action={sandboxDecisionAction} className="mt-8 grid grid-cols-2 gap-3">
            <input type="hidden" name="reference" value={reference} /><input type="hidden" name="t" value={t} />
            <SubmitButton name="outcome" value="decline" variant="secondary">Decline</SubmitButton>
            <SubmitButton name="outcome" value="approve">Approve payment</SubmitButton>
          </form>
        )}
      </div>
    </div>
  );
}
