import { copy } from "@rasd/i18n";

export function Brand() {
  return <div className="brand-lockup"><div className="brand-mark">ر</div><div><div className="brand-name">{copy.brand}</div><div className="brand-sub">{copy.tagline}</div></div></div>;
}
