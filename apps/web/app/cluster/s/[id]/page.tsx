import { redirect } from "next/navigation";

export default function CustomSectionRedirect() {
  redirect("/cluster/profile");
}
