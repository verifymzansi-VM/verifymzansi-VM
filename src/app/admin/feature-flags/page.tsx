import { requireStaff } from "@/lib/auth/require-staff";
import { PageHeader } from "@/components/layout/page-header";
import { getAllFeatureFlags } from "@/lib/services/feature-flags";
import { FeatureFlagsClient } from "./feature-flags-client";

export const metadata = {
  title: "Feature flags — Admin",
  description: "Toggle platform features on or off for gradual rollouts.",
};

export default async function FeatureFlagsPage() {
  const { user } = await requireStaff("feature_flag:toggle");

  const flags = await getAllFeatureFlags();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Feature flags"
        description="Toggle features for phased rollouts."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Feature flags" }]}
      />

      <FeatureFlagsClient key={user.id} initialFlags={flags} />
    </div>
  );
}
