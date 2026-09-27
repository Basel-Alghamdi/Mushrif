import { MemberWorkspace } from "../../../../components/member-workspace";
export default async function CustomSectionPage({params}:{params:Promise<{id:string}>}){const {id}=await params;return <MemberWorkspace initialPage={id}/>}
