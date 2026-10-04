"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { displayName } from "../../components/member/model";
import { AbsenceCard, RecentVisits, SetupCard } from "../../components/member/today";
import { useVisits, VisitSheet } from "../../components/member/visits";
import { useWorkspace } from "../../components/member/workspace-context";
import { firstName } from "../../lib/format";

export default function TodayPage() {
  const { user, workspace } = useWorkspace();
  const { visits, add } = useVisits();
  const [logging, setLogging] = useState(false);

  return (
    <div className="m-page">
      <h1 className="m-hello">أهلاً {firstName(displayName(workspace, user.name))}</h1>
      <SetupCard />
      <AbsenceCard />
      <button type="button" className="btn btn-primary btn-lg btn-block" onClick={() => setLogging(true)}>
        <Plus aria-hidden />سجّلي زيارة
      </button>
      <RecentVisits visits={visits} />
      {logging && <VisitSheet onClose={() => setLogging(false)} onSaved={add} />}
    </div>
  );
}
