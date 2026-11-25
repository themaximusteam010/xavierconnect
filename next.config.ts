import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const config: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["@node-rs/argon2", "tesseract.js", "sharp"],
  // OCR language data is read from node_modules at runtime (no CDN download); make sure it is deployed.
  outputFileTracingIncludes: { "/api/messages/**": ["./node_modules/@tesseract.js-data/eng/4.0.0_best_int/**", "./node_modules/tesseract.js-core/**", "./node_modules/tesseract.js/src/worker-script/**"] },
  // Default is 1 MB, too small for product photos. Vercel caps request bodies at ~4.5 MB.
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};
export default config;
