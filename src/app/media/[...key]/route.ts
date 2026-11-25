import { NextResponse } from "next/server";
import { MIME, readStored } from "@/server/storage";

/** Serves public uploads only. Private keys are unreachable because the "public/" prefix is forced. */
export async function GET(_: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key } = await params;
  const rel = key.join("/");
  if (rel.includes("..")) return new NextResponse("Not found", { status: 404 });
  try {
    const buf = await readStored(`public/${rel}`);
    const ext = rel.split(".").pop() ?? "";
    return new NextResponse(new Uint8Array(buf), {
      headers: { "Content-Type": MIME[ext] ?? "application/octet-stream", "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
