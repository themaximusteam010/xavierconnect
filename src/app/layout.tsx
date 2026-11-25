import type { Metadata, Viewport } from "next";
import "./globals.css";

const url = process.env.APP_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(url),
  title: { default: "XavierConnect — Products, services and digital goods from independent sellers", template: "%s · XavierConnect" },
  description: "Discover products, book services and buy digital goods from verified independent businesses across Nigeria. Connecting people. Empowering businesses.",
  applicationName: "XavierConnect",
  openGraph: { type: "website", siteName: "XavierConnect", locale: "en_NG" },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = { themeColor: "#1d4ed8", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-NG">
      <body className="min-h-dvh">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:shadow-pop">Skip to content</a>
        {children}
      </body>
    </html>
  );
}
