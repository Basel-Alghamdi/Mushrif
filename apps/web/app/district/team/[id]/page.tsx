"use client";

import { useParams } from "next/navigation";
import { MemberProfile } from "../../../../components/district/member-profile";

export default function MemberProfilePage() {
  const { id } = useParams<{ id: string }>();
  return <MemberProfile key={id} memberId={id} />;
}
