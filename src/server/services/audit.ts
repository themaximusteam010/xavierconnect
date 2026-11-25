import type { DbClient } from "@/server/db";
import { Prisma } from "@prisma/client";

const json = (v: unknown) =>
  v === undefined ? undefined : (JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x))) as Prisma.InputJsonValue);

export async function audit(
  db: DbClient,
  e: { actorId: string | null; action: string; entityType: string; entityId: string; before?: unknown; after?: unknown; ip?: string | null },
) {
  await db.auditLog.create({
    data: {
      actorId: e.actorId,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId,
      before: json(e.before),
      after: json(e.after),
      ipAddress: e.ip ?? null,
    },
  });
}
