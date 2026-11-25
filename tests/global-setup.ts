/**
 * Integration tests run in a fresh, uniquely-named Postgres schema created for this run
 * (non-destructive: nothing pre-existing is reset or truncated). The schema is dropped on teardown.
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

function readEnv() {
  const env: Record<string, string> = {};
  try {
    for (const line of readFileSync(".env", "utf8").split("\n")) {
      const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
      if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
    }
  } catch {}
  return env;
}

export default function setup() {
  const env = readEnv();
  const base = process.env.TEST_DATABASE_URL ?? env.TEST_DATABASE_URL;
  if (!base) throw new Error("TEST_DATABASE_URL is required for integration tests");
  if (base === (process.env.DATABASE_URL ?? env.DATABASE_URL)) throw new Error("TEST_DATABASE_URL must differ from DATABASE_URL");
  const schema = `t_${Date.now().toString(36)}_${process.pid}`;
  const url = `${base}${base.includes("?") ? "&" : "?"}schema=${schema}`;
  execSync("npx prisma migrate deploy", { stdio: "pipe", env: { ...process.env, DATABASE_URL: url } });
  writeFileSync("node_modules/.xc-test-db-url", url);
  return () => {
    // Drop only the schema this run created.
    execSync(`npx prisma db execute --stdin --url "${base}"`, { input: `DROP SCHEMA IF EXISTS "${schema}" CASCADE;`, stdio: "pipe" });
  };
}
