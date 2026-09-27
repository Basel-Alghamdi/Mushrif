import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "رَصد | منصة متابعة الفريق التنفيذي",
  description: "منصة عربية لإدارة ملفات العناقيد ومتابعة أعمال الفريق التنفيذي",
  manifest: "/manifest.webmanifest",
};
export const viewport: Viewport = { themeColor: "#009688", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ar" dir="rtl"><body>{children}</body></html>;
}
