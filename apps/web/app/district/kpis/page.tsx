"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { KpisPage } from "../../../components/district/kpis/kpis-page";

/** /district/kpis — the register. `?q=` opens it searched (a member's school links here with its ministry number). */
function Register() {
  const router = useRouter();
  const params = useSearchParams();
  const [query] = useState(() => params.get("q") ?? "");

  useEffect(() => {
    if (params.get("q")) router.replace("/district/kpis", { scroll: false });
  }, [params, router]);

  return <KpisPage initialQuery={query} />;
}

export default function KpisRoute() {
  return <Suspense fallback={null}><Register /></Suspense>;
}
