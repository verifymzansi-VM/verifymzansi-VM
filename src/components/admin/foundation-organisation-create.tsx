"use client";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { useFoundationStaffAction } from "@/hooks/use-foundation-staff-action";
import { foundationOrganisationTypes } from "@/lib/foundation/organisations";
import { ActionMessage, ReasonField, readForm } from "./commercial/commercial-action";
const result = z.strictObject({
  id: z.uuid(),
  slug: z.string(),
  revision: z.number().int().positive(),
});
export function FoundationOrganisationCreate({ accountId }: { accountId: string }) {
  const action = useFoundationStaffAction(accountId);
  const router = useRouter();
  return (
    <section className="space-y-3 rounded-lg border p-5">
      <h2 className="text-lg font-semibold">Create an organisation</h2>
      <ActionMessage message={action.message} />
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = readForm(event.currentTarget);
          const created = await action.run({
            path: "/api/foundation/staff/organisations",
            body: {
              name: form.name,
              slug: form.slug,
              organisation_type: form.organisationType,
              reason: form.reason,
            },
            schema: result,
            successText: "Organisation created",
            refresh: false,
          });
          if (created) router.push(`/admin/organisations/${created.id}`);
        }}
      >
        <label>
          Official name
          <input
            className="block w-full rounded-md border bg-background p-2"
            name="name"
            minLength={2}
            maxLength={160}
            required
          />
        </label>
        <label>
          Public URL name
          <input
            className="block w-full rounded-md border bg-background p-2"
            name="slug"
            minLength={3}
            maxLength={60}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            required
          />
        </label>
        <label>
          Organisation type
          <select
            className="block w-full rounded-md border bg-background p-2"
            name="organisationType"
            defaultValue="other"
          >
            {foundationOrganisationTypes.map((value) => (
              <option key={value} value={value}>
                {value.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <ReasonField />
        <button
          type="submit"
          disabled={action.busy}
          className="rounded-lg bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
        >
          Create organisation
        </button>
      </form>
    </section>
  );
}
