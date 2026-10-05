"use client";

import { ArrowRight, Check, ChevronLeft, Folder } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { filesCount, schoolFolderCounts } from "../../../../components/files/folder-browser";
import { useActions } from "../../../../components/member/actions";
import { useMember } from "../../../../components/member/context";
import { SchoolEditor } from "../../../../components/member/school-editor";
import { ConfirmDelete } from "../../../../components/member/ui";

export default function SchoolPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { ws, documents } = useMember();
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
      <section className="fb-school-folders" aria-labelledby="school-files">
        <h2 id="school-files">ملفات المدرسة</h2>
        <div className="fb-grid">
          {schoolFolderCounts(documents, school.id).map(folder => (
            <Link key={folder.key} href={`/cluster/files?s=${school.id}&f=${folder.key}`} className="fb-tile">
              <span className="fb-tile-icon" aria-hidden><Folder /></span>
              <span className="fb-tile-text"><b>{folder.label}</b><small>{filesCount(folder.count)}</small></span>
              <ChevronLeft className="fb-tile-go" aria-hidden />
            </Link>
          ))}
        </div>
      </section>
      <div className="m-done-row">
        <Link href="/cluster/schools" className="btn btn-primary btn-lg"><Check aria-hidden />تم</Link>
        <ConfirmDelete variant="link" label="حذف هذه المدرسة" confirmLabel="نعم، احذفيها" onConfirm={remove} />
      </div>
    </div>
  );
}
