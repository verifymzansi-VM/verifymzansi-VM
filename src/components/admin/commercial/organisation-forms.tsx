"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  ActionMessage,
  AdminCard,
  ReasonField,
  SubmitButton,
  optionalInt,
  readForm,
  useCommercialAction,
} from "./commercial-action";

export const ORGANISATION_TYPES = [
  ["municipality", "Municipality"],
  ["government_department", "Government department"],
  ["led_programme", "Local Economic Development programme"],
  ["chamber_of_commerce", "Chamber of commerce"],
  ["tourism_association", "Tourism association"],
  ["incubator", "Incubator"],
  ["accelerator", "Accelerator"],
  ["enterprise_development", "Enterprise development"],
  ["ngo", "NGO supporting businesses"],
  ["supplier_development", "Corporate supplier development"],
  ["mall", "Mall / shopping centre"],
  ["business_association", "Business association"],
  ["cooperative", "Cooperative"],
  ["professional_body", "Professional organisation"],
  ["university_tvet", "University / TVET programme"],
  ["other", "Other"],
] as const;

export interface AdminOrganisation {
  id: string;
  slug: string;
  name: string;
  organisation_type: string;
  description: string | null;
  programme_description: string | null;
  service_area: string | null;
  province: string | null;
  website: string | null;
  public_email: string | null;
  public_phone: string | null;
  logo_url: string | null;
  logo_permission_at: string | null;
  logo_permission_reference: string | null;
  programme_status: string;
  is_public: boolean;
  accepting_applications: boolean;
  trial_starts_at: string | null;
  trial_ends_at: string | null;
  affiliation_wording: string;
  sponsorship_wording: string;
  sponsored_capacity: number;
  admin_limit: number;
}

