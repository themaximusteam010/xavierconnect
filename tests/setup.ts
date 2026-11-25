import { existsSync, readFileSync } from "node:fs";
try {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
} catch {}
// Never point tests at the development database.
if (existsSync("node_modules/.xc-test-db-url")) process.env.DATABASE_URL = readFileSync("node_modules/.xc-test-db-url", "utf8");
process.env.APP_SECRET ??= "test-secret-test-secret-test-secret-123";
