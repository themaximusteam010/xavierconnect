import { requireVendor } from "@/server/auth/session";
import { Inbox } from "@/components/messaging/inbox";

export const metadata = { title: "Messages", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function Conversation({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string; archived?: string; product?: string; order?: string }> }) {
  const { user } = await requireVendor("messages");
  return <Inbox user={user} side="VENDOR" base="/vendor/messages" conversationId={(await params).id} sp={await searchParams} />;
}
