import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { getAllFeatureFlags } from "@/lib/services/feature-flags";
import { FeatureFlagsClient } from "./feature-flags-client";
import { isAdmin } from "@/lib/auth/roles";

export const metadata = {
  title: "Feature Flags — Admin",
};

export default async function FeatureFlagsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !isAdmin(user)) {
    redirect("/dashboard");
  }

  const flags = await getAllFeatureFlags();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Feature Flags"
        description="Toggle features on or off for phased rollouts."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Feature Flags" }]}
      />

      <FeatureFlagsClient initialFlags={flags} />
    </div>
  );
}
