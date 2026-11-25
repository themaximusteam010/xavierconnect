/**
 * Attachment inspection, run before any recipient can access a file.
 *
 * 1. Type/size validation by declared MIME *and* file signature (JPG, PNG, WebP, PDF only).
 * 2. Malware scan through ClamAV (clamd INSTREAM) when CLAMAV_HOST is configured.
 * 3. Images: decoded and re-encoded (strips metadata and appended payloads), then OCR (Tesseract,
 *    bundled English data, no network) and QR decoding (jsQR); recognised text goes through the same
 *    text detectors as messages. Any QR code blocks the image.
 * 4. PDFs: no text extraction is available here, so they are always held for a moderator (REVIEW).
 * Fail closed: any error or timeout gives REVIEW, never APPROVED.
 */
import net from "node:net";
import path from "node:path";
import sharp, { type Sharp } from "sharp";
import jsQR from "jsqr";
import { moderateText, type Finding, type RuleSet } from "./detect";

export const ATTACHMENT_LIMIT_BYTES = 4 * 1024 * 1024; // Vercel request bodies are capped at ~4.5 MB
export const ALLOWED_ATTACHMENTS: Record<string, { ext: string; magic: (b: Buffer) => boolean; image: boolean }> = {
  "image/jpeg": { ext: "jpg", image: true, magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "image/png": { ext: "png", image: true, magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  "image/webp": { ext: "webp", image: true, magic: (b) => b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP" },
  "application/pdf": { ext: "pdf", image: false, magic: (b) => b.subarray(0, 4).toString() === "%PDF" },
};

export class AttachmentError extends Error {}

export interface Inspection {
  status: "APPROVED" | "REVIEW" | "BLOCKED";
  findings: (Finding | { category: string; severity: "BLOCK" | "REVIEW"; hint: string })[];
  scanner: string;
  output: Buffer; // the bytes to store (re-encoded for images)
  mimeType: string;
}

export function validateAttachment(mime: string, buf: Buffer) {
  const t = ALLOWED_ATTACHMENTS[mime];
  if (!t) throw new AttachmentError("Attach a JPG, PNG or WebP image, or a PDF.");
  if (buf.length === 0) throw new AttachmentError("That file is empty.");
  if (buf.length > ATTACHMENT_LIMIT_BYTES) throw new AttachmentError("Attachments must be 4 MB or smaller.");
  if (!t.magic(buf)) throw new AttachmentError("That file's contents don't match its type.");
  return t;
}

// ─── Malware scanning (ClamAV clamd, INSTREAM command) ──────────────────────

export async function clamavScan(buf: Buffer): Promise<{ configured: boolean; clean?: boolean; signature?: string; error?: string }> {
  const host = process.env.CLAMAV_HOST;
  if (!host) return { configured: false };
  const port = Number(process.env.CLAMAV_PORT ?? 3310);
  return new Promise((resolve) => {
    const sock = net.createConnection({ host, port });
    let reply = "";
    const done = (r: { configured: boolean; clean?: boolean; signature?: string; error?: string }) => { sock.destroy(); resolve(r); };
    sock.setTimeout(20_000, () => done({ configured: true, error: "timeout" }));
    sock.on("error", (e) => done({ configured: true, error: e.message }));
    sock.on("data", (d) => { reply += d.toString(); });
    sock.on("end", () => {
      const r = reply.replace(/\0/g, "").trim(); // e.g. "stream: OK" or "stream: Eicar-Signature FOUND"
      if (/:\s*OK$/.test(r)) done({ configured: true, clean: true });
      else if (/FOUND$/.test(r)) done({ configured: true, clean: false, signature: r.replace(/^.*?:\s*/, "").replace(/\s*FOUND$/, "") });
      else done({ configured: true, error: r || "no reply" });
    });
    sock.on("connect", () => {
      sock.write("zINSTREAM\0");
      for (let i = 0; i < buf.length; i += 64 * 1024) {
        const chunk = buf.subarray(i, i + 64 * 1024);
        const len = Buffer.alloc(4); len.writeUInt32BE(chunk.length);
        sock.write(len); sock.write(chunk);
      }
      sock.write(Buffer.alloc(4)); // zero-length chunk ends the stream
    });
  });
}

// ─── OCR and QR ──────────────────────────────────────────────────────────────

type OcrWorker = { recognize: (b: Buffer) => Promise<{ data: { text: string } }>; terminate: () => Promise<unknown> };
let workerPromise: Promise<OcrWorker> | null = null;
async function ocrWorker(): Promise<OcrWorker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      // Bundled English model (traced into the deployment by next.config outputFileTracingIncludes).
      const langPath = path.join(process.cwd(), "node_modules", "@tesseract.js-data", "eng", "4.0.0_best_int");
      return (await createWorker("eng", 1, { langPath, gzip: true, cachePath: "/tmp/xc-tesseract" })) as unknown as OcrWorker;
    })().catch((e) => { workerPromise = null; throw e; });
  }
  return workerPromise;
}

