"use client";

import { ArrowRight, Check } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useActions } from "../../../../components/member/actions";
import { useMember } from "../../../../components/member/context";
import { SchoolEditor } from "../../../../components/member/school-editor";
import { ConfirmDelete } from "../../../../components/member/ui";

export default function SchoolPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { ws } = useMember();
  const { removeSchool } = useActions();
  const school = ws.schools.find(item => item.id === id);

  const back = <Link href="/cluster/schools" className="m-back"><ArrowRight aria-hidden />مدارسي</Link>;

  if (!school) {
    return (
      <div className="m-page">
        {back}
        <p className="m-lead">لم نجد هذه المدرسة — ربما حُذفت.</p>
        <Link href="/cluster/schools" className="btn btn-primary btn-lg btn-block">قائمة مدارسي</Link>
      </div>
    );
  }

  const remove = () => {
    router.replace("/cluster/schools");
    void removeSchool(school);
  };

  return (
    <div className="m-page">
      {back}
      <h1 className="sr-only">{school.name || "مدرسة بدون اسم"}</h1>
      <SchoolEditor school={school} />
      <div className="m-done-row">
        <Link href="/cluster/schools" className="btn btn-primary btn-lg"><Check aria-hidden />تم</Link>
        <ConfirmDelete variant="link" label="حذف هذه المدرسة" confirmLabel="نعم، احذفيها" onConfirm={remove} />
      </div>
    </div>
  );
}
