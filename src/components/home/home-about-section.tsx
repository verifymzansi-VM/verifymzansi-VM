import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { BUSINESS_STICKER_SUMMARIES } from "@/components/trust/business-stickers";
import { Button } from "@/components/ui/button";

const STEPS = [
  "Get your ID reviewed. Your first post is then free.",
  "Post with photos or a short video. We review it before it goes live.",
  "Buyers call, WhatsApp or send you an enquiry. No commission.",
] as const;

const LINKS = [
  { href: "/pricing", label: "Pricing" },
  { href: "/advertise", label: "Advertise" },
  { href: "/help/business-verification", label: "How we verify businesses" },
  { href: "/trust-safety", label: "Trust & Safety" },
  { href: "/safety", label: "Safety Centre" },
] as const;

const linkClass =
  "underline-offset-4 transition-colors hover:text-brand-green-700 hover:underline dark:hover:text-brand-gold-200";

/** Homepage intro under the rails: what VerifyMzansi is, what the stickers mean, how to start. */
export function HomeAboutSection() {
  return (
    <section
      aria-labelledby="home-about-title"
      className="border-t border-border/60 py-12 sm:py-16 lg:py-20"
    >
      <div className="container-page space-y-12 lg:space-y-14">
        <div
          data-reveal
          className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between"
        >
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-green-700 dark:text-brand-gold-300">
              Why VerifyMzansi
            </p>
            <h2
              id="home-about-title"
              className="mt-3 font-display text-[1.75rem] font-semibold leading-tight text-foreground sm:text-[2.25rem]"
            >
              Know who you&rsquo;re dealing with.
            </h2>
            <p className="mt-3 text-[15px] leading-7 text-muted-foreground sm:text-base">
              VerifyMzansi connects people with verified businesses, products, services, tourism and
              events. Discover, connect and do business with confidence.
            </p>
          </div>
          <Button
            asChild
            size="lg"
            className="home-link-arrow btn-shine h-12 w-full shrink-0 rounded-full bg-brand-green-700 px-7 text-base font-semibold text-white hover:bg-brand-green-800 sm:w-auto"
          >
            <Link href="/post/create" prefetch={false}>
              Post for free
              <ArrowRight className="h-5 w-5" aria-hidden="true" />
            </Link>
          </Button>
        </div>

        <ul aria-label="Verification stickers" className="grid gap-4 sm:grid-cols-3">
          {BUSINESS_STICKER_SUMMARIES.map(({ key, icon: Icon, name, summary }) => (
            <li
              key={key}
              data-reveal
              className="home-feature relative rounded-2xl border border-border bg-card p-5"
            >
              <span
                aria-hidden="true"
                className="home-feature-icon flex h-10 w-10 items-center justify-center rounded-full bg-brand-green-700 text-brand-gold-300 ring-1 ring-brand-gold-400/50 dark:bg-brand-green-800"
              >
                <Icon className="h-5 w-5" strokeWidth={1.75} />
              </span>
              <h3 className="mt-4 font-body text-base font-semibold text-foreground">{name}</h3>
              <p className="mt-1 text-[15px] leading-6 text-muted-foreground">{summary}</p>
            </li>
          ))}
        </ul>

        <div data-reveal>
          <h3 className="font-display text-xl font-semibold text-foreground">Post in 3 steps</h3>
          <ol className="mt-5 grid gap-5 sm:grid-cols-3">
            {STEPS.map((step, i) => (
              <li key={step} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-green/10 text-sm font-semibold text-brand-green-700 dark:bg-brand-green/15 dark:text-brand-gold-300"
                >
                  {i + 1}
                </span>
                <p className="text-[15px] leading-6 text-foreground">{step}</p>
              </li>
            ))}
          </ol>
        </div>

        <nav
          aria-label="Learn more"
          className="flex flex-wrap gap-x-6 gap-y-3 border-t border-border pt-6 text-sm font-semibold text-foreground"
        >
          {LINKS.map(({ href, label }) => (
            <Link key={href} href={href} prefetch={false} className={linkClass}>
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </section>
  );
}