const input = "mt-1 block w-full rounded-md border bg-background p-2";

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function ProfileFields({ org }: { org?: AdminOrganisation }) {
  const [slug, setSlug] = useState(org?.slug ?? "");
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm">
        Official name
        <input
          name="name"
          required
          minLength={2}
          maxLength={160}
          defaultValue={org?.name}
          className={input}
          onChange={(event) => {
            if (!org) setSlug(slugify(event.target.value));
          }}
        />
      </label>
      <label className="text-sm">
        Public URL slug
        <input
          name="slug"
          required
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          minLength={3}
          maxLength={80}
          value={slug}
          onChange={(event) => setSlug(event.target.value)}
          className={input}
        />
      </label>
      <label className="text-sm">
        Type
        <select
          name="organisationType"
          defaultValue={org?.organisation_type ?? "other"}
          className={input}
        >
          {ORGANISATION_TYPES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        Geographic area
        <input
          name="serviceArea"
          maxLength={160}
          defaultValue={org?.service_area ?? ""}
          className={input}
        />
      </label>
      <label className="text-sm">
        Province
        <input
          name="province"
          maxLength={60}
          defaultValue={org?.province ?? ""}
          className={input}
        />
      </label>
      <label className="text-sm">
        Website (https://)
        <input
          name="website"
          type="url"
          pattern="https://.*"
          defaultValue={org?.website ?? ""}
          className={input}
        />
      </label>
      <label className="text-sm">
        Public email
        <input
          name="publicEmail"
          type="email"
          defaultValue={org?.public_email ?? ""}
          className={input}
        />
      </label>
      <label className="text-sm">
        Public phone
        <input
          name="publicPhone"
          maxLength={30}
          defaultValue={org?.public_phone ?? ""}
          className={input}
        />
      </label>
      <label className="text-sm sm:col-span-2">
        Description
        <textarea
          name="description"
          rows={3}
          maxLength={2000}
          defaultValue={org?.description ?? ""}
          className={input}
        />
      </label>
      <label className="text-sm sm:col-span-2">
        Programme description
        <textarea
          name="programmeDescription"
          rows={3}
          maxLength={2000}
          defaultValue={org?.programme_description ?? ""}
          className={input}
        />
      </label>
      {org ? (
        <>
          <label className="text-sm sm:col-span-2">
            Logo URL (hosted on VerifyMzansi media; permission must be recorded separately)
            <input name="logoUrl" type="url" defaultValue={org.logo_url ?? ""} className={input} />
          </label>
          <label className="text-sm">
            Affiliation wording (badge)
            <input
              name="affiliationWording"
              minLength={3}
              maxLength={60}
              defaultValue={org.affiliation_wording}
              className={input}
            />
          </label>
          <label className="text-sm">
            Sponsorship wording
            <input
              name="sponsorshipWording"
              minLength={3}
              maxLength={60}
              defaultValue={org.sponsorship_wording}
              className={input}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="isPublic"
              defaultChecked={org.is_public}
              className="h-4 w-4"
            />
            Public organisation profile
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="acceptingApplications"
              defaultChecked={org.accepting_applications}
              className="h-4 w-4"
            />
            Accepting affiliation requests
          </label>
        </>
      ) : (
        <label className="text-sm">
          Sponsored business cohort
          <input
            name="sponsoredCapacity"
            type="number"
            min={0}
            max={10000}
            defaultValue={50}
            className={input}
          />
        </label>
      )}
    </div>
  );
}

function profileValues(form: Record<string, string>, existing: boolean) {
  const values: Record<string, unknown> = {
    name: form.name,
    slug: form.slug,
    organisationType: form.organisationType,
    serviceArea: form.serviceArea,
    province: form.province,
    website: form.website,
    publicEmail: form.publicEmail,
    publicPhone: form.publicPhone,
    description: form.description,
    programmeDescription: form.programmeDescription,
  };
  if (existing) {
    values.logoUrl = form.logoUrl;
    values.affiliationWording = form.affiliationWording;
    values.sponsorshipWording = form.sponsorshipWording;
    values.isPublic = form.isPublic === "on";
    values.acceptingApplications = form.acceptingApplications === "on";
  } else {
    values.sponsoredCapacity = optionalInt(form.sponsoredCapacity);
  }
  return values;
}

export function OrganisationCreateForm() {
  const { run, busy, message } = useCommercialAction();
  const router = useRouter();
  return (
    <AdminCard
      title="Invite an organisation"
      description="Creates a private profile in the Invited state. Activate the founding pilot once the written agreement and logo permission are in place."
    >
      <form
        className="space-y-3"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = readForm(event.currentTarget);
          const id = await run(
            {
              action: "organisation.upsert",
              values: profileValues(form, false),
              reason: form.reason,
            },
            "Organisation created"
          );
          if (typeof id === "string") router.push(`/admin/organisations/${id}`);
        }}
      >
        <ProfileFields />
        <ReasonField />
        <SubmitButton busy={busy}>Create organisation</SubmitButton>
        <ActionMessage message={message} />
      </form>
    </AdminCard>
  );
}

export function OrganisationProfileForm({ org }: { org: AdminOrganisation }) {
  const { run, busy, message } = useCommercialAction();
  return (
    <AdminCard title="Organisation profile">
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          const form = readForm(event.currentTarget);
          void run(
            {
              action: "organisation.upsert",
              organisationId: org.id,
              values: profileValues(form, true),
              reason: form.reason,
            },
            "Profile saved"
          );
        }}
      >
        <ProfileFields org={org} />
        <ReasonField />
        <SubmitButton busy={busy}>Save profile</SubmitButton>
        <ActionMessage message={message} />
      </form>
    </AdminCard>
  );
}

const OPERATIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "activate_trial", label: "Activate founding pilot (6 months, no platform fee)" },
  { value: "set_capacity", label: "Change sponsored cohort size" },
  { value: "approve_logo", label: "Record written logo permission" },
  { value: "revoke_logo", label: "Withdraw logo permission" },
  { value: "convert_paid", label: "Convert to paid institutional contract" },
  { value: "end_trial", label: "End founding pilot (affiliations kept)" },
  { value: "suspend", label: "Suspend organisation" },
  { value: "reinstate", label: "Reinstate organisation" },
  { value: "add_admin", label: "Add organisation administrator" },
  { value: "remove_admin", label: "Remove organisation administrator" },
  { value: "add_programme", label: "Add programme" },
  { value: "note", label: "Add internal note" },
  { value: "upsert_showcase", label: "Create programme showroom" },
];

