import { ArrowRight } from "lucide-react";
import Link from "next/link";

// Shown the moment she opens a school, while the editor's code arrives (her data is already loaded).
export default function Loading() {
  return (
    <div className="m-page" aria-label="جارٍ التحميل">
      <Link href="/cluster/schools" className="m-back"><ArrowRight aria-hidden />مدارسي</Link>
      {Array.from({ length: 4 }, (_, index) => <i key={index} className="skeleton fb-skeleton" />)}
    </div>
  );
}
