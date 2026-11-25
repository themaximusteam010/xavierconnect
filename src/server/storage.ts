/**
 * File storage. STORAGE_DRIVER=local writes under ./storage/{public,private}.
 * Public files are served by /media/<key>; private files are never served directly —
 * only through authorised routes such as /download/<grantId>.
 * STORAGE_DRIVER=db stores bytes in the StoredFile table (used on Vercel, whose disk is read-only).
 * An S3/R2 driver can implement the same functions for large-scale use (see docs/ARCHITECTURE.md).
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "@/server/db";

const DRIVER = process.env.STORAGE_DRIVER ?? "local";

const ROOT = path.resolve(process.cwd(), "storage");

const IMAGE_TYPES: Record<string, { ext: string; magic: (b: Buffer) => boolean }> = {
  "image/jpeg": { ext: "jpg", magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "image/png": { ext: "png", magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  "image/webp": { ext: "webp", magic: (b) => b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP" },
};
const DOC_TYPES: Record<string, { ext: string; magic: (b: Buffer) => boolean }> = {
  ...IMAGE_TYPES,
  "application/pdf": { ext: "pdf", magic: (b) => b.subarray(0, 4).toString() === "%PDF" },
};
const ZIP = { ext: "zip", magic: (b: Buffer) => b[0] === 0x50 && b[1] === 0x4b };

export class UploadError extends Error {}

function safeKey(key: string) {
  const full = path.resolve(ROOT, key);
  if (!full.startsWith(ROOT + path.sep)) throw new UploadError("Invalid storage key");
  return full;
}

async function put(visibility: "public" | "private", folder: string, ext: string, buf: Buffer) {
  const key = `${visibility}/${folder}/${randomUUID()}.${ext}`;
  if (DRIVER === "db") {
    await db.storedFile.create({ data: { key, mimeType: MIME[ext] ?? "application/octet-stream", size: buf.length, data: new Uint8Array(buf) } });
    return key;
  }
  const full = safeKey(key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, buf);
  return key;
}

/** Product/store image. Validates declared type AND file signature; 5 MB limit. */
export async function saveImage(file: File, folder: string) {
  const t = IMAGE_TYPES[file.type];
  if (!t) throw new UploadError("Use a JPG, PNG or WebP image.");
  if (file.size > 5 * 1024 * 1024) throw new UploadError("Images must be 5 MB or smaller.");
  const buf = Buffer.from(await file.arrayBuffer());
  if (!t.magic(buf)) throw new UploadError("That file is not a valid image.");
  const key = await put("public", folder, t.ext, buf);
  return { key, url: `/media/${key.slice("public/".length)}` };
}

/** KYC documents: private, PDF or image, 10 MB. */
export async function savePrivateDocument(file: File, folder: string) {
  const t = DOC_TYPES[file.type];
  if (!t) throw new UploadError("Upload a PDF, JPG or PNG.");
  if (file.size > 10 * 1024 * 1024) throw new UploadError("Documents must be 10 MB or smaller.");
  const buf = Buffer.from(await file.arrayBuffer());
  if (!t.magic(buf)) throw new UploadError("That file does not match its type.");
  return { key: await put("private", folder, t.ext, buf), size: buf.length };
}

/** Paid digital goods: private; PDF, ZIP or image; 200 MB. */
export async function saveDigitalAsset(file: File, folder: string) {
  const t = file.type === "application/zip" || file.type === "application/x-zip-compressed" ? ZIP : DOC_TYPES[file.type];
  if (!t) throw new UploadError("Upload a PDF, ZIP or image file.");
  if (file.size > 200 * 1024 * 1024) throw new UploadError("Files must be 200 MB or smaller.");
  const buf = Buffer.from(await file.arrayBuffer());
  if (!t.magic(buf)) throw new UploadError("That file does not match its type.");
  return { key: await put("private", folder, t.ext, buf), size: buf.length, ext: t.ext };
}

export async function readStored(key: string): Promise<Buffer> {
  if (DRIVER === "db") {
    const f = await db.storedFile.findUnique({ where: { key } });
    if (!f) throw new Error("not found");
    return Buffer.from(f.data);
  }
  return readFile(safeKey(key));
}

export const MIME: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf", zip: "application/zip", txt: "text/plain" };