export function OrganisationActionsForm({ org }: { org: AdminOrganisation }) {
  const { run, busy, message } = useCommercialAction();
  const [operation, setOperation] = useState(OPERATIONS[0]!.value);

  function values(form: Record<string, string>): Record<string, unknown> {
    switch (operation) {
      case "activate_trial":
        return { durationDays: optionalInt(form.durationDays) };
      case "set_capacity":
        return { sponsoredCapacity: optionalInt(form.sponsoredCapacity) };
      case "approve_logo":
        return { reference: form.reference };
      case "convert_paid":
        return {
          priceCents: form.price ? Math.round(Number(form.price) * 100) : 0,
          endsAt: new Date(form.endsAt).toISOString(),
          sponsoredCapacity: optionalInt(form.sponsoredCapacity),
          adminLimit: optionalInt(form.adminLimit),
          notes: form.notes || undefined,
        };
      case "end_trial":
      case "reinstate":
        return { status: form.status || "affiliation_only" };
      case "add_admin":
      case "remove_admin":
        return { userId: form.userId };
      case "add_programme":
        return { slug: form.slug, name: form.name, description: form.description };
      case "note":
        return { note: form.note };
      case "upsert_showcase":
        return {
          title: form.title,
          placement: form.placement,
          enabled: form.enabled === "on",
          endsAt: new Date(form.endsAt).toISOString(),
          maxCards: optionalInt(form.maxCards),
          province: form.province,
          city: form.city,
          displayOrder: optionalInt(form.displayOrder),
          sponsoredOnly: form.sponsoredOnly === "on",
        };
      default:
        return {};
    }
  }

  return (
    <AdminCard
      title="Programme actions"
      description={`Status: ${org.programme_status.replace(/_/g, " ")}`}
    >
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          const form = readForm(event.currentTarget);
          void run(
            {
              action: "organisation.manage",
              organisationId: org.id,
              operation,
              values: values(form),
              reason: form.reason,
            },
            "Organisation updated"
          );
        }}
      >
        <label className="block text-sm">
          Action
          <select
            value={operation}
            onChange={(e) => setOperation(e.target.value)}
            className={input}
          >
            {OPERATIONS.map((op) => (
              <option key={op.value} value={op.value}>
                {op.label}
              </option>
            ))}
          </select>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          {operation === "activate_trial" ? (
            <label className="text-sm">
              Duration (days)
              <input
                name="durationDays"
                type="number"
                min={7}
                defaultValue={180}
                className={input}
              />
            </label>
          ) : null}
          {operation === "set_capacity" || operation === "convert_paid" ? (
            <label className="text-sm">
              Sponsored businesses
              <input
                name="sponsoredCapacity"
                type="number"
                min={0}
                defaultValue={org.sponsored_capacity}
                className={input}
              />
            </label>
          ) : null}
          {operation === "approve_logo" ? (
            <label className="text-sm sm:col-span-2">
              Permission reference (letter, email or MOU clause)
              <input name="reference" required minLength={3} className={input} />
            </label>
          ) : null}
          {operation === "convert_paid" ? (
            <>
              <label className="text-sm">
                Contract value (R)
                <input name="price" type="number" min={0} step="0.01" className={input} />
              </label>
              <label className="text-sm">
                Ends
                <input name="endsAt" type="date" required className={input} />
              </label>
              <label className="text-sm">
                Administrators
                <input
                  name="adminLimit"
                  type="number"
                  min={1}
                  defaultValue={org.admin_limit}
                  className={input}
                />
              </label>
              <label className="text-sm sm:col-span-2">
                Notes
                <textarea name="notes" rows={2} className={input} />
              </label>
              <p className="text-xs text-muted-foreground sm:col-span-2">
                Public-sector conversions must follow the organisation&apos;s procurement process.
                Record the reference in the notes.
              </p>
            </>
          ) : null}
          {operation === "end_trial" || operation === "reinstate" ? (
            <label className="text-sm">
              New status
              <select name="status" defaultValue="affiliation_only" className={input}>
                <option value="affiliation_only">Affiliation only</option>
                <option value="ended">Ended</option>
                {operation === "reinstate" ? (
                  <option value="founding_trial">Founding pilot</option>
                ) : null}
                {operation === "reinstate" ? (
                  <option value="active_paid">Active (paid)</option>
                ) : null}
              </select>
            </label>
          ) : null}
          {operation === "add_admin" || operation === "remove_admin" ? (
            <label className="text-sm sm:col-span-2">
              Administrator account ID (find it under Programmes &amp; Contracts → Find account)
              <input name="userId" required pattern="[0-9a-fA-F-]{36}" className={input} />
            </label>
          ) : null}
          {operation === "add_programme" ? (
            <>
              <label className="text-sm">
                Programme name
                <input name="name" required className={input} />
              </label>
              <label className="text-sm">
                Slug
                <input name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" className={input} />
              </label>
              <label className="text-sm sm:col-span-2">
                Description
                <textarea name="description" rows={2} className={input} />
              </label>
            </>
          ) : null}
          {operation === "note" ? (
            <label className="text-sm sm:col-span-2">
              Internal note (admins only)
              <textarea name="note" required rows={3} maxLength={4000} className={input} />
            </label>
          ) : null}
          {operation === "upsert_showcase" ? (
            <>
              <label className="text-sm sm:col-span-2">
                Section title
                <input
                  name="title"
                  required
                  defaultValue={`Explore ${org.name} Business Network`}
                  className={input}
                />
              </label>
              <label className="text-sm">
                Placement
                <select name="placement" className={input}>
                  <option value="home">Homepage</option>
                  <option value="business">Mzansi Business</option>
                  <option value="tourism">Tourism &amp; Events</option>
                  <option value="market">Mzansi Market</option>
                </select>
              </label>
              <label className="text-sm">
                Ends
                <input name="endsAt" type="date" required className={input} />
              </label>
              <label className="text-sm">
                Maximum cards
                <input
                  name="maxCards"
                  type="number"
                  min={1}
                  max={48}
                  defaultValue={12}
                  className={input}
                />
              </label>
              <label className="text-sm">
                Display order
                <input name="displayOrder" type="number" defaultValue={100} className={input} />
              </label>
              <label className="text-sm">
                Province (optional)
                <input name="province" className={input} />
              </label>
              <label className="text-sm">
                City (optional)
                <input name="city" className={input} />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="enabled" className="h-4 w-4" />
                Enabled
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="sponsoredOnly" className="h-4 w-4" />
                Sponsored businesses only
              </label>
            </>
          ) : null}
        </div>
        <ReasonField />
        <SubmitButton busy={busy}>Apply</SubmitButton>
        <ActionMessage message={message} />
      </form>
    </AdminCard>
  );
}

export function ShowcaseToggle({
  orgId,
  showcase,
}: {
  orgId: string;
  showcase: { id: string; title: string; enabled: boolean };
}) {
  const { run, busy, message } = useCommercialAction();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        className="h-11"
        disabled={busy}
        onClick={() => {
          const reason = window.prompt("Reason for this change (audited)") ?? "";
          if (reason.trim().length < 5) return;
          void run({
            action: "organisation.manage",
            organisationId: orgId,
            operation: "upsert_showcase",
            values: { showcaseId: showcase.id, enabled: !showcase.enabled },
            reason,
          });
        }}
      >
        {showcase.enabled ? "Disable" : "Enable"} “{showcase.title}”
      </Button>
      <ActionMessage message={message} />
    </div>
  );
}
