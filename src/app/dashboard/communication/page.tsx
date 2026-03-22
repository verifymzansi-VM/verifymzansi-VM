import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { CommunicationHub } from "@/components/dashboard/communication-hub";

export const metadata = {
  title: "Communication",
  description: "Manage your communication activity and preferences.",
};

export default async function CommunicationPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Communication"
        description="Track account communication and manage optional preferences."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Communication" }]}
      />
      <CommunicationHub />
    </div>
  );
}
