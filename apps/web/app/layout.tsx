import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "رَصد | منصة الإشراف المدرسي",
  description: "منصة عربية ذكية لمتابعة أعمال الإشراف المدرسي",
  manifest: "/manifest.webmanifest",
};
export const viewport: Viewport = { themeColor: "#16483f", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ar" dir="rtl"><body>{children}</body></html>;
}
