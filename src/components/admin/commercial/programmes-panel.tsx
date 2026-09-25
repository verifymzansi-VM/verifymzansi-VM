"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatPlanPrice } from "@/lib/constants/pricing";
import type { CommercialSettings } from "@/lib/commercial/settings";
import {
  ActionMessage,
  AdminCard,
  ReasonField,
  SubmitButton,
  optionalInt,
  readForm,
  useCommercialAction,
} from "./commercial-action";

export interface ProgrammeAccount {
  user_id: string;
  display_name: string;
  email: string | null;
  trialEntitlement: string;
}

export interface ProgrammeContract {
  id: string;
  contract_type: string;
  user_id: string | null;
  organisation_id: string | null;
  title: string;
  status: string;
  slot_capacity: number;
  activation_limit_total: number | null;
  activation_limit_per_period: number | null;
  activation_period_days: number;
  admin_limit: number;
  price_cents: number;
  starts_at: string;
  ends_at: string;
  notes: string | null;
  holderName: string | null;
  activeUsage: number;
  activationCount: number;
  delegateIds: string[];
}

const TYPE_LABELS: Record<string, string> = {
  STRATEGIC_INDIVIDUAL: "Strategic Individual",
  FOUNDING_COMMERCIAL_PARTNER: "Founding Commercial Partner",
  FOUNDING_ORGANISATION: "Founding Organisation",
  ENTERPRISE_CUSTOM: "Custom enterprise contract",
};

const date = new Intl.DateTimeFormat("en-ZA", {
  dateStyle: "medium",
  timeZone: "Africa/Johannesburg",
});

function GrantForm({
  account,
  settings,
}: {
  account: ProgrammeAccount;
  settings: CommercialSettings;
}) {
  const { run, busy, message } = useCommercialAction();
  const [type, setType] = useState("STRATEGIC_INDIVIDUAL");
  const defaults =
    type === "STRATEGIC_INDIVIDUAL"
      ? { days: settings.strategic.durationDays, slots: settings.strategic.slotCapacity }
      : type === "FOUNDING_COMMERCIAL_PARTNER"
        ? {
            days: settings.founding_commercial.durationDays,
            slots: settings.founding_commercial.slotCapacity,
          }
        : { days: 365, slots: 1000 };
  const used = account.trialEntitlement !== "NONE";

  return (
    <form
      className="space-y-3 rounded-lg border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = readForm(event.currentTarget);
        void run(
          {
            action: "programme.grant",
            userId: account.user_id,
            type,
            override: form.override === "on",
            values: {
              title: form.title || undefined,
              durationDays: optionalInt(form.days),
              slotCapacity: optionalInt(form.slots),
              activationLimitTotal: optionalInt(form.activationTotal),
              activationsPerPeriod: optionalInt(form.activationsPerPeriod),
              adminLimit: optionalInt(form.adminLimit),
              priceCents: form.price ? Math.round(Number(form.price) * 100) : undefined,
              notes: form.notes || undefined,
            },
            reason: form.reason,
          },
          "Programme granted"
        );
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-semibold">{account.display_name || "Unnamed account"}</p>
        <Badge variant={used ? "secondary" : "outline"}>
          Free programme: {account.trialEntitlement}
        </Badge>
      </div>
      <p className="break-all text-xs text-muted-foreground">
        {account.email ?? "No sign-in email"} · {account.user_id}
      </p>
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="text-sm sm:col-span-2">
          Programme
          <select
            value={type}
            onChange={(event) => setType(event.target.value)}
            className="mt-1 block w-full rounded-md border bg-background p-2"
          >
            <option value="STRATEGIC_INDIVIDUAL">Strategic Individual (3 months, 1 slot)</option>
            <option value="FOUNDING_COMMERCIAL_PARTNER">
              Founding Commercial Partner (6 months, 25 slots)
            </option>
            <option value="ENTERPRISE_CUSTOM">Custom enterprise contract (quoted)</option>
          </select>
        </label>
        <label className="text-sm sm:col-span-2">
          Title (optional)
          <input
            name="title"
            maxLength={160}
            className="mt-1 block w-full rounded-md border bg-background p-2"
          />
        </label>
        <label className="text-sm">
          Duration (days)
          <input
            key={`d-${type}`}
            name="days"
            type="number"
            min={7}
            defaultValue={defaults.days}
            className="mt-1 block w-full rounded-md border bg-background p-2"
          />
        </label>
        <label className="text-sm">
          Active slots
          <input
            key={`s-${type}`}
            name="slots"
            type="number"
            min={1}
            defaultValue={defaults.slots}
            className="mt-1 block w-full rounded-md border bg-background p-2"
          />
        </label>
        {type === "STRATEGIC_INDIVIDUAL" ? (
          <label className="text-sm">
            Total activations
            <input
              name="activationTotal"
              type="number"
              min={1}
              defaultValue={settings.strategic.activationLimitTotal}
              className="mt-1 block w-full rounded-md border bg-background p-2"
            />
          </label>
        ) : (
          <label className="text-sm">
            Activations / 30 days
            <input
              key={`a-${type}`}
              name="activationsPerPeriod"
              type="number"
              min={1}
              defaultValue={
                type === "FOUNDING_COMMERCIAL_PARTNER"
                  ? settings.founding_commercial.activationsPerPeriod
                  : 2000
              }
              className="mt-1 block w-full rounded-md border bg-background p-2"
            />
          </label>
        )}
        <label className="text-sm">
          Administrators
          <input
            key={`m-${type}`}
            name="adminLimit"
            type="number"
            min={1}
            max={50}
            defaultValue={
              type === "FOUNDING_COMMERCIAL_PARTNER" ? settings.founding_commercial.adminLimit : 1
            }
            className="mt-1 block w-full rounded-md border bg-background p-2"
          />
        </label>
        {type === "ENTERPRISE_CUSTOM" ? (
          <label className="text-sm">
            Contract value (R)
            <input
              name="price"
              type="number"
              min={0}
              step="0.01"
              className="mt-1 block w-full rounded-md border bg-background p-2"
            />
          </label>
        ) : null}
        <label className="text-sm sm:col-span-4">
          Internal notes
          <textarea
            name="notes"
            maxLength={2000}
            rows={2}
            className="mt-1 block w-full rounded-md border bg-background p-2"
          />
        </label>
      </div>
      {used && type !== "ENTERPRISE_CUSTOM" ? (
        <label className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm dark:bg-amber-950/30">
          <input type="checkbox" name="override" className="mt-1 h-4 w-4" />
          This identity already used {account.trialEntitlement}. Grant anyway (stacking override —
          the reason is audited).
        </label>
      ) : null}
      <ReasonField />
      <SubmitButton busy={busy}>Grant programme</SubmitButton>
      <ActionMessage message={message} />
    </form>
  );
}

