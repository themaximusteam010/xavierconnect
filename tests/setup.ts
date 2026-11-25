import { config } from "node:process";
void config;
// Integration tests run against TEST_DATABASE_URL, never the dev database.
import { readFileSync } from "node:fs";
try {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
} catch {}
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.APP_SECRET ??= "test-secret-test-secret-test-secret-123";
