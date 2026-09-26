import Link from "next/link";
import { DEFAULT_COMMERCIAL_SETTINGS, type CommercialSettings } from "@/lib/commercial/settings";

export function TrialPolicy({
  trials = DEFAULT_COMMERCIAL_SETTINGS.trials,
}: {
  trials?: CommercialSettings["trials"];
}) {
  const { shortDays, longDays, rules } = trials;
  return (
    <section className="mx-auto max-w-4xl rounded-xl border bg-card p-5 space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-brand-green">
        Public introductory trial
      </p>
      <h2 className="font-semibold">One free introductory choice</h2>
      <p className="text-sm text-muted-foreground">
        Eligible verified members can choose one post for {shortDays} days, or a {longDays}-Day
        Launch Trial while spaces are available in Mzansi Market, Mzansi Business and Tourism.
        Availability is confirmed on approval. Events are always free and do not use the trial.
      </p>
      <p className="text-sm text-muted-foreground">
        Choose once across all areas. No boosts, featured placement, urgent badge, automatic charge
        or repeated free renewal. When the trial ends your post stays saved in your dashboard —
        reactivate it for R50 / 30 days, R250 / 6 months or R450 / 12 months.
      </p>
      <details className="text-sm">
        <summary className="cursor-pointer font-medium">
          How do trial eligibility, moderation and expiry work?
        </summary>
        <div className="space-y-2 pt-2 text-muted-foreground">
          <p>
            Complete phone, ID, selfie and location verification before posting. The offer is tied
            to your verified identity. Previous free-post usage counts; deleting a post or an
            account does not restore an activated offer.
          </p>
          <p>
            Starting a form does not reserve a slot. A submitted post waits for moderation without
            using active capacity. If the {longDays}-day pool fills before approval, it stays
            pending and you can choose {shortDays} days in your dashboard if that offer is enabled.
          </p>
          <p>
            Rejected content that never activated does not consume your introductory offer. Once a
            trial activates, removal or expiry frees capacity for another eligible member without
            restoring your own offer.
          </p>
          <p>
            Trial posts run from approval for the chosen duration. Expired content is hidden
            publicly and saved in your dashboard for renewal.
          </p>
          <p>
            Strategic, founding partner and organisation-sponsored programmes are by invitation
            only. They cannot be claimed publicly and do not stack with this trial: one verified
            identity receives one free programme.
          </p>
          {rules ? <p className="whitespace-pre-line">{rules}</p> : null}
          <p>
            Campaign availability and allocation can change. Pausing an offer affects future
            activations; existing active trials keep their expiry unless removed for a policy
            violation.
          </p>
        </div>
      </details>
      <Link className="text-sm underline" href="/post/create">
        Choose a posting area
      </Link>
    </section>
  );
}
