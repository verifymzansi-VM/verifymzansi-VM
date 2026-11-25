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
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 rounded-xl py-3 text-left font-body text-[15px] font-semibold text-foreground transition-colors hover:text-brand-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:text-brand-gold-200 [&::-webkit-details-marker]:hidden">
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
  const { shortDays, rules } = trials;

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
            className="rounded-sm font-semibold text-brand-green-700 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-brand-gold-300"
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
            Your posts are hidden from the public and we email you. You then have 3 days to buy a
            plan and reactivate a post; after that it is deleted with its photos and videos. If your
            payment is still being confirmed, we wait up to 24 hours more, and once it is confirmed
            we keep the post for 3 days from your payment.
          </p>
        </FaqItem>

        <FaqItem question="Can I have more than one post live?">
          <p>
            Each slot holds one live post, and you can hold up to 4 Individual slots at a time. A
            sold post keeps its slot until it is deleted 3 days later; delete it yourself to free
            the slot sooner. A deactivated post keeps its slot, and the plan&apos;s time keeps
            running. A new post in a freed slot runs for the plan&apos;s remaining days.
          </p>
        </FaqItem>

        <FaqItem id="billing-faq-trial" question="How does the free introductory post work?">
          <p>
            Once your ID has been reviewed, your first post is free for {shortDays} days, in Mzansi
            Market, Mzansi Business or Tourism. It is one post across all sections. The {shortDays}{" "}
            days start when we approve the post, not when you submit it.
          </p>
          <p>
            There is no automatic charge and no free renewal. When its {shortDays} days end your
            post is hidden; buy a slot within 3 days to reactivate it, or it is deleted.
          </p>
          <p>
            The free post is available once per ID-reviewed person. Once its {shortDays} days have
            started it is used for good; deleting the post or your account does not reset it.
            Previous free-post usage counts.
          </p>
          <p>
            A rejected post does not use the free post; you may correct it and submit it again. Only
            one post at a time can wait for the free post.
          </p>
          <p>
            If, when that post is approved, you already have an unused paid slot with at least 7
            days left that allows its photos and video, the post uses that slot instead and your
            free post stays unused. A sponsored place, or a free post we grant you, counts as your
            free post.
          </p>
          {rules ? <p className="whitespace-pre-line">{rules}</p> : null}
        </FaqItem>

        <FaqItem question="Are events really free?">
          <p>
            Yes. Events don&apos;t need a trial or a plan and stay live until the event is over;
            then they are deleted. They&apos;re still moderated, with fair-use limits on how many
            you can run at once.
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
            . If a post is rejected, the slot stays yours: correct the post and submit it again, or
            use the slot for another post.
          </p>
        </FaqItem>
      </div>
    </section>
  );
}
