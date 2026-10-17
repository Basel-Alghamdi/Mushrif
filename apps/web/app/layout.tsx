import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Arabic } from "next/font/google";
import "./globals.css";

// Served with the app (downloaded at build time): no request to Google before the first text can show.
const plex = IBM_Plex_Sans_Arabic({ subsets: ["arabic"], weight: ["400", "500", "600", "700"], display: "swap", variable: "--font-plex" });

export const metadata: Metadata = {
  title: "رَصد | منصة متابعة الفريق التنفيذي",
  description: "منصة عربية لمتابعة ملفات المشرفات وأعمال الفريق التنفيذي مع مساعد ذكي لرئيسة النطاق",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "رَصد", statusBarStyle: "default" },
};
// "resizes-content": the layout shrinks when the phone keyboard opens, so fixed bars and composers stay visible.
export const viewport: Viewport = { themeColor: "#009688", width: "device-width", initialScale: 1, viewportFit: "cover", interactiveWidget: "resizes-content" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ar" dir="rtl" className={plex.variable}><body>{children}</body></html>;
}
