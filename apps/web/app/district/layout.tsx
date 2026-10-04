import type { Metadata, Viewport } from "next";
import { DistrictShell } from "../../components/district/shell";
import "./district.css";

export const metadata: Metadata = { title: "رَصد | المساعد" };

// "resizes-content" makes Android shrink the layout when the keyboard opens, so the composer stays visible.
export const viewport: Viewport = {
  themeColor: "#009688", width: "device-width", initialScale: 1, viewportFit: "cover", interactiveWidget: "resizes-content",
};

export default function DistrictLayout({ children }: { children: React.ReactNode }) {
  return <DistrictShell>{children}</DistrictShell>;
}
