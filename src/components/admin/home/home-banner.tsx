import Image from "next/image";
import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2 } from "lucide-react";
import { BRAND_SHIELD_LARGE_SRC, BrandSurface } from "@/components/brand";
import { cn } from "@/lib/utils";
import { formatCount } from "./home-cards";
import type { AttentionItem } from "./attention";

const SA_TIME_ZONE = "Africa/Johannesburg";

/** At most this many items are listed; the rest are summed in a "more" line. */
const MAX_LISTED = 5;

function greeting(now: Date): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-ZA", {
      hour: "numeric",
      hour12: false,
      timeZone: SA_TIME_ZONE,
    }).format(now)
  );
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function longDate(now: Date): string {
  // en-GB gives "Friday 2 October"; en-ZA pads the day to "02".
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: SA_TIME_ZONE,
  }).format(now);
}

/**
 * The top of every staff home: who you are, what day it is, and the short
 * list of what needs a person, most urgent first. When nothing does, it says so.
 */
export function HomeBanner({
  title,
  description,
  firstName,
  items,
}: {
  title: string;
  description: string;
  firstName: string | null;
  /** Null when the dashboard could not be read; the banner then makes no claim. */
  items: AttentionItem[] | null;
}) {
  const now = new Date();
  const urgent = items?.filter((item) => item.severity === "urgent").length ?? 0;
  const listed = items?.slice(0, MAX_LISTED) ?? [];
  const hidden = (items?.length ?? 0) - listed.length;

  return (
    <BrandSurface
      as="header"
      glow={urgent > 0 ? "gold" : "green"}
      className="grid gap-6 rounded-3xl px-5 pb-8 pt-6 sm:px-8 sm:pb-10 sm:pt-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-center"
    >
      <Image
        src={BRAND_SHIELD_LARGE_SRC}
        alt=""
        aria-hidden="true"
        width={160}
        height={160}
        unoptimized
        className="pointer-events-none absolute -right-8 -top-8 h-40 w-40 object-contain opacity-[0.08] lg:left-[46%] lg:right-auto lg:top-1/2 lg:-translate-y-1/2"
      />

      <div className="relative min-w-0">
        <p className="text-sm text-white/70">
          {greeting(now)}
          {firstName && (
            <>
              , <span className="font-semibold text-brand-gold-300">{firstName}</span>
            </>
          )}{" "}
          · {longDate(now)}
        </p>
        <h1 className="mt-2 font-display text-[2rem] font-bold leading-tight tracking-[-0.03em] text-white sm:text-[2.5rem]">
          {title}
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-white/75 sm:text-base">{description}</p>

        {items && (
          <p
            role="status"
            className={cn(
              "mt-5 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-semibold",
              items.length === 0
                ? "bg-brand-green-300/15 text-brand-green-200 ring-1 ring-brand-green-300/30"
                : urgent > 0
                  ? "bg-brand-gold-300 text-brand-gold-950"
                  : "bg-white/10 text-white ring-1 ring-white/20"
            )}
          >
            {items.length === 0 ? (
              <>
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                All clear. Nothing needs you right now.
              </>
            ) : (
              <>
                {urgent > 0 && <AlertTriangle className="h-4 w-4" aria-hidden="true" />}
                {items.length === 1
                  ? "1 thing needs you"
                  : `${formatCount(items.length)} things need you`}
                {urgent > 0 && ` · ${formatCount(urgent)} urgent`}
              </>
            )}
          </p>
        )}
      </div>

      {listed.length > 0 && (
        <nav aria-label="Needs you now" className="relative min-w-0">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-white/60">
            Needs you now
          </p>
          <ul className="space-y-1.5">
            {listed.map((item) => (
              <li key={item.key}>
                <Link
                  href={item.href}
                  className={cn(
                    "group flex min-h-11 items-center gap-3 rounded-xl border px-3.5 py-2 text-sm transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white",
                    item.severity === "urgent"
                      ? "border-brand-gold-300/40 bg-brand-gold-300/10 hover:bg-brand-gold-300/20"
                      : "border-white/10 bg-white/[0.04] hover:bg-white/10"
                  )}
                >
                  <span
                    className={cn(
                      "h-2 w-2 shrink-0 rounded-full",
                      item.severity === "urgent" ? "bg-brand-gold-300" : "bg-brand-green-300"
                    )}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 text-white">
                    {item.severity === "urgent" && <span className="sr-only">Urgent: </span>}
                    {item.label}
                  </span>
                  <ArrowRight
                    className="h-4 w-4 shrink-0 text-white/50 transition-transform group-hover:translate-x-0.5 group-hover:text-white"
                    aria-hidden="true"
                  />
                </Link>
              </li>
            ))}
          </ul>
          {hidden > 0 && (
            <p className="mt-2 text-xs text-white/60">And {formatCount(hidden)} more below.</p>
          )}
        </nav>
      )}
    </BrandSurface>
  );
}
