"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/session";
import { approveHeld, liftRestriction, rejectHeld, resolveReport, restrictUser, reviewAttachment, saveRule, toggleRule, ModerationError, RULE_KINDS } from "@/server/services/moderation-admin";

const to = (tab: string, k: "ok" | "error", m: string, extra = "") => { revalidatePath("/admin", "layout"); redirect(`/admin/communication/moderation?tab=${tab}${extra}&${k}=${encodeURIComponent(m)}`); };
async function run(tab: string, fn: () => Promise<unknown>, ok: string, extra = "") {
  try { await fn(); } catch (e) { if (e instanceof ModerationError) to(tab, "error", e.message, extra); throw e; }
  to(tab, "ok", ok, extra);
}

export async function heldDecisionAction(fd: FormData) {
  const u = await requirePermission("messages.moderate");
  const id = String(fd.get("id")); const note = String(fd.get("note") ?? "").trim();
  if (fd.get("decision") === "approve") await run("review", () => approveHeld(u.id, id, note), "Message delivered.");
  else await run("review", () => rejectHeld(u.id, id, { note, violation: fd.get("violation") === "on" }), "Message not delivered.");
}

export async function attachmentDecisionAction(fd: FormData) {
  const u = await requirePermission("messages.moderate");
  const decision = fd.get("decision") === "approve" ? "APPROVED" : "BLOCKED";
  await run("attachments", () => reviewAttachment(u.id, String(fd.get("id")), decision, { note: String(fd.get("note") ?? ""), violation: fd.get("violation") === "on" }), decision === "APPROVED" ? "Attachment released to the recipient." : "Attachment blocked and deleted.");
}

export async function resolveReportAction(fd: FormData) {
  const u = await requirePermission("messages.moderate");
  await run("reports", () => resolveReport(u.id, String(fd.get("id")), fd.get("status") === "DISMISSED" ? "DISMISSED" : "RESOLVED", String(fd.get("resolution") ?? "")), "Report closed.");
}

export async function restrictUserAction(fd: FormData) {
  const u = await requirePermission("messages.moderate");
  const hours = Number(fd.get("hours"));
  await run("users", () => restrictUser(u.id, String(fd.get("userId")), hours > 0 ? Math.min(hours, 24 * 90) : null, String(fd.get("reason") ?? "")), "Messaging restricted.");
}

export async function liftRestrictionAction(fd: FormData) {
  const u = await requirePermission("messages.moderate");
  await run("users", () => liftRestriction(u.id, String(fd.get("id"))), "Restriction lifted.");
}

export async function saveRuleAction(fd: FormData) {
  const u = await requirePermission("messages.moderate");
  const kind = String(fd.get("kind")) as keyof typeof RULE_KINDS;
  if (!(kind in RULE_KINDS)) to("rules", "error", "Choose a rule type.");
  await run("rules", () => saveRule(u.id, kind, String(fd.get("value") ?? ""), String(fd.get("note") ?? "")), "Rule saved. It applies to new messages within 30 seconds.");
}

export async function toggleRuleAction(fd: FormData) {
  const u = await requirePermission("messages.moderate");
  await run("rules", () => toggleRule(u.id, String(fd.get("id"))), "Rule updated.");
}
