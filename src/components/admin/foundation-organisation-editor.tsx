"use client";
import { useState } from "react";
import { z } from "zod";
import Link from "next/link";
import { useFoundationStaffAction } from "@/hooks/use-foundation-staff-action";
import {
  foundationOrganisationTypes,
  foundationOrganisationStatuses,
} from "@/lib/foundation/organisations";
import type { readFoundationStaffOrganisation } from "@/lib/foundation/staff-organisations";
import { ActionMessage, ReasonField } from "./commercial/commercial-action";
type Organisation = NonNullable<Awaited<ReturnType<typeof readFoundationStaffOrganisation>>>;
const textFields = [
  { key: "name", label: "Official name", max: 160, required: true },
  { key: "description", label: "Organisation description", max: 2000 },
  { key: "programme_description", label: "Programme description", max: 2000 },
  { key: "service_area", label: "Geographic area", max: 120 },
  { key: "website", label: "Website", max: 300 },
  { key: "public_email", label: "Public email", max: 254 },
  { key: "public_phone", label: "Public phone (+27)", max: 12 },
  { key: "affiliation_wording", label: "Affiliation label", max: 60, required: true },
  { key: "sponsorship_wording", label: "Sponsorship label", max: 60, required: true },
] as const;
const flags = [
  ["is_public", "Publish the organisation profile"],
  ["accepting_applications", "Accept applications"],
  ["show_on_strip", "Show in the sponsor strip"],
  ["show_on_home", "Show on the homepage"],
] as const;
const numbers = [
  ["sponsored_capacity", "Sponsored business capacity", 0, 100000],
  ["admin_limit", "Administrator limit", 1, 50],
  ["display_order", "Display order", 0, 100000],
] as const;
const inputClass = "mt-1 block w-full rounded-md border bg-background p-2";
function localTime(value: string | null) {
  return value
    ? new Date(value)
        .toLocaleString("sv-SE", { timeZone: "Africa/Johannesburg" })
        .replace(" ", "T")
        .slice(0, 16)
    : "";
}
export function FoundationOrganisationEditor({
  accountId,
  organisation: org,
  provinces,
}: {
  accountId: string;
  organisation: Organisation;
  provinces: { id: string; label: string }[];
}) {
  const action = useFoundationStaffAction(accountId);
  // Keep the loaded revision until our own acknowledged save. Background
  // refreshes must not advance the fence underneath an unsaved form.
  const [revision, setRevision] = useState(org.revision);
  const [unchanged, setUnchanged] = useState(false);
  return (
    <div className="space-y-7">
      <div className="flex flex-wrap gap-4 text-sm">
        <Link href="/admin/organisations" className="underline">
          All organisations
        </Link>
        {org.is_public && (
          <Link href={`/organisations/${org.slug}`} className="underline">
            Public profile
          </Link>
        )}
      </div>
      <ActionMessage message={action.message} />
      {org.revision > revision && (
        <p role="alert">
          This organisation changed while you were editing. Reload its current values before saving.
          Your unsaved fields are still here.
        </p>
      )}
      {unchanged && <p role="status">There are no changed profile values to save.</p>}
      <form
        className="space-y-5 rounded-lg border p-5"
        onSubmit={async (event) => {
          event.preventDefault();
          setUnchanged(false);
          const form = new FormData(event.currentTarget);
          const patch: Record<string, unknown> = {};
          for (const field of textFields) {
            const raw = String(form.get(field.key) ?? "").trim();
            const value = "required" in field && field.required ? raw : raw || null;
            if (value !== org[field.key]) patch[field.key] = value;
          }
          for (const [key] of flags) {
            const value = form.has(key);
            if (value !== org[key]) patch[key] = value;
          }
          for (const [key] of numbers) {
            const value = Number(form.get(key));
            if (value !== org[key]) patch[key] = value;
          }
          for (const key of ["organisation_type", "programme_status"] as const) {
            const value = String(form.get(key));
            if (value !== org[key]) patch[key] = value;
          }
          const province = String(form.get("province_id") ?? "") || null;
          if (province !== org.province_id) patch.province_id = province;
          for (const key of ["programme_starts_at", "programme_ends_at"] as const) {
            const value = String(form.get(key) ?? "");
            if (value !== localTime(org[key]))
              patch[key] = value ? new Date(value + "+02:00").toISOString() : null;
          }
          if (!Object.keys(patch).length) {
            setUnchanged(true);
            return;
          }
          const saved = await action.run({
            path: `/api/foundation/staff/organisations/${org.id}`,
            method: "PATCH",
            body: { expected_revision: revision, patch, reason: String(form.get("reason")) },
            schema: z
              .strictObject({
                id: z.uuid(),
                slug: z.string(),
                revision: z.number().int().positive(),
              })
              .refine((value) => value.id === org.id && value.revision === revision + 1),
            successText: "Organisation profile saved",
          });
          if (saved) setRevision(saved.revision);
        }}
      >
        <h2 className="text-lg font-semibold">Profile and programme settings</h2>
        <fieldset disabled={action.busy} className="grid gap-4 sm:grid-cols-2">
          {textFields.map((field) => (
            <label key={field.key}>
              {field.label}
              {field.max > 300 ? (
                <textarea
                  className={inputClass}
                  rows={4}
                  name={field.key}
                  maxLength={field.max}
                  defaultValue={org[field.key] ?? ""}
                />
              ) : (
                <input
                  className={inputClass}
                  name={field.key}
                  maxLength={field.max}
                  required={"required" in field && field.required}
                  type={
                    field.key === "website"
                      ? "url"
                      : field.key === "public_email"
                        ? "email"
                        : "text"
                  }
                  defaultValue={org[field.key] ?? ""}
                />
              )}
            </label>
          ))}
          <label>
            Organisation type
            <select
              className={inputClass}
              name="organisation_type"
              defaultValue={org.organisation_type}
            >
              {foundationOrganisationTypes.map((type) => (
                <option key={type} value={type}>
                  {type.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label>
            Province
            <select className={inputClass} name="province_id" defaultValue={org.province_id ?? ""}>
              <option value="">Not specified</option>
              {provinces.map((province) => (
                <option key={province.id} value={province.id}>
                  {province.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Programme status
            <select
              className={inputClass}
              name="programme_status"
              defaultValue={org.programme_status}
            >
              {foundationOrganisationStatuses.map((status) => (
                <option key={status} value={status}>
                  {status.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          {numbers.map(([key, label, min, max]) => (
            <label key={key}>
              {label}
              <input
                className={inputClass}
                type="number"
                name={key}
                min={min}
                max={max}
                step={1}
                required
                defaultValue={org[key]}
              />
            </label>
          ))}
          {(["programme_starts_at", "programme_ends_at"] as const).map((key, index) => (
            <label key={key}>
              Programme {index ? "ends" : "starts"} (South African time)
              <input
                className={inputClass}
                type="datetime-local"
                name={key}
                defaultValue={localTime(org[key])}
              />
            </label>
          ))}
          {flags.map(([key, label]) => (
            <label key={key} className="flex items-center gap-2">
              <input type="checkbox" name={key} defaultChecked={org[key]} />
              {label}
            </label>
          ))}
          <ReasonField />
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
            disabled={action.busy}
          >
            Save profile and programme
          </button>
        </fieldset>
      </form>
      <section className="space-y-3 rounded-lg border p-5">
        <h2 className="text-lg font-semibold">Programme activity</h2>
        <p>
          {org.active_affiliations} active affiliations · {org.open_applications} open applications
        </p>
        {org.programmes.map((programme) => (
          <p key={programme.id}>
            {programme.name} · {programme.active ? "Active" : "Inactive"}
          </p>
        ))}
      </section>
      <section className="space-y-3 rounded-lg border p-5">
        <h2 className="text-lg font-semibold">Administrators</h2>
        {org.admins.map((admin) => (
          <p key={admin.account_id} className="break-all">
            {admin.display_name ?? admin.account_id} · {admin.role}
          </p>
        ))}
        {!org.admins.length && <p>No organisation administrators have been added.</p>}
        {org.open_invites.map((invite) => (
          <p key={invite.id}>
            Invitation: {invite.email} · expires{" "}
            {new Date(invite.expires_at).toLocaleString("en-ZA", {
              timeZone: "Africa/Johannesburg",
            })}
          </p>
        ))}
      </section>
      <section className="space-y-3 rounded-lg border p-5">
        <h2 className="text-lg font-semibold">Staff notes</h2>
        {org.notes.map((note) => (
          <p key={note.id} className="whitespace-pre-wrap">
            {note.note}
          </p>
        ))}
        {!org.notes.length && <p>No notes have been recorded.</p>}
      </section>
    </div>
  );
}