function TrialOverrideForm({ account }: { account: ProgrammeAccount }) {
  const { run, busy, message } = useCommercialAction();
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const form = readForm(event.currentTarget);
        void run(
          {
            action: "trial.override",
            userId: account.user_id,
            kind: form.kind,
            reason: form.reason,
          },
          "Trial entitlement updated"
        );
      }}
    >
      <label className="text-sm">
        Set free-programme record
        <select
          name="kind"
          defaultValue={account.trialEntitlement}
          className="mt-1 block rounded-md border bg-background p-2"
        >
          {[
            "NONE",
            "PUBLIC_7_DAY",
            "PUBLIC_30_DAY",
            "STRATEGIC_INDIVIDUAL",
            "FOUNDING_COMMERCIAL_PARTNER",
            "SPONSORED_ORGANISATION_MEMBER",
          ].map((kind) => (
            <option key={kind} value={kind}>
              {kind}
            </option>
          ))}
        </select>
      </label>
      <div className="min-w-[16rem] flex-1">
        <ReasonField />
      </div>
      <Button type="submit" variant="outline" disabled={busy} className="h-11">
        Override
      </Button>
      <ActionMessage message={message} />
    </form>
  );
}

function ContractCard({ contract }: { contract: ProgrammeContract }) {
  const { run, busy, message } = useCommercialAction();
  const [operation, setOperation] = useState("extend");
  const activationLimit = contract.activation_limit_total ?? contract.activation_limit_per_period;

  return (
    <li className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-semibold">{contract.title}</p>
        <Badge variant="outline">
          {TYPE_LABELS[contract.contract_type] ?? contract.contract_type}
        </Badge>
        <Badge variant={contract.status === "active" ? "default" : "secondary"}>
          {contract.status}
        </Badge>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">Holder</dt>
          <dd className="break-all">
            {contract.holderName ?? contract.user_id ?? contract.organisation_id}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Slots in use</dt>
          <dd>
            {contract.activeUsage} / {contract.slot_capacity}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Activations</dt>
          <dd>
            {contract.activationCount}
            {activationLimit
              ? ` / ${activationLimit}${contract.activation_limit_total ? " total" : ` per ${contract.activation_period_days}d`}`
              : ""}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Period</dt>
          <dd>
            {date.format(new Date(contract.starts_at))} – {date.format(new Date(contract.ends_at))}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Administrators</dt>
          <dd>
            {contract.delegateIds.length + 1} / {contract.admin_limit}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Value</dt>
          <dd>{contract.price_cents ? formatPlanPrice(contract.price_cents) : "Free"}</dd>
        </div>
        {contract.notes ? (
          <div className="col-span-full">
            <dt className="text-muted-foreground">Notes</dt>
            <dd>{contract.notes}</dd>
          </div>
        ) : null}
      </dl>
      <form
        className="grid gap-2 sm:grid-cols-4 sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          const form = readForm(event.currentTarget);
          const values: Record<string, unknown> =
            operation === "extend"
              ? { endsAt: new Date(form.endsAt).toISOString() }
              : operation === "limits"
                ? {
                    slotCapacity: optionalInt(form.slots),
                    activationLimitTotal: optionalInt(form.activationTotal),
                    activationsPerPeriod: optionalInt(form.activationsPerPeriod),
                    adminLimit: optionalInt(form.adminLimit),
                  }
                : operation === "notes"
                  ? { notes: form.notes }
                  : operation === "add_member" || operation === "remove_member"
                    ? { userId: form.userId }
                    : {};
          void run(
            {
              action: "contract.manage",
              contractId: contract.id,
              operation,
              values,
              reason: form.reason,
            },
            "Contract updated"
          );
        }}
      >
        <label className="text-sm">
          Action
          <select
            value={operation}
            onChange={(e) => setOperation(e.target.value)}
            className="mt-1 block w-full rounded-md border bg-background p-2"
          >
            <option value="extend">Extend</option>
            <option value="limits">Change slots / activations</option>
            <option value="add_member">Add administrator</option>
            <option value="remove_member">Remove administrator</option>
            <option value="notes">Internal notes</option>
            <option value="end">End now</option>
          </select>
        </label>
        {operation === "extend" ? (
          <label className="text-sm">
            New end date
            <input
              name="endsAt"
              type="date"
              required
              className="mt-1 block w-full rounded-md border bg-background p-2"
            />
          </label>
        ) : null}
        {operation === "limits" ? (
          <>
            <label className="text-sm">
              Slots
              <input
                name="slots"
                type="number"
                min={0}
                defaultValue={contract.slot_capacity}
                className="mt-1 block w-full rounded-md border bg-background p-2"
              />
            </label>
            <label className="text-sm">
              Activations / period
              <input
                name="activationsPerPeriod"
                type="number"
                min={0}
                defaultValue={contract.activation_limit_per_period ?? ""}
                className="mt-1 block w-full rounded-md border bg-background p-2"
              />
            </label>
            <label className="text-sm">
              Total activations
              <input
                name="activationTotal"
                type="number"
                min={0}
                defaultValue={contract.activation_limit_total ?? ""}
                className="mt-1 block w-full rounded-md border bg-background p-2"
              />
            </label>
            <label className="text-sm">
              Administrators
              <input
                name="adminLimit"
                type="number"
                min={1}
                defaultValue={contract.admin_limit}
                className="mt-1 block w-full rounded-md border bg-background p-2"
              />
            </label>
          </>
        ) : null}
        {operation === "add_member" || operation === "remove_member" ? (
          <label className="text-sm sm:col-span-2">
            Account ID
            <input
              name="userId"
              required
              pattern="[0-9a-fA-F-]{36}"
              className="mt-1 block w-full rounded-md border bg-background p-2"
            />
          </label>
        ) : null}
        {operation === "notes" ? (
          <label className="text-sm sm:col-span-3">
            Notes
            <textarea
              name="notes"
              defaultValue={contract.notes ?? ""}
              rows={2}
              className="mt-1 block w-full rounded-md border bg-background p-2"
            />
          </label>
        ) : null}
        <div className="sm:col-span-3">
          <ReasonField />
        </div>
        <SubmitButton busy={busy}>Apply</SubmitButton>
      </form>
      <ActionMessage message={message} />
    </li>
  );
}

