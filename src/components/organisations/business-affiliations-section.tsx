import Image from "next/image";
import { organisationsPublicEnabled } from "@/lib/commercial/settings";
import Link from "next/link";
import { Landmark } from "lucide-react";
import type { PublicAffiliation } from "@/lib/organisations/affiliations";
import { formatSaLongDate } from "@/lib/utils/format";

/** Load a business's public affiliations; failures render nothing. */
export async function loadBusinessAffiliations(
  client: { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown }> },
  businessId: string
): Promise<PublicAffiliation[]> {
  try {
    if (!(await organisationsPublicEnabled(client as never))) return [];
    const { data } = await client.rpc("public_business_affiliations", {
      p_business_ids: [businessId],
    });
    return Array.isArray(data) ? (data as PublicAffiliation[]) : [];
  } catch {
    return [];
  }
}

/**
 * Profile section listing confirmed organisation relationships. Sponsorship
 * is shown only where an organisation genuinely funds the visibility.
 * Verification is shown elsewhere and is never awarded by organisations.
 */
export function BusinessAffiliationsSection({
  affiliations,
}: {
  affiliations: PublicAffiliation[];
}) {
  if (affiliations.length === 0) return null;
  const sponsored = affiliations.filter((row) => row.sponsored && row.sponsorship_label);

  return (
    <section aria-labelledby="affiliations-title">
      <div className="surface-card elev-xs space-y-4 rounded-2xl p-5 sm:p-6">
        <h2 id="affiliations-title" className="font-display text-lg font-semibold tracking-tight">
          Programmes and memberships
        </h2>
        <ul className="space-y-3">
          {affiliations.map((row) => (
            <li key={row.organisation_id} className="flex items-start gap-3">
              {row.logo_url ? (
                <Image
                  src={row.logo_url}
                  alt=""
                  width={36}
                  height={36}
                  className="h-9 w-9 shrink-0 rounded-md border bg-white object-contain p-0.5"
                  unoptimized
                />
              ) : (
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border bg-muted">
                  <Landmark aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
                </span>
              )}
              <div className="text-sm">
                <Link
                  href={`/organisation/${row.organisation_slug}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {row.programme_name ?? row.organisation_name}
                </Link>
                <p className="text-muted-foreground">{row.label}</p>
                <p className="text-xs text-muted-foreground">
                  Confirmed{" "}
                  <time dateTime={row.confirmed_at}>{formatSaLongDate(row.confirmed_at)}</time>
                </p>
              </div>
            </li>
          ))}
        </ul>
        {sponsored.length > 0 ? (
          <div className="border-t pt-3">
            <h3 className="text-sm font-semibold">Sponsorship</h3>
            {sponsored.map((row) => (
              <p key={row.organisation_id} className="text-sm text-muted-foreground">
                Commercial visibility{" "}
                {row.sponsorship_label?.replace(/^Supported by/i, "supported by")}
              </p>
            ))}
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Confirmed by the organisation. Not a guarantee.
        </p>
      </div>
    </section>
  );
}
