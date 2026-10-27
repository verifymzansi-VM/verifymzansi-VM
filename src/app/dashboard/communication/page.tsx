import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { CommunicationHub } from "@/components/dashboard/communication-hub";
import { getDataBackend } from "@/lib/data-backend";
import { readFoundationServerSession } from "@/lib/foundation/server-session";

export const metadata = {
  title: "Communication",
  description: "Manage your communication activity and preferences.",
};

export default async function CommunicationPage() {
  if (getDataBackend() === "foundation") await readFoundationServerSession();
  else {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) redirect("/login");
  }

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
