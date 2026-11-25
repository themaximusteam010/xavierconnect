/** Outbound provider HTTP with timeout and an IntegrationLog row per call (no bodies, no secrets). */
import { db } from "@/server/db";

export class ProviderHttpError extends Error {
  constructor(public provider: string, public status: number | null, message: string) { super(message); }
}

export async function providerFetch<T>(
  providerKey: string,
  operation: string,
  url: string,
  init: RequestInit & { timeoutMs?: number; reference?: string },
): Promise<T> {
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 20_000);
  let status: number | null = null;
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, cache: "no-store" });
    status = res.status;
    const text = await res.text();
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text.slice(0, 200) }; }
    if (!res.ok) {
      const msg = (body as { message?: string } | null)?.message ?? `HTTP ${res.status}`;
      throw new ProviderHttpError(providerKey, res.status, msg);
    }
    await log(providerKey, operation, "OK", status, Date.now() - started, init.reference);
    return body as T;
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "AbortError" ? "Timed out" : e.message) : String(e);
    await log(providerKey, operation, "ERROR", status, Date.now() - started, init.reference, msg);
    throw e instanceof ProviderHttpError ? e : new ProviderHttpError(providerKey, status, msg);
  } finally {
    clearTimeout(timer);
  }
}

export async function log(providerKey: string, operation: string, status: "OK" | "ERROR", httpStatus: number | null, durationMs: number, reference?: string, message?: string) {
  await db.integrationLog
    .create({ data: { providerKey, operation, status, httpStatus, durationMs, reference: reference ?? null, message: message?.slice(0, 500) ?? null } })
    .catch(() => {});
}
