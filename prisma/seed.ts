/**
 *   npm run db:seed                 → roles, admin, categories, commission, plans, CMS content
 *   SEED_DEMO=true npm run db:seed  → also creates demo stores and listings named "(Demo)"
 */
import { PrismaClient } from "@prisma/client";
import { runSeed } from "./seed-lib";

const db = new PrismaClient();
runSeed(db, {
  adminEmail: process.env.SEED_ADMIN_EMAIL,
  adminPassword: process.env.SEED_ADMIN_PASSWORD,
  demo: process.env.SEED_DEMO === "true",
  demoPassword: process.env.SEED_DEMO_PASSWORD,
  writeLocalFiles: (process.env.STORAGE_DRIVER ?? "local") === "local",
})
  .then(() => console.log("Seed complete."))
  .finally(() => db.$disconnect());
