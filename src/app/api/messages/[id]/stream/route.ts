import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { messagingUser, messagingError } from "@/server/messaging-http";
import { authorize, syncState, touchPresence, unreadCounts, type Side } from "@/server/services/messaging";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TICK_MS = 1500;
const LIFETIME_MS = 25_000; // the browser's EventSource reconnects automatically

/**
 * Server-Sent Events for one open conversation. Every tick re-checks the session and the
 * participant authorisation, so revoking access (sign-out, suspension, block) takes effect within
 * seconds. Only content the user may see (loadMessages rules) is ever written to the stream.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await messagingUser(req);
  if (u instanceof NextResponse) return u;
  const url = new URL(req.url);
  const want = url.searchParams.get("side");
  let side: Side;
  try { side = (await authorize(u, id, want === "VENDOR" || want === "CUSTOMER" ? want : undefined)).side; } catch (e) { return messagingError(e); }
  const lastId = req.headers.get("last-event-id") ?? url.searchParams.get("after");
  let cursor = lastId && !Number.isNaN(Date.parse(lastId)) ? new Date(lastId) : new Date();
  const enc = new TextEncoder();
  const started = Date.now();
  let closed = false;
  req.signal.addEventListener("abort", () => { closed = true; });

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown, idStr?: string) => controller.enqueue(enc.encode(`${idStr ? `id: ${idStr}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      controller.enqueue(enc.encode(`retry: 2000\n\n`));
      let tick = 0;
      try {
        while (!closed && Date.now() - started < LIFETIME_MS) {
          // Session still valid?
          const s = await db.session.findUnique({ where: { id: u.sessionId }, select: { expiresAt: true, user: { select: { status: true } } } });
          if (!s || s.expiresAt < new Date() || s.user.status !== "ACTIVE") { send("end", { reason: "signed-out" }); break; }
          const tickStart = new Date();
          const st = await syncState(u, id, side, cursor);
          if (st.messages.length) {
            const latest = st.messages.reduce((a, m) => (m.deliveredAt && m.deliveredAt > a ? m.deliveredAt : a), cursor.toISOString());
            cursor = new Date(Math.min(new Date(latest).getTime(), tickStart.getTime()));
            send("messages", st.messages, cursor.toISOString());
          }
          send("state", { otherLastReadAt: st.otherLastReadAt, typing: st.typing, online: st.online, blocked: st.blocked });
          if (tick % 4 === 0) { await touchPresence(u.id); send("unread", await unreadCounts(u).then((c) => ({ customer: c.customer, vendor: c.vendor }))); }
          tick++;
          await new Promise((r) => setTimeout(r, TICK_MS));
        }
      } catch (e) {
        send("end", { reason: e instanceof Error && e.message.includes("not found") ? "forbidden" : "error" });
      }
      try { controller.close(); } catch { /* already closed */ }
    },
    cancel() { closed = true; },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
}
