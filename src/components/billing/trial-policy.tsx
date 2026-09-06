import Link from "next/link";

export function TrialPolicy() {
  return (
    <section className="mx-auto max-w-4xl rounded-xl border bg-card p-5 space-y-3">
      <h2 className="font-semibold">One free introductory choice</h2>
      <p className="text-sm text-muted-foreground">
        Eligible verified members can choose one standard post for 7 days, or a 30-Day Free Launch
        Trial while spaces are available. The default allocation is 50 active 30-day trials in each
        of Mzansi Market, Mzansi Business and Tourism &amp; Events. Availability is confirmed on
        approval.
      </p>
      <p className="text-sm text-muted-foreground">
        Choose once across all three areas. No boosts, featured placement, urgent badge, automatic
        charge or repeated free renewal. Your saved post can be renewed with an appropriate paid
        plan after expiry.
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
            using active capacity. If the 30-day pool fills before approval, it stays pending and
            you can choose seven days in your dashboard if that offer is enabled.
          </p>
          <p>
            Rejected content that never activated does not consume your introductory offer. Once a
            trial activates, removal or expiry frees capacity for another eligible member without
            restoring your own offer.
          </p>
          <p>
            Event visibility ends at the earlier of the event end date and trial expiry. Other trial
            posts run from approval for the chosen duration. Expired content is hidden publicly and
            saved in your dashboard for renewal.
          </p>
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
