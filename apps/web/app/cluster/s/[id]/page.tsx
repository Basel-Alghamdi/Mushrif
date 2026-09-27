"use client";
import { useParams } from "next/navigation";
import { CustomSectionPage } from "../../../../components/member/custom-section-page";
export default function Page() { const { id } = useParams<{ id: string }>(); return <CustomSectionPage key={id} id={id}/>; }
