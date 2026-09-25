import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyCapabilityFromDb } from "@/lib/auth/admin-access";
import { resolveCommercialSettings } from "@/lib/commercial/settings";
import {
  CommercialSettingsPanel,
  type AdminPlanRow,
} from "@/components/admin/commercial/commercial-settings-panel";

export const metadata = { title: "Commercial Settings" };
export const dynamic = "force-dynamic";

export default async function CommercialSettingsPage() {
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) redirect("/login");
  if (!(await verifyCapabilityFromDb(user, "commercial:manage"))) redirect("/admin");

  const admin = createAdminClient();
  const [settings, plans] = await Promise.all([
    admin.from("commercial_settings").select("key, value"),
    admin
      .from("plans")
      .select(
        "id, area, tier, name, plan_code, price_cents, compare_at_cents, duration_days, slot_capacity, monthly_activation_limit, promo_label, active, public, is_legacy"
      )
      .order("sort_order")
      .order("area"),
  ]);
  if (settings.error || plans.error) throw new Error("Unable to load commercial settings");

  return (
    <div className="space-y-6 p-4">
      <div>
        <h1 className="text-2xl font-bold">Commercial Settings</h1>
        <p className="text-sm text-muted-foreground">
          Prices, trial durations, programme ceilings, commission and fair-use limits. Every change
          needs a reason and is written to the audit log. 30-day trial capacity and toggles are
          managed in{" "}
          <Link className="underline" href="/admin/trials">
            Free Posts &amp; Trials
          </Link>
          .
        </p>
      </div>
      <CommercialSettingsPanel
        settings={resolveCommercialSettings(settings.data)}
        plans={(plans.data ?? []) as AdminPlanRow[]}
      />
    </div>
  );
}
