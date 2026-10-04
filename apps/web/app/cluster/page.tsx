"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { useMember } from "../../components/member/context";
import { displayName } from "../../components/member/model";
import { AbsenceCard, RecentVisits, SetupCard } from "../../components/member/today";
import { VisitSheet } from "../../components/member/visits";
import { firstName } from "../../lib/format";

export default function TodayPage() {
  const { me, ws } = useMember();
  const [logging, setLogging] = useState(false);

  return (
    <div className="m-page">
      <h1 className="m-hello">أهلاً {firstName(displayName(ws, me.name))}</h1>
      <SetupCard />
      <AbsenceCard />
      <button type="button" className="btn btn-primary btn-lg btn-block" onClick={() => setLogging(true)}>
        <Plus aria-hidden />سجّلي زيارة
      </button>
      <RecentVisits />
      {logging && <VisitSheet onClose={() => setLogging(false)} />}
    </div>
  );
}
