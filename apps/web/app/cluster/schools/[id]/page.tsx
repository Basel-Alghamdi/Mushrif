"use client";

import type { School } from "@rasd/schemas";
import { ArrowRight, Check } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { SchoolEditor } from "../../../../components/member/school-editor";
import { ConfirmDelete } from "../../../../components/member/ui";
import { useWorkspace } from "../../../../components/member/workspace-context";

export default function SchoolPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { workspace, update, notify } = useWorkspace();
  const school = workspace.schools.find(item => item.id === id);

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

  const patch = (change: Partial<School>) =>
    update(current => ({
      ...current,
      schools: current.schools.map(item => (item.id === id ? { ...item, ...change, updatedAt: new Date().toISOString() } : item)),
    }));

  const remove = () => {
    update(current => ({ ...current, schools: current.schools.filter(item => item.id !== id) }));
    notify("حُذفت المدرسة");
    router.replace("/cluster/schools");
  };

  return (
    <div className="m-page">
      {back}
      <h1 className="sr-only">{school.name || "مدرسة بدون اسم"}</h1>
      <SchoolEditor school={school} onPatch={patch} />
      <div className="m-done-row">
        <Link href="/cluster/schools" className="btn btn-primary btn-lg"><Check aria-hidden />تم</Link>
        <ConfirmDelete variant="link" label="حذف هذه المدرسة" confirmLabel="نعم، احذفيها" onConfirm={remove} />
      </div>
    </div>
  );
}
