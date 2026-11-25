/**
 * Notifications: in-app rows + email via an outbox table.
 * EMAIL_TRANSPORT=console logs the email and marks it SENT (development).
 * EMAIL_TRANSPORT=smtp is not wired yet — emails stay PENDING in the outbox for a worker to send.
 */
import type { DbClient } from "@/server/db";

export async function notify(
  db: DbClient,
  n: { userId: string; type: string; title: string; body: string; link?: string; email?: boolean },
) {
  const prefs = await db.notificationPreference.findMany({ where: { userId: n.userId, type: n.type } });
  const enabled = (channel: string) => prefs.find((p) => p.channel === channel)?.enabled ?? true;
  if (enabled("in_app")) {
    await db.notification.create({ data: { userId: n.userId, type: n.type, title: n.title, body: n.body, link: n.link } });
  }
  if (n.email !== false && enabled("email")) {
    const user = await db.user.findUnique({ where: { id: n.userId }, select: { email: true } });
    if (user) await sendEmail(db, { to: user.email, subject: n.title, text: `${n.body}${n.link ? `\n\n${appUrl(n.link)}` : ""}` });
  }
}

export const appUrl = (path: string) => `${process.env.APP_URL ?? "http://localhost:3000"}${path}`;

export async function sendEmail(db: DbClient, m: { to: string; subject: string; text: string }) {
  const transport = process.env.EMAIL_TRANSPORT ?? "console";
  const row = await db.emailOutbox.create({ data: { to: m.to, subject: m.subject, text: m.text } });
  if (transport === "console") {
    if (process.env.NODE_ENV !== "test" && !process.env.VITEST) {
      console.info(`[email] to=${m.to} subject="${m.subject}"\n${m.text}\n`);
    }
    await db.emailOutbox.update({ where: { id: row.id }, data: { status: "SENT", sentAt: new Date(), attempts: 1 } });
  }
  return row;
}
