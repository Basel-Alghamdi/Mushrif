import { ArrowRight } from "lucide-react";
import Link from "next/link";

// Shown the moment she taps a member, while the profile's code arrives (the same skeleton as MemberProfile's).
export default function Loading() {
  return (
    <div className="d-page mp" aria-label="جارٍ التحميل">
      <Link href="/district/team" className="mp-back"><ArrowRight /> الفريق والأرقام</Link>
      <i className="skeleton mp-skeleton-head" />
      <i className="skeleton mp-skeleton-tabs" />
      <div className="mp-fields">{Array.from({ length: 6 }, (_, index) => <i key={index} className="skeleton mp-skeleton-field" />)}</div>
    </div>
  );
}
