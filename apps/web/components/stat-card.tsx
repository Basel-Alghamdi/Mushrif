import { LucideIcon } from "lucide-react";

export function StatCard({ label, value, suffix, trend, icon: Icon, tone }: { label: string; value: string; suffix?: string; trend: string; icon: LucideIcon; tone?: string }) {
  return <article className="stat" style={{"--tone":tone} as React.CSSProperties}><div className="stat-top"><span>{label}</span><span className="stat-icon"><Icon size={17}/></span></div><strong>{value}</strong>{suffix && <small>{suffix}</small>}<span className="trend">↗ {trend}</span></article>;
}
