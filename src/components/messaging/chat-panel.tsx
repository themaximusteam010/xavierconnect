"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Archive, Ban, Check, CheckCheck, Clock, FileText, Flag, ImagePlus, MoreHorizontal, Paperclip, Send, ShieldAlert, X } from "lucide-react";
import type { MessageDTO } from "@/server/services/messaging";

type Side = "CUSTOMER" | "VENDOR";
export interface ChatProps {
  conversationId: string;
  side: Side;
  title: string;
  subtitle?: string;
  titleHref?: string;
  backHref: string;
  initialMessages: MessageDTO[];
  initialOnline: boolean;
  initialBlocked: { byMe: boolean; byThem: boolean };
  archived: boolean;
  context?: { kind: "product" | "order" | "service"; label: string; sub?: string; href: string; image?: string | null } | null;
  pendingRef?: { productId?: string; orderId?: string; label: string } | null;
  reportReasons: readonly string[];
  restriction?: string | null;
}

const BLOCK_TEXT = "Your message may contain contact information or an external payment request that cannot be shared through XavierConnect. Please edit your message and continue your conversation here.";
const naira = (minor: string) => `₦${(Number(BigInt(minor)) / 100).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" });
const day = (iso: string) => {
  const d = new Date(iso), today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-NG", { weekday: "short", day: "numeric", month: "short", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
};

async function post(url: string, body: unknown) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { ok: r.ok, data: await r.json().catch(() => ({})) };
}

export function ChatPanel(p: ChatProps) {
  const [messages, setMessages] = useState<MessageDTO[]>(p.initialMessages);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [ref, setRef] = useState(p.pendingRef ?? null);
  const [sending, setSending] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(p.restriction ?? null);
  const [error, setError] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [online, setOnline] = useState(p.initialOnline);
  const [otherRead, setOtherRead] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(p.initialBlocked);
  const [menu, setMenu] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [hasMore, setHasMore] = useState(p.initialMessages.length >= 60);
  const listRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const lastTyping = useRef(0);
  const api = `/api/messages/${p.conversationId}`;

  const merge = useCallback((incoming: MessageDTO[]) => {
    setMessages((cur) => {
      const map = new Map(cur.map((m) => [m.id, m]));
      for (const m of incoming) map.set(m.id, { ...map.get(m.id), ...m });
      return [...map.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    });
  }, []);

  const markRead = useCallback(() => { if (document.visibilityState === "visible") void post(`${api}/read`, { side: p.side }); }, [api, p.side]);

  // Live updates over Server-Sent Events (reconnects automatically; the server re-authorises every tick).
  useEffect(() => {
    let es: EventSource | null = null;
    let stopped = false;
    let after = new Date().toISOString();
    const open = () => {
      if (stopped) return;
      es = new EventSource(`${api}/stream?side=${p.side}&after=${encodeURIComponent(after)}`);
      es.addEventListener("messages", (e) => {
        const msgs = JSON.parse((e as MessageEvent).data) as MessageDTO[];
        const last = (e as MessageEvent).lastEventId; if (last) after = last;
        merge(msgs);
        if (msgs.some((m) => !m.mine)) { setTyping(false); markRead(); }
      });
      es.addEventListener("state", (e) => {
        const s = JSON.parse((e as MessageEvent).data);
        setTyping(s.typing); setOnline(s.online); setOtherRead(s.otherLastReadAt);
      });
      es.addEventListener("end", (e) => { const r = JSON.parse((e as MessageEvent).data); if (r.reason !== "error") { stopped = true; es?.close(); } });
    };
    open();
    markRead();
    const onVis = () => markRead();
    document.addEventListener("visibilitychange", onVis);
    return () => { stopped = true; es?.close(); document.removeEventListener("visibilitychange", onVis); };
  }, [api, p.side, merge, markRead]);

  // Read ticks from the other side's read position.
  const withReceipts = messages.map((m) => (m.mine && otherRead && m.deliveredAt && otherRead >= m.deliveredAt ? { ...m, read: true } : m));

  useEffect(() => {
    const el = listRef.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, typing]);

  async function loadOlder() {
    const first = messages[0];
    if (!first) return;
    const r = await fetch(`${api}/history?side=${p.side}&before=${encodeURIComponent(first.createdAt)}`);
    const d = await r.json();
    const el = listRef.current; const h = el?.scrollHeight ?? 0;
    merge(d.messages);
    setHasMore(d.messages.length >= 40);
    requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - h; });
  }

  function onType(v: string) {
    setText(v);
    if (warning) setWarning(null);
    if (Date.now() - lastTyping.current > 3000 && v.trim()) { lastTyping.current = Date.now(); void post(`${api}/typing`, { side: p.side }); }
  }

  async function send() {
    if (sending || (!text.trim() && !files.length)) return;
    setSending(true); setError(null); setWarning(null);
    const fd = new FormData();
    fd.set("body", text); fd.set("side", p.side);
    if (ref?.productId) fd.set("productId", ref.productId);
    if (ref?.orderId) fd.set("orderId", ref.orderId);
    for (const f of files) fd.append("files", f);
    try {
      const r = await fetch(`${api}/send`, { method: "POST", body: fd });
      const d = await r.json().catch(() => ({ error: "Something went wrong. Try again." }));
      if (d.status === "BLOCKED") {
        // Keep the draft so the sender can edit it; nothing was delivered.
        setWarning(d.warning ?? BLOCK_TEXT);
        if (d.notice) setNotice(d.notice);
      } else if (r.ok && d.message) {
        atBottom.current = true;
        merge([d.message]);
        setText(""); setFiles([]); setRef(null);
        lastTyping.current = 0; // the server cleared our typing state; signal again on the next keystroke
        if (d.attachmentNotice) setError(d.attachmentNotice);
        if (d.status === "HELD") setError("Your message will be delivered after a quick review by our team.");
        if (d.notice) setNotice(d.notice);
      } else {
        setError(d.error ?? "Message not sent. Try again.");
        if (d.code === "RESTRICTED") setNotice(d.error);
      }
    } catch { setError("You appear to be offline. Your message was not sent."); }
    setSending(false);
  }

  async function action(op: string, body: Record<string, string> = {}) {
    setMenu(false);
    const r = await post(`${api}/${op}`, { side: p.side, ...body });
    if (!r.ok) { setError(r.data.error ?? "That didn't work."); return false; }
    if (op === "block") setBlocked((b) => ({ ...b, byMe: true }));
    if (op === "unblock") setBlocked((b) => ({ ...b, byMe: false }));
    if (op === "archive" || op === "unarchive") window.location.href = p.backHref;
    return true;
  }

  const cannotSend = blocked.byMe || blocked.byThem;
  let lastDay = "";

  return (
    <section className="flex h-[calc(100dvh-8.5rem)] min-h-[480px] flex-col rounded-lg border border-line bg-white lg:h-[calc(100dvh-11rem)]" aria-label={`Conversation with ${p.title}`}>
      <header className="flex items-center gap-3 border-b border-line px-3 py-2.5 sm:px-4">
        <Link href={p.backHref} className="-ml-1 rounded-md p-1.5 text-ink-muted hover:bg-sunken lg:hidden" aria-label="Back to conversations"><ArrowLeft className="size-5" /></Link>
        <div className="relative grid size-9 shrink-0 place-items-center rounded-full bg-brand-soft text-[13px] font-semibold text-brand">
          {p.title.slice(0, 1).toUpperCase()}
          {online && <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-white bg-success" title="Online now" />}
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          {p.titleHref ? <Link href={p.titleHref} className="block truncate text-[15px] font-semibold hover:text-brand">{p.title}</Link> : <p className="truncate text-[15px] font-semibold">{p.title}</p>}
          <p className="truncate text-[12px] text-ink-muted">{typing ? <span className="text-brand">typing…</span> : online ? "Online now" : p.subtitle}</p>
        </div>
        <div className="relative">
          <button onClick={() => setMenu((m) => !m)} className="rounded-md p-2 text-ink-muted hover:bg-sunken" aria-label="Conversation options" aria-expanded={menu}><MoreHorizontal className="size-5" /></button>
          {menu && (
            <div className="absolute right-0 top-10 z-20 w-52 rounded-md border border-line bg-white py-1 text-[13px] shadow-lg" role="menu">
              <button role="menuitem" onClick={() => action(p.archived ? "unarchive" : "archive")} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-sunken"><Archive className="size-4" />{p.archived ? "Move to inbox" : "Archive"}</button>
              <button role="menuitem" onClick={() => action(blocked.byMe ? "unblock" : "block")} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-sunken"><Ban className="size-4" />{blocked.byMe ? "Unblock" : p.side === "CUSTOMER" ? "Block this store" : "Block this customer"}</button>
              <button role="menuitem" onClick={() => { setReporting(true); setMenu(false); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-danger hover:bg-sunken"><Flag className="size-4" />Report conversation</button>
            </div>
          )}
        </div>
      </header>

      {p.context && (
        <Link href={p.context.href} className="flex items-center gap-3 border-b border-line bg-canvas px-4 py-2 text-[13px] hover:bg-sunken">
          {p.context.image ? <img src={p.context.image} alt="" className="size-9 rounded object-cover" /> : <span className="grid size-9 place-items-center rounded bg-white text-ink-muted"><FileText className="size-4" /></span>}
          <span className="min-w-0"><span className="block truncate font-medium">{p.context.label}</span>{p.context.sub && <span className="block truncate text-ink-muted">{p.context.sub}</span>}</span>
        </Link>
      )}

      <div ref={listRef} onScroll={(e) => { const el = e.currentTarget; atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }} className="flex-1 space-y-1 overflow-y-auto px-3 py-4 sm:px-5" aria-live="polite">
        {hasMore && <div className="pb-2 text-center"><button onClick={loadOlder} className="text-[12px] text-brand hover:underline">Load earlier messages</button></div>}
        {withReceipts.length === 0 && (
          <div className="mx-auto mt-10 max-w-sm text-center text-[13px] text-ink-muted">
            <p className="font-medium text-ink">Start the conversation</p>
            <p className="mt-1">Ask about sizes, availability, delivery or your order. Keep payments and contact on XavierConnect so your purchase stays protected.</p>
          </div>
        )}
        {withReceipts.map((m) => {
          const d = day(m.createdAt);
          const sep = d !== lastDay; lastDay = d;
          return (
            <div key={m.id}>
              {sep && <p className="my-3 text-center text-[11px] font-medium uppercase tracking-wider text-ink-muted">{d}</p>}
              <div className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] sm:max-w-[70%] ${m.mine ? "items-end" : "items-start"} flex flex-col gap-1`}>
                  {m.product && (
                    <a href={`/p/${m.product.slug}`} className={`flex w-64 items-center gap-2 rounded-md border p-2 text-[12px] ${m.mine ? "border-brand/30 bg-brand-soft/60" : "border-line bg-canvas"}`}>
                      {m.product.image ? <img src={m.product.image} alt="" className="size-10 rounded object-cover" /> : <span className="size-10 rounded bg-sunken" />}
                      <span className="min-w-0"><span className="block truncate font-medium">{m.product.name}</span><span className="tabular text-ink-muted">{naira(m.product.priceMinor)}</span></span>
                    </a>
                  )}
                  {m.order?.number && <span className={`rounded-md border px-2 py-1 text-[12px] ${m.mine ? "border-brand/30 bg-brand-soft/60" : "border-line bg-canvas"}`}>Order <span className="font-medium">{m.order.number}</span></span>}
                  {m.attachments.map((a) => a.url && a.mimeType.startsWith("image/") ? (
                    <a key={a.id} href={a.url} target="_blank" rel="noopener" className="block overflow-hidden rounded-md border border-line"><img src={a.url} alt={a.fileName} className="max-h-60 max-w-64 object-cover" loading="lazy" /></a>
                  ) : (
                    <span key={a.id} className="flex items-center gap-2 rounded-md border border-line bg-white px-2.5 py-2 text-[12px]">
                      <FileText className="size-4 text-ink-muted" />
                      {a.url ? <a href={a.url} className="font-medium text-brand hover:underline">{a.fileName}</a> : <span>{a.fileName}</span>}
                      {a.status !== "APPROVED" && <span className="text-ink-muted">{a.status === "BLOCKED" ? "· not sent" : "· safety check"}</span>}
                    </span>
                  ))}
                  {m.body && <p className={`whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-[14px] leading-snug ${m.mine ? "rounded-br-md bg-brand text-white" : "rounded-bl-md bg-sunken text-ink"} ${m.status === "HELD" ? "opacity-70" : ""}`}>{m.body}</p>}
                  <span className="flex items-center gap-1 px-1 text-[11px] text-ink-muted">
                    {!m.mine && p.side === "VENDOR" ? null : null}
                    {time(m.createdAt)}
                    {m.mine && (m.status === "HELD" ? <><Clock className="size-3" /> In review</> : m.read ? <><CheckCheck className="size-3.5 text-brand" /> Read</> : <><Check className="size-3.5" /> Sent</>)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
        {typing && <div className="flex justify-start"><span className="rounded-2xl rounded-bl-md bg-sunken px-3.5 py-2.5"><span className="flex gap-1">{[0, 1, 2].map((i) => <span key={i} className="size-1.5 animate-bounce rounded-full bg-ink-muted" style={{ animationDelay: `${i * 120}ms` }} />)}</span></span></div>}
      </div>

      <footer className="border-t border-line p-2.5 sm:p-3">
        {notice && <p className="mb-2 flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-[12px] text-warning"><ShieldAlert className="mt-0.5 size-4 shrink-0" />{notice}</p>}
        {warning && (
          <div role="alert" className="mb-2 flex items-start gap-2 rounded-md border border-red-200 bg-danger-soft px-3 py-2 text-[13px] text-danger">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" /><span>{warning}</span>
          </div>
        )}
        {error && <p className="mb-2 flex items-center justify-between gap-2 rounded-md bg-sunken px-3 py-2 text-[12px] text-ink-2">{error}<button onClick={() => setError(null)} aria-label="Dismiss"><X className="size-3.5" /></button></p>}
        {cannotSend ? (
          <p className="rounded-md bg-sunken px-3 py-3 text-center text-[13px] text-ink-muted">{blocked.byMe ? <>You blocked this conversation. <button onClick={() => action("unblock")} className="text-brand underline">Unblock</button> to send messages.</> : "You can't reply to this conversation."}</p>
        ) : (
          <>
            {(ref || files.length > 0) && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {ref && <span className="flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-1 text-[12px] text-brand">About: {ref.label}<button onClick={() => setRef(null)} aria-label="Remove reference"><X className="size-3" /></button></span>}
                {files.map((f, i) => <span key={i} className="flex items-center gap-1 rounded-full bg-sunken px-2.5 py-1 text-[12px]"><Paperclip className="size-3" />{f.name.slice(0, 24)}<button onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}><X className="size-3" /></button></span>)}
              </div>
            )}
            <div className="flex items-end gap-1.5">
              <label className="cursor-pointer rounded-md p-2 text-ink-muted hover:bg-sunken" title="Attach photos or a PDF (max 4 MB each)">
                <ImagePlus className="size-5" /><span className="sr-only">Attach files</span>
                <input type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={(e) => { const add = [...(e.target.files ?? [])]; setFiles((f) => [...f, ...add].slice(0, 4)); e.target.value = ""; }} />
              </label>
              <textarea
                value={text} onChange={(e) => onType(e.target.value)} rows={1} maxLength={2000} placeholder="Write a message…" aria-label="Message"
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}
                className={`max-h-36 min-h-10 flex-1 resize-none rounded-2xl border bg-white px-3.5 py-2 text-[14px] focus:outline-none ${warning ? "border-danger" : "border-line-strong focus:border-brand"}`}
                style={{ height: Math.min(144, 40 + Math.max(0, text.split("\n").length - 1) * 20) }}
              />
              <button onClick={send} disabled={sending || (!text.trim() && !files.length)} className="grid size-10 shrink-0 place-items-center rounded-full bg-brand text-white disabled:opacity-40" aria-label="Send message"><Send className="size-4" /></button>
            </div>
            <p className="mt-1.5 px-1 text-[11px] text-ink-muted">Messages are checked automatically. Don&apos;t share phone numbers, emails or payment details — pay only through XavierConnect checkout.</p>
          </>
        )}
      </footer>

      {reporting && <ReportDialog reasons={p.reportReasons} onClose={() => setReporting(false)} onSubmit={async (reason, details) => { if (await action("report", { reason, details })) { setReporting(false); setError("Thanks — our team will review this conversation."); } }} />}
    </section>
  );
}

