import { afterAll, beforeAll, describe, expect, it } from "vitest";
import net from "node:net";
import sharp from "sharp";
import QRCode from "qrcode";
import { inspectAttachment, AttachmentError, clamavScan } from "@/server/moderation/attachments";

const textImage = (text: string, w = 1000) =>
  sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="220"><rect width="100%" height="100%" fill="#f4efe6"/><rect x="30" y="20" width="160" height="180" fill="#b33"/><text x="220" y="125" font-size="44" font-family="sans-serif" fill="#111">${text}</text></svg>`)).jpeg().toBuffer();

describe("Test 12: image attachment moderation (OCR + QR)", () => {
  it("approves an ordinary product photo with product text", async () => {
    const r = await inspectAttachment("image/jpeg", await textImage("Red wrap dress, size 12"));
    expect(r.status).toBe("APPROVED");
    expect(r.scanner).toContain("ocr");
  }, 60_000);
  it("blocks a phone number written in an image", async () => {
    const r = await inspectAttachment("image/jpeg", await textImage("WhatsApp 0803 123 4567"));
    expect(r.status).toBe("BLOCKED");
    expect(r.findings.map((f) => f.category)).toContain("PHONE");
  }, 60_000);
  it("blocks an email address written in an image", async () => {
    const r = await inspectAttachment("image/jpeg", await textImage("ada.stores@gmail.com"));
    expect(r.status).toBe("BLOCKED");
    expect(r.findings.map((f) => f.category)).toContain("EMAIL");
  }, 60_000);
  it("blocks an image containing a QR code", async () => {
    const qr = await QRCode.toBuffer("https://wa.me/2348031234567", { width: 260, margin: 2 });
    const photo = await sharp({ create: { width: 900, height: 600, channels: 3, background: "#ddd" } }).composite([{ input: qr, left: 600, top: 300 }]).png().toBuffer();
    const r = await inspectAttachment("image/png", photo);
    expect(r.status).toBe("BLOCKED");
    expect(r.findings.map((f) => f.category)).toContain("QR_CODE");
  }, 60_000);
  it("re-encodes images, removing metadata and appended data", async () => {
    const img = await sharp(await textImage("plain")).withMetadata({ exif: { IFD0: { Copyright: "secret-gps" } } }).jpeg().toBuffer();
    const r = await inspectAttachment("image/jpeg", Buffer.concat([img, Buffer.from("<?php evil() ?>")]));
    expect(r.output.includes(Buffer.from("evil()"))).toBe(false);
    expect((await sharp(r.output).metadata()).exif).toBeUndefined();
  }, 60_000);
  it("rejects files whose bytes don't match the declared type, and unsupported types", async () => {
    await expect(inspectAttachment("image/png", Buffer.from("MZ not an image"))).rejects.toThrow(AttachmentError);
    await expect(inspectAttachment("application/x-msdownload", Buffer.from("MZ"))).rejects.toThrow(AttachmentError);
  });
  it("holds PDFs for a moderator", async () => {
    const r = await inspectAttachment("application/pdf", Buffer.from("%PDF-1.4\n%fake\n"));
    expect(r.status).toBe("REVIEW");
  });
});

describe("malware scanning via clamd INSTREAM", () => {
  let server: net.Server; let lastBytes = 0;
  beforeAll(async () => {
    server = net.createServer((s) => {
      const chunks: Buffer[] = [];
      s.on("data", (d) => {
        chunks.push(d);
        const all = Buffer.concat(chunks);
        if (all.length >= 14 && all.subarray(all.length - 4).equals(Buffer.alloc(4))) {
          lastBytes = all.length;
          s.end(all.includes(Buffer.from("EICAR-TEST")) ? "stream: Eicar-Test-Signature FOUND\0" : "stream: OK\0");
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    process.env.CLAMAV_HOST = "127.0.0.1"; process.env.CLAMAV_PORT = String((server.address() as net.AddressInfo).port);
  });
  afterAll(() => { delete process.env.CLAMAV_HOST; delete process.env.CLAMAV_PORT; server.close(); });
  it("reports clean and infected streams", async () => {
    expect(await clamavScan(Buffer.from("hello"))).toMatchObject({ configured: true, clean: true });
    expect(lastBytes).toBe(10 + 4 + 5 + 4);
    expect(await clamavScan(Buffer.from("x EICAR-TEST x"))).toMatchObject({ clean: false, signature: "Eicar-Test-Signature" });
  });
  it("blocks an infected PDF", async () => {
    const r = await inspectAttachment("application/pdf", Buffer.from("%PDF-1.4 EICAR-TEST"));
    expect(r.status).toBe("BLOCKED");
  });
});
