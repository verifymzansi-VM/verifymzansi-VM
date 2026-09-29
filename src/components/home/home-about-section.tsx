import Link from "next/link";
import { ArrowRight, Clapperboard, MessageCircle, ShieldCheck, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";

const ADVANTAGES = [
  {
    icon: Clapperboard,
    title: "Advertise with video",
    body: "Show your product, shop, stay or event in a short video. Buyers see the real thing, not just a still photo.",
  },
  {
    icon: ShieldCheck,
    title: "Checked before they post",
    body: "Our team reviews each poster's phone, ID and selfie, so you know who is behind every post.",
  },
  {
    icon: MessageCircle,
    title: "Talk to them directly",
    body: "Call, WhatsApp or send a message straight from the post. No middleman in the way.",
  },
  {
    icon: Tag,
    title: "Simple, fair pricing",
    body: "Your first post is free. After that you pay once, it never renews, and events are always free.",
  },
] as const;

/** Short explainer under the rails: what VerifyMzansi is, why it helps, and how to start. */
export function HomeAboutSection() {
  return (
    <section
      aria-labelledby="home-about-title"
      className="border-t border-border/60 py-12 sm:py-16 lg:py-20"
    >
      <div className="container-page grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
        <div className="max-w-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-green-700 dark:text-brand-green-300">
            Why VerifyMzansi
          </p>
          <h2
            id="home-about-title"
            className="mt-3 font-display text-2xl font-bold leading-tight tracking-tight text-foreground sm:text-3xl lg:text-[2.25rem]"
          >
            Show it on video. Sell it with trust.
          </h2>
          <p className="mt-4 text-base leading-7 text-muted-foreground">
            VerifyMzansi is South Africa&rsquo;s video-first marketplace. Advertise your products,
            your business, or your stays and events with video across Mzansi Market, Mzansi Business
            and Tourism &amp; Events. Every poster is identity-reviewed, so people can deal with
            confidence.
          </p>

          <div className="mt-7 flex flex-col items-start gap-5">
            <Button
              asChild
              size="lg"
              className="home-link-arrow h-12 w-full rounded-full bg-brand-green-700 px-7 text-base font-semibold text-white hover:bg-brand-green-800 sm:w-auto"
            >
              <Link href="/post/create" prefetch={false}>
                Post for free
                <ArrowRight className="h-5 w-5" aria-hidden="true" />
              </Link>
            </Button>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 whitespace-nowrap text-sm font-semibold text-foreground">
              <Link
                href="/pricing"
                prefetch={false}
                className="underline-offset-4 transition-colors hover:text-brand-green-700 hover:underline dark:hover:text-brand-green-300"
              >
                Pricing
              </Link>
              <Link
                href="/advertise"
                prefetch={false}
                className="underline-offset-4 transition-colors hover:text-brand-green-700 hover:underline dark:hover:text-brand-green-300"
              >
                Advertise
              </Link>
              <Link
                href="/trust-safety"
                prefetch={false}
                className="underline-offset-4 transition-colors hover:text-brand-green-700 hover:underline dark:hover:text-brand-green-300"
              >
                Trust & Safety
              </Link>
            </div>
          </div>
        </div>

        <ul className="grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:gap-y-10">
          {ADVANTAGES.map(({ icon: Icon, title, body }) => (
            <li key={title} className="home-feature relative border-t border-border pt-5">
              <span
                aria-hidden="true"
                className="home-feature-icon flex h-10 w-10 items-center justify-center rounded-full bg-brand-green/10 text-brand-green-700 dark:bg-brand-green/15 dark:text-brand-green-300"
              >
                <Icon className="h-5 w-5" strokeWidth={1.75} />
              </span>
              <h3 className="mt-4 font-display text-base font-semibold text-foreground sm:text-lg">
                {title}
              </h3>
              <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
