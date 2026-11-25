import { requireUser } from "@/server/auth/session";
import { Alert } from "@/components/ui/feedback";
import { Inbox } from "@/components/messaging/inbox";

export const metadata = { title: "Messages", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function Messages({ searchParams }: { searchParams: Promise<{ q?: string; archived?: string; error?: string }> }) {
  const user = await requireUser("/account/messages");
  const sp = await searchParams;
  return <>{sp.error && <Alert tone="warning" className="mb-4">{sp.error}</Alert>}<Inbox user={user} side="CUSTOMER" base="/account/messages" sp={sp} /></>;
}
