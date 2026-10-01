import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { DEFAULT_COMMERCIAL_SETTINGS, type CommercialSettings } from "@/lib/commercial/settings";
import { SUPPORT_CONTACT_EMAIL } from "@/lib/contact-email";

function FaqItem({
  id,
  question,
  children,
}: {
  id?: string;
  question: string;
  children: ReactNode;
}) {
  return (
    <details id={id} className="group scroll-mt-28 border-b border-border/70 last:border-b-0">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 rounded-xl py-3 text-left font-body text-[15px] font-semibold text-foreground transition-colors hover:text-brand-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:text-brand-green-300 [&::-webkit-details-marker]:hidden">
        {question}
        <ChevronDown
          aria-hidden="true"
          className="h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
        />
      </summary>
      <div className="space-y-2.5 pb-5 pr-2 text-sm leading-6 text-muted-foreground">
        {children}
      </div>
    </details>
  );
}

/**
 * "How billing works": renewal, expiry, the free introductory post, payment and
 * refunds, answered once for the whole pricing page instead of inside every card.
 */
export function BillingFaq({
  trials = DEFAULT_COMMERCIAL_SETTINGS.trials,
  merchantName,
  vatStatus,
}: {
  trials?: CommercialSettings["trials"];
  merchantName?: string;
  vatStatus?: string;
}) {
  const { shortDays, longDays, rules } = trials;

  return (
    <section
      id="billing-faq"
      aria-labelledby="billing-faq-title"
      className="mx-auto grid max-w-5xl scroll-mt-28 gap-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-12"
    >
      <div>
        <h2 id="billing-faq-title" className="section-title">
          How billing works
        </h2>
        <p className="section-lede">Paid once, in rand. Nothing renews.</p>
        <p className="mt-4 text-sm text-muted-foreground">
          Still unsure?{" "}
          <a
            href={`mailto:${SUPPORT_CONTACT_EMAIL}`}
            className="rounded-sm font-semibold text-brand-green-700 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-brand-green-300"
          >
            Email support
          </a>
        </p>
      </div>

      <div className="surface-card px-4 sm:px-6">
        <FaqItem question="Will I be charged again automatically?">
          <p>
            No. Plans are prepaid for a fixed period and never renew automatically. Nothing is
            charged unless you start a new checkout yourself.
          </p>
          <p>Paid posts only become visible once your payment is confirmed.</p>
        </FaqItem>

        <FaqItem question="What happens when my plan ends?">
          <p>
            Your posts are hidden from the public but stay saved in your dashboard. Choose a plan
            again at any time to reactivate them. You won&apos;t need to start from scratch.
          </p>
        </FaqItem>

        <FaqItem question="Can I have more than one post live?">
          <p>
            Each plan gives you one active posting slot. Buy another plan to keep more posts live at
            the same time. When an item sells or you deactivate a post, the slot frees up for
            something new.
          </p>
        </FaqItem>

        <FaqItem id="billing-faq-trial" question="How does the free introductory post work?">
          <p>
            Complete phone, ID, selfie and location verification, then choose one post for{" "}
            {shortDays} days, or a {longDays}-day launch trial while spaces are available in Mzansi
            Market, Mzansi Business and Tourism. You choose once across all sections.
          </p>
          <p>
            Trial posts have standard placement: no boosts, featured placement or urgent badge.
            There is no automatic charge and no repeated free renewal. When the trial ends your post
            stays saved, ready to reactivate for R50 / 30 days, R140 / 90 days or R250 / 180 days.
          </p>
          <p>
            The offer is tied to your verified identity. Previous free-post usage counts; deleting a
            post or an account does not restore an activated offer.
          </p>
          <p>
            Starting a form does not reserve a slot. A submitted post waits for moderation without
            using active capacity. If the {longDays}-day pool fills before approval, it stays
            pending and you can choose {shortDays} days in your dashboard if that offer is enabled.
          </p>
          <p>
            Rejected content that never went live does not use up your offer. Once a trial is live,
            removal or expiry frees the space for another member without restoring your own offer.
          </p>
          <p>
            Trial posts run from approval for the chosen duration. Strategic, founding partner and
            organisation-sponsored programmes are by invitation only, can&apos;t be claimed publicly
            and don&apos;t stack with this trial: one verified identity receives one free programme.
          </p>
          {rules ? <p className="whitespace-pre-line">{rules}</p> : null}
          <p>
            Campaign availability can change. Pausing an offer affects future activations only;
            active trials keep their expiry unless removed for a policy violation.
          </p>
        </FaqItem>

        <FaqItem question="Are events really free?">
          <p>
            Yes. Events don&apos;t need a trial or a plan and stay live until the event is over.
            They&apos;re still moderated, with fair-use limits on how many you can run at once.
          </p>
        </FaqItem>

        <FaqItem question="How do I pay?">
          <p>
            You confirm your plan on VerifyMzansi, then pay in rand (ZAR) on Ozow&apos;s secure
            hosted checkout. Your banking details are entered on Ozow&apos;s page, not on
            VerifyMzansi.
          </p>
          <p>
            {merchantName
              ? `Your bank or Ozow record may show ${merchantName}.`
              : "Your bank record should identify VerifyMzansi or its checkout provider."}
            {vatStatus ? ` VAT status: ${vatStatus}.` : null}
          </p>
        </FaqItem>

        <FaqItem question="What if my paid post is rejected?">
          <p>
            Paying doesn&apos;t skip moderation: every post is reviewed against our{" "}
            <Link
              href="/terms"
              className="rounded-sm font-medium text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              terms
            </Link>
            . If paid content is rejected, support will help you correct it, or review a credit or
            refund.
          </p>
        </FaqItem>
      </div>
    </section>
  );
}
