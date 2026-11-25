import { NextResponse } from "next/server";
import { messagingUser, messagingError } from "@/server/messaging-http";
import { loadMessages, markRead, reportConversation, sendMessage, setArchived, setBlocked, setTyping, authorize, touchPresence, type IncomingFile, type Side } from "@/server/services/messaging";

export const runtime = "nodejs";
export const maxDuration = 60; // OCR of up to four images

const side = (v: unknown): Side | undefined => (v === "VENDOR" || v === "CUSTOMER" ? v : undefined);

/** POST /api/messages/:id/{send|read|typing|archive|unarchive|block|unblock|report} */
export async function POST(req: Request, { params }: { params: Promise<{ id: string; op: string }> }) {
  const { id, op } = await params;
  const u = await messagingUser(req);
  if (u instanceof NextResponse) return u;
  try {
    if (op === "send") {
      const fd = await req.formData();
      const files: IncomingFile[] = [];
      for (const f of fd.getAll("files")) if (f instanceof File && f.size > 0) files.push({ name: f.name, type: f.type, bytes: Buffer.from(await f.arrayBuffer()) });
      const r = await sendMessage(u, id, { body: String(fd.get("body") ?? ""), productId: (fd.get("productId") as string) || null, orderId: (fd.get("orderId") as string) || null, files, side: side(fd.get("side")) });
      await touchPresence(u.id);
      return NextResponse.json(r, { status: r.status === "BLOCKED" ? 422 : 200 });
    }
    const body = (await req.json().catch(() => ({}))) as Record<string, string>;
    const s = side(body.side);
    if (op === "read") await markRead(u, id, s);
    else if (op === "typing") await setTyping(u, id, s);
    else if (op === "archive" || op === "unarchive") await setArchived(u, id, op === "archive", s);
    else if (op === "block" || op === "unblock") await setBlocked(u, id, op === "block", s);
    else if (op === "report") await reportConversation(u, id, { reason: body.reason, details: body.details, messageId: body.messageId || undefined, side: s });
    else return NextResponse.json({ error: "Unknown action" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) { return messagingError(e); }
}

/** GET /api/messages/:id/history?before=ISO&side= — older messages for infinite scroll. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string; op: string }> }) {
  const { id, op } = await params;
  if (op !== "history") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const u = await messagingUser(req);
  if (u instanceof NextResponse) return u;
  try {
    const url = new URL(req.url);
    const { side: s } = await authorize(u, id, side(url.searchParams.get("side")));
    const before = url.searchParams.get("before");
    const messages = await loadMessages(u, id, s, { before: before ? new Date(before) : undefined, take: 40 });
    return NextResponse.json({ messages }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) { return messagingError(e); }
}
