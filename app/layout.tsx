import type { Metadata } from "next";
import { DM_Sans, DM_Mono, Fraunces } from "next/font/google";
import { MetaPixel } from "@/components/MetaPixel";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const dmMono = DM_Mono({
  variable: "--font-dm-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "ToRay — Free Instant AI Billing Scanner",
  description:
    "Upload an OpenAI or Anthropic usage screenshot and see your AI spend in seconds. Free scanner for up to 3 tools; ToRay Pro unlocks unlimited tracking, Pro Vision, outlook, and CSV.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const metaPixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID?.trim() ?? "";

  return (
    <html
      lang="en"
      className={`${dmSans.variable} ${dmMono.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        {metaPixelId ? <MetaPixel pixelId={metaPixelId} /> : null}
        {children}
      </body>
    </html>
  );
}