export function ProgrammesPanel({
  accounts,
  accountSearch,
  contracts,
  settings,
}: {
  accounts: ProgrammeAccount[];
  accountSearch: string;
  contracts: ProgrammeContract[];
  settings: CommercialSettings;
}) {
  return (
    <div className="space-y-6">
      <AdminCard
        title="Invite a member"
        description="Find the verified account, then grant a programme. The member must have completed identity verification."
      >
        <form action="/admin/programmes" method="get" className="flex flex-wrap items-end gap-2">
          <label className="flex-1 text-sm">
            Email, display name or account ID
            <input
              name="account"
              required
              maxLength={254}
              defaultValue={accountSearch}
              className="mt-1 block w-full rounded-md border bg-background p-2"
            />
          </label>
          <Button type="submit" variant="outline" className="h-11">
            Find account
          </Button>
        </form>
        {accountSearch && accounts.length === 0 ? (
          <p className="text-sm">No matching accounts found.</p>
        ) : null}
        <div className="space-y-4">
          {accounts.map((account) => (
            <div key={account.user_id} className="space-y-3">
              <GrantForm account={account} settings={settings} />
              <details className="rounded-lg border p-3">
                <summary className="cursor-pointer text-sm font-medium">
                  Trial entitlement override
                </summary>
                <div className="mt-3">
                  <TrialOverrideForm account={account} />
                </div>
              </details>
            </div>
          ))}
        </div>
      </AdminCard>

      <AdminCard
        title="Programmes and contracts"
        description="Newest first. Usage counts active posting slots and activations."
      >
        {contracts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No programmes granted yet.</p>
        ) : (
          <ul className="space-y-3">
            {contracts.map((contract) => (
              <ContractCard key={contract.id} contract={contract} />
            ))}
          </ul>
        )}
      </AdminCard>
    </div>
  );
}
