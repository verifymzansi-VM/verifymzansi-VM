import { redirect } from "next/navigation";
import { readFoundationServerUser } from "@/lib/foundation/server-session";
import { PageHeader } from "@/components/layout/page-header";
import { CommunicationHub } from "@/components/dashboard/communication-hub";

export const metadata = {
  title: "Communication",
  description: "Manage your communication activity and preferences.",
};

export default async function CommunicationPage() {
  // The account the sign-in gate already verified for this request.
  const user = await readFoundationServerUser();

  if (!user) redirect("/login");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description="Updates and what we may send you."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Notifications" }]}
      />
      <CommunicationHub />
    </div>
  );
}