function ReportDialog({ reasons, onClose, onSubmit }: { reasons: readonly string[]; onClose: () => void; onSubmit: (reason: string, details: string) => void }) {
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-black/40 sm:place-items-center" role="dialog" aria-modal="true" aria-labelledby="report-title">
      <div className="w-full max-w-md rounded-t-xl bg-white p-5 sm:rounded-xl">
        <h2 id="report-title" className="font-semibold">Report this conversation</h2>
        <p className="mt-1 text-[13px] text-ink-muted">A member of our trust team will review the conversation. Only reported conversations are reviewed by staff.</p>
        <fieldset className="mt-4 space-y-2 text-[14px]">
          {reasons.map((r) => <label key={r} className="flex items-center gap-2"><input type="radio" name="reason" value={r} checked={reason === r} onChange={() => setReason(r)} />{r}</label>)}
        </fieldset>
        <textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={3} maxLength={1000} placeholder="Anything else we should know (optional)" className="mt-3 w-full rounded-md border border-line-strong px-3 py-2 text-[14px]" />
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="h-9 rounded-md px-3 text-[14px] text-ink-2 hover:bg-sunken">Cancel</button>
          <button disabled={!reason} onClick={() => onSubmit(reason, details)} className="h-9 rounded-md bg-danger px-3 text-[14px] font-medium text-white disabled:opacity-40">Send report</button>
        </div>
      </div>
    </div>
  );
}
