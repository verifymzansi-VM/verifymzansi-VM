"use client";

import {
  ActionMessage,
  AdminCard,
  ReasonField,
  SubmitButton,
  readForm,
  useCommercialAction,
} from "./commercial-action";
import { formatPlanPrice } from "@/lib/constants/pricing";
import {
  COMMERCIAL_SETTING_LABELS,
  type CommercialSettingKey,
  type CommercialSettings,
} from "@/lib/commercial/settings";

export interface AdminPlanRow {
  id: string;
  area: string | null;
  tier: string;
  name: string;
  plan_code: string | null;
  price_cents: number;
  compare_at_cents: number | null;
  duration_days: number | null;
  slot_capacity: number | null;
  monthly_activation_limit: number | null;
  promo_label: string | null;
  active: boolean;
  public: boolean;
  is_legacy: boolean;
}

function humanize(key: string) {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

/** Renders one settings group as typed fields derived from its current value. */
function SettingForm({ settingKey, value }: { settingKey: CommercialSettingKey; value: object }) {
  const { run, busy, message } = useCommercialAction();

  function toValue(form: Record<string, string>, source: object, prefix = ""): object {
    const out: Record<string, unknown> = {};
    for (const [field, current] of Object.entries(source)) {
      const name = `${prefix}${field}`;
      if (typeof current === "boolean") out[field] = form[name] === "on";
      else if (typeof current === "number") out[field] = Number(form[name]);
      else if (Array.isArray(current))
        out[field] = (form[name] ?? "")
          .split(",")
          .map((part) => Number(part.trim()))
          .filter((n) => Number.isFinite(n) && n > 0);
      else if (current && typeof current === "object")
        out[field] = toValue(form, current, `${name}.`);
      else out[field] = form[name] ?? "";
    }
    return out;
  }

  function fields(source: object, prefix = ""): React.ReactNode {
    return Object.entries(source).map(([field, current]) => {
      const name = `${prefix}${field}`;
      if (current && typeof current === "object" && !Array.isArray(current)) {
        return (
          <fieldset
            key={name}
            className="col-span-full grid gap-3 rounded-lg border p-3 sm:grid-cols-3"
          >
            <legend className="px-1 text-xs font-semibold uppercase text-muted-foreground">
              {humanize(field)}
            </legend>
            {fields(current, `${name}.`)}
          </fieldset>
        );
      }
      if (typeof current === "boolean") {
        return (
          <label key={name} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name={name} defaultChecked={current} className="h-4 w-4" />
            {humanize(field)}
          </label>
        );
      }
      return (
        <label key={name} className="block text-sm">
          <span>{humanize(field)}</span>
          <input
            name={name}
            type={typeof current === "number" ? "number" : "text"}
            defaultValue={Array.isArray(current) ? current.join(", ") : String(current)}
            className="mt-1 block w-full rounded-md border bg-background p-2"
          />
        </label>
      );
    });
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = readForm(event.currentTarget);
        void run(
          {
            action: "settings.update",
            key: settingKey,
            value: toValue(form, value),
            reason: form.reason,
          },
          "Setting saved"
        );
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">{fields(value)}</div>
      <ReasonField />
      <SubmitButton busy={busy}>
        Save {COMMERCIAL_SETTING_LABELS[settingKey].toLowerCase()}
      </SubmitButton>
      <ActionMessage message={message} />
    </form>
  );
}

function PlanRowForm({ plan }: { plan: AdminPlanRow }) {
  const { run, busy, message } = useCommercialAction();
  return (
    <form
      className="grid gap-2 rounded-lg border p-3 sm:grid-cols-6 sm:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        const form = readForm(event.currentTarget);
        void run(
          {
            action: "plan.update",
            planId: plan.id,
            values: {
              priceCents: Math.round(Number(form.price) * 100),
              compareAtCents: form.compare ? Math.round(Number(form.compare) * 100) : null,
              slotCapacity: Number(form.slots),
              monthlyActivationLimit: Number(form.activations),
              promoLabel: form.label ?? "",
              active: form.active === "on",
            },
            reason: form.reason,
          },
          "Plan updated"
        );
      }}
    >
      <div className="sm:col-span-6">
        <p className="text-sm font-semibold">{plan.name}</p>
        <p className="text-xs text-muted-foreground">
          {plan.plan_code} · {plan.area ?? "All areas"} · {plan.duration_days} days · now{" "}
          {formatPlanPrice(plan.price_cents)}
        </p>
      </div>
      <label className="text-xs">
        Price (R)
        <input
          name="price"
          type="number"
          step="0.01"
          min={1}
          defaultValue={plan.price_cents / 100}
          className="mt-1 block w-full rounded-md border bg-background p-2 text-sm"
        />
      </label>
      <label className="text-xs">
        Compare at (R)
        <input
          name="compare"
          type="number"
          step="0.01"
          min={0}
          defaultValue={plan.compare_at_cents ? plan.compare_at_cents / 100 : ""}
          className="mt-1 block w-full rounded-md border bg-background p-2 text-sm"
        />
      </label>
      <label className="text-xs">
        Slots
        <input
          name="slots"
          type="number"
          min={1}
          defaultValue={plan.slot_capacity ?? 1}
          className="mt-1 block w-full rounded-md border bg-background p-2 text-sm"
        />
      </label>
      <label className="text-xs">
        Activations / 30 days
        <input
          name="activations"
          type="number"
          min={1}
          defaultValue={plan.monthly_activation_limit ?? 10}
          className="mt-1 block w-full rounded-md border bg-background p-2 text-sm"
        />
      </label>
      <label className="text-xs">
        Label
        <input
          name="label"
          maxLength={30}
          defaultValue={plan.promo_label ?? ""}
          className="mt-1 block w-full rounded-md border bg-background p-2 text-sm"
        />
      </label>
      <label className="flex items-center gap-2 text-xs">
        <input name="active" type="checkbox" defaultChecked={plan.active} className="h-4 w-4" />
        On sale
      </label>
      <div className="sm:col-span-4">
        <ReasonField />
      </div>
      <div className="sm:col-span-2">
        <SubmitButton busy={busy}>Update plan</SubmitButton>
      </div>
      <div className="sm:col-span-6">
        <ActionMessage message={message} />
      </div>
    </form>
  );
}

