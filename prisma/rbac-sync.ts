import type { PrismaClient } from "@prisma/client";
import { PERMISSIONS, ROLES } from "../src/server/auth/rbac";

/** Sync the role/permission catalogue from code into the database. Idempotent. */
export async function syncRbac(db: PrismaClient) {
  for (const [key, name] of Object.entries(PERMISSIONS)) {
    await db.permission.upsert({ where: { key }, update: { name }, create: { key, name } });
  }
  for (const [key, def] of Object.entries(ROLES)) {
    const role = await db.role.upsert({ where: { key }, update: { name: def.name, isStaff: def.staff }, create: { key, name: def.name, isStaff: def.staff } });
    await db.rolePermission.deleteMany({ where: { roleId: role.id } });
    for (const p of def.permissions) {
      const perm = await db.permission.findUniqueOrThrow({ where: { key: p } });
      await db.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id } });
    }
  }
}