const withTimeout = <T>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

export async function ocrText(png: Buffer): Promise<string> {
  const w = await ocrWorker();
  const r = await withTimeout(w.recognize(png), 20_000);
  return r.data.text;
}

export async function decodeQr(img: Sharp): Promise<string | null> {
  // Try at the stored size and at a normalised width; QR codes in photos are often small.
  for (const width of [undefined, 1000, 600]) {
    const pipeline = width ? img.clone().resize({ width, withoutEnlargement: false }) : img.clone();
    const { data, info } = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const code = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), info.width, info.height, { inversionAttempts: "attemptBoth" });
    if (code) return code.data;
  }
  return null;
}

export async function inspectAttachment(mime: string, input: Buffer, opts: { rules?: RuleSet; ownHosts?: string[] } = {}): Promise<Inspection> {
  const t = validateAttachment(mime, input);
  const findings: Inspection["findings"] = [];
  const scanners: string[] = [];

  const av = await clamavScan(input);
  if (av.configured) {
    scanners.push("clamav");
    if (av.clean === false) return { status: "BLOCKED", findings: [{ category: "MALWARE", severity: "BLOCK", hint: av.signature ?? "detected" }], scanner: "clamav", output: input, mimeType: mime };
    if (av.error) findings.push({ category: "SCAN_ERROR", severity: "REVIEW", hint: "malware scan unavailable" });
  }

  if (!t.image) {
    findings.push({ category: "DOCUMENT", severity: "REVIEW", hint: "PDFs are checked by a moderator before delivery" });
    return { status: "REVIEW", findings, scanner: scanners.join("+") || "none", output: input, mimeType: mime };
  }

  let output: Buffer, outMime: string;
  try {
    const img = sharp(input, { failOn: "error", limitInputPixels: 40_000_000 }).rotate();
    const meta = await img.metadata();
    if (!meta.width || !meta.height) throw new Error("no dimensions");
    // Re-encode: drops EXIF/GPS and anything appended to the file. Large images are capped at 2000 px.
    const base = img.clone().resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true });
    output = mime === "image/png" ? await base.png().toBuffer() : await base.jpeg({ quality: 85 }).toBuffer();
    outMime = mime === "image/png" ? "image/png" : "image/jpeg";
    scanners.push("reencode");

    const qr = await decodeQr(sharp(output));
    scanners.push("qr");
    if (qr !== null) findings.push({ category: "QR_CODE", severity: "BLOCK", hint: "image contains a QR code" });

    const forOcr = await sharp(output).greyscale().normalize().resize({ width: 1600, withoutEnlargement: false }).png().toBuffer();
    const text = await ocrText(forOcr);
    scanners.push("ocr");
    const r = moderateText(`${text}\n${qr ?? ""}`, { rules: opts.rules, ownHosts: opts.ownHosts });
    findings.push(...r.findings);
  } catch (e) {
    findings.push({ category: "INSPECTION_FAILED", severity: "REVIEW", hint: (e as Error).message.slice(0, 60) });
    return { status: "REVIEW", findings, scanner: scanners.join("+") || "none", output: input, mimeType: mime };
  }
  const status = findings.some((f) => f.severity === "BLOCK") ? "BLOCKED" : findings.length ? "REVIEW" : "APPROVED";
  return { status, findings, scanner: scanners.join("+"), output, mimeType: outMime };
}