export function CommercialSettingsPanel({
  settings,
  plans,
}: {
  settings: CommercialSettings;
  plans: AdminPlanRow[];
}) {
  const retail = plans.filter((plan) => !plan.is_legacy && plan.tier !== "enterprise");
  const enterprise = plans.filter((plan) => plan.tier === "enterprise");
  const legacy = plans.filter((plan) => plan.is_legacy);

  return (
    <div className="space-y-6">
      <AdminCard
        title="Retail prices"
        description="One ladder for Market, Business and Tourism. Changes apply to new checkouts immediately; paid plans keep what customers paid."
      >
        <div className="space-y-3">
          {retail.map((plan) => (
            <PlanRowForm key={plan.id} plan={plan} />
          ))}
        </div>
      </AdminCard>

      <AdminCard
        title="Bulk active-slot plans"
        description="Self-checkout for 50–500 slots. 1,000+ is always quoted manually from Programmes & Contracts."
      >
        <details>
          <summary className="cursor-pointer text-sm font-medium">
            Edit {enterprise.length} bulk plans
          </summary>
          <div className="mt-3 space-y-3">
            {enterprise.map((plan) => (
              <PlanRowForm key={plan.id} plan={plan} />
            ))}
          </div>
        </details>
      </AdminCard>

      {(Object.keys(settings) as CommercialSettingKey[]).map((key) => (
        <AdminCard key={key} title={COMMERCIAL_SETTING_LABELS[key]}>
          <SettingForm settingKey={key} value={settings[key]} />
        </AdminCard>
      ))}

      <AdminCard
        title="Legacy plans"
        description="Retired Basic / Starter / Growth / Pro plans. Not for sale; existing customers keep them until their original expiry."
      >
        <ul className="grid gap-1 text-sm sm:grid-cols-2">
          {legacy.map((plan) => (
            <li key={plan.id} className="text-muted-foreground">
              {plan.name} — {formatPlanPrice(plan.price_cents)}
            </li>
          ))}
        </ul>
      </AdminCard>
    </div>
  );
}
