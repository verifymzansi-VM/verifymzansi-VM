"use client";

import { BrandShieldAlert as ShieldAlert } from "@/components/shared/brand-shield";
import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Building2,
  CalendarDays,
  Check,
  Loader2,
  X,
  ShoppingBag,
  TreePalm,
  type LucideIcon,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buildPostCategoryHref } from "@/app/post/_lib/post-access";
import { normalizeAccountVerificationStatus } from "@/lib/account/compat";
import { cn } from "@/lib/utils";
import type { AccountVerificationStatus } from "@/types/enums";

type OptionId = "listing" | "business" | "stay" | "event";

interface PostOption {
  id: OptionId;
  /** Section of the site the post appears in. */
  area: string;
  title: string;
  action: string;
  /** What the section is and who browses it. */
  about: string;
  /** Situations that belong here. */
  fits: readonly string[];
  /** The kinds of posts the section is split into. */
  covers: string;
  /** The look-alike that belongs somewhere else. */
  notFor: string;
  icon: LucideIcon;
  tile: string;
  accent: string;
  /** Pointer glow tint (see `.glow-*` in globals.css). */
  glow: string;
  /** Colour of the large faded icon in the card corner. */
  mark: string;
  href: string;
  badge?: string;
}

// One card per form; each opens with the category or type already set.
const POST_OPTIONS: readonly PostOption[] = [
  {
    id: "listing",
    area: "Classifieds",
    title: "Mzansi Market",
    action: "Create a market listing",
    about: "The classifieds. People browse it to buy, rent or find work.",
    fits: [
      "Selling something new or used",
      "Renting out a house, flat or room",
      "Advertising a job vacancy",
    ],
    covers: "Property, vehicles and parts, electronics, home, clothing, farming, jobs",
    notFor: "your business as a whole. Use Mzansi Business.",
    icon: ShoppingBag,
    tile: "area-market-tile",
    accent: "bg-brand-green-600",
    glow: "glow-market",
    mark: "text-brand-green-600",
    href: "/post/create-listing",
  },
  {
    id: "business",
    area: "Business directory",
    title: "Mzansi Business",
    action: "Create a business profile",
    about: "The local business directory. Customers search it to find and contact you.",
    fits: [
      "You run a shop, practice or service",
      "Customers need your hours and address",
      "You want a lasting page, not one advert",
    ],
    covers: "Shops, food, beauty, health, trades, cleaning, transport, professional services",
    notFor: "one item for sale. Use Mzansi Market.",
    icon: Building2,
    tile: "area-business-tile",
    accent: "bg-brand-blue-600",
    glow: "glow-business",
    mark: "text-brand-blue-600",
    href: "/post/create-business",
  },
  {
    id: "stay",
    area: "Tourism & Events",
    title: "Tourism",
    action: "List a stay or experience",
    about: "Where visitors look for a place to stay and things to do.",
    fits: [
      "You host guests overnight",
      "You run tours, safaris or activities",
      "You run an attraction or retreat",
    ],
    covers: "Hotels, guest houses, lodges, self-catering, campsites, tours, attractions",
    notFor: "a home to rent long term. Use Mzansi Market.",
    icon: TreePalm,
    tile: "area-tourism-tile",
    accent: "bg-teal-500",
    glow: "glow-tourism",
    mark: "text-teal-600",
    href: "/post/create-tourism?type=tourism_business",
  },
  {
    id: "event",
    area: "Tourism & Events",
    title: "Events",
    action: "Create an event",
    about: "What's on near you. People browse it to find something to attend.",
    fits: [
      "It happens on a set date",
      "People attend free or with tickets",
      "Once-off or repeating, like a weekly market",
    ],
    covers: "Festivals, concerts, workshops, markets, sport, church and community events",
    notFor: "a venue for hire. Use Mzansi Business.",
    icon: CalendarDays,
    tile: "area-tourism-tile",
    accent: "bg-teal-500",
    glow: "glow-tourism",
    mark: "text-teal-600",
    href: "/post/create-tourism?type=event",
    badge: "Free to post",
  },
];

const OPTION_TILES: Record<OptionId, string> = {
  listing: "area-market-tile",
  business: "area-business-tile",
  stay: "area-tourism-tile",
  event: "area-tourism-tile",
};

// Pairs that are easy to mix up, so the difference is clear.
const EXAMPLES: readonly {
  situation: string;
  destination: string;
  option: OptionId;
  href: string;
}[] = [
  {
    situation: "Selling a cake mixer",
    destination: "Market",
    option: "listing",
    href: "/post/create-listing?category=home_lifestyle",
  },
  {
    situation: "A baking business",
    destination: "Business",
    option: "business",
    href: "/post/create-business?category=food_dining",
  },
  {
    situation: "A one-day baking workshop",
    destination: "Events",
    option: "event",
    href: "/post/create-tourism?type=event",
  },
  {
    situation: "Holiday accommodation",
    destination: "Tourism",
    option: "stay",
    href: "/post/create-tourism?type=tourism_business",
  },
];

function getVerificationNote(status: AccountVerificationStatus | null | undefined) {
  switch (status) {
    case "pending_review":
      return "Your verification is being reviewed. You can post once it's approved.";
    case "rejected":
      return "Your verification wasn't approved. Check the feedback and try again.";
    case "incomplete":
    default:
      return "Finish verification to start posting.";
  }
}

interface PostCreateClientProps {
  initialVerificationStatus: AccountVerificationStatus | null;
  isAuthenticated: boolean;
}

export function PostCreateClient({
  initialVerificationStatus,
  isAuthenticated,
}: PostCreateClientProps) {
  const router = useRouter();
  const [resolvedVerificationStatus, setResolvedVerificationStatus] =
    useState<AccountVerificationStatus | null>(null);
  const [hasConfirmedAuth, setHasConfirmedAuth] = useState(isAuthenticated);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const verificationStatus = resolvedVerificationStatus ?? initialVerificationStatus;
  const canPost = verificationStatus === "verified";

  useEffect(() => {
    let isCancelled = false;

    if (initialVerificationStatus === "verified" || resolvedVerificationStatus === "verified") {
      return;
    }

    async function refreshVerificationStatus() {
      try {
        const res = await fetch("/api/verification/status", {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
        });

        if (isCancelled) {
          return;
        }

        if (!res.ok) {
          if (res.status === 401) {
            setHasConfirmedAuth(false);
          }
          return;
        }

        const payload = (await res.json()) as {
          accountVerificationStatus?: string | null;
          overallStatus?: string | null;
        };

        const nextStatus = normalizeAccountVerificationStatus(
          payload.accountVerificationStatus ?? payload.overallStatus ?? null
        );

        setHasConfirmedAuth(true);
        setResolvedVerificationStatus(nextStatus);
      } catch {
        if (!isCancelled) {
          setHasConfirmedAuth(isAuthenticated);
        }
      }
    }

    void refreshVerificationStatus();

    // Poll every 30 s while unverified so status updates without a
    // full page refresh (e.g. after admin approves verification).
    const intervalId = setInterval(() => {
      if (!isCancelled) {
        void refreshVerificationStatus();
      }
    }, 30_000);

    return () => {
      isCancelled = true;
      clearInterval(intervalId);
    };
  }, [initialVerificationStatus, isAuthenticated, resolvedVerificationStatus]);

  function handleChoiceClick(targetHref: string) {
    if (pendingHref) return;

    setPendingHref(targetHref);
    router.push(buildPostCategoryHref(targetHref, verificationStatus));
  }

  const showVerificationCta = verificationStatus !== "pending_review";
  const isBusy = pendingHref !== null;

  return (
    <div className="flex flex-1 flex-col gap-4">
      {hasConfirmedAuth && !canPost && (
        <Alert
          hideIcon
          className="border-brand-gold-300/70 bg-brand-gold-50 text-foreground dark:border-brand-gold-700/50 dark:bg-brand-gold-950/30"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-gold-100 text-brand-gold-800 dark:bg-brand-gold-900/50 dark:text-brand-gold-200">
                <ShieldAlert className="h-5 w-5" />
              </span>
              <div>
                <AlertTitle className="leading-snug">
                  Verification required before posting
                </AlertTitle>
                <AlertDescription className="mt-1 text-muted-foreground">
                  {getVerificationNote(verificationStatus)}
                </AlertDescription>
              </div>
            </div>
            {showVerificationCta ? (
              <Link
                href="/verification?returnUrl=%2Fpost%2Fcreate"
                prefetch={false}
                className="inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-full bg-foreground px-5 text-sm font-semibold text-background transition-colors hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Continue verification
              </Link>
            ) : null}
          </div>
        </Alert>
      )}

      <div className="grid flex-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {POST_OPTIONS.map((option, index) => {
          const OptionIcon = option.icon;
          const headingId = `post-option-${option.id}`;
          const isPending = pendingHref === option.href;

          return (
            <section
              key={option.id}
              aria-labelledby={headingId}
              style={{ "--i": index } as CSSProperties}
              className={cn(
                "surface-card spotlight tilt rise-in relative flex flex-col overflow-hidden p-5 pt-6",
                option.glow
              )}
            >
              <span
                aria-hidden="true"
                className={cn("spotlight-bar absolute inset-x-0 top-0 h-1", option.accent)}
              />
              {/* Large faded icon in the corner that drifts in as the card is hovered. */}
              <OptionIcon
                aria-hidden="true"
                className={cn(
                  "spotlight-mark pointer-events-none absolute -right-6 -top-4 h-32 w-32",
                  option.mark
                )}
              />

              <div className="flex items-center gap-3">
                <span aria-hidden="true" className={cn("icon-tile h-11 w-11", option.tile)}>
                  <OptionIcon className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                    {option.area}
                  </p>
                  <div className="flex items-center gap-2">
                    <h2
                      id={headingId}
                      className="font-display text-xl font-bold leading-tight tracking-tight text-foreground"
                    >
                      {option.title}
                    </h2>
                    {option.badge ? (
                      <span className="rounded-full bg-teal-500/10 px-2 py-0.5 text-xs font-semibold text-teal-700 dark:bg-teal-500/15 dark:text-teal-300">
                        {option.badge}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
              <p className="mt-3 text-sm leading-6 text-foreground/80">{option.about}</p>

              <p className="mt-3 text-xs font-semibold text-foreground">Post here if</p>
              <ul className="mt-2 space-y-1.5 text-sm text-foreground/80">
                {option.fits.map((item) => (
                  <li key={item} className="flex gap-2">
                    <Check
                      aria-hidden="true"
                      className="mt-0.5 h-4 w-4 shrink-0 text-brand-green-600 dark:text-brand-green-400"
                    />
                    {item}
                  </li>
                ))}
              </ul>

              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                <span className="font-semibold text-foreground/80">Covers: </span>
                {option.covers}
              </p>
              <p className="mt-1.5 flex gap-1.5 text-xs leading-5 text-muted-foreground">
                <X aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive/70" />
                <span>
                  <span className="font-semibold text-foreground/80">Not for </span>
                  {option.notFor}
                </span>
              </p>

              <div className="mt-auto pt-4">
                <button
                  type="button"
                  onClick={() => handleChoiceClick(option.href)}
                  disabled={isBusy}
                  aria-label={`${option.action}: ${option.about} (${option.area})`}
                  className={cn(
                    "btn-shine spotlight-cta relative z-[1] flex h-11 w-full items-center justify-center gap-2 rounded-full bg-foreground px-4 text-sm font-semibold text-background shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-wait",
                    isBusy && !isPending && "opacity-60"
                  )}
                >
                  {isPending ? (
                    <>
                      <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                      Opening form...
                    </>
                  ) : (
                    <>
                      {option.action}
                      <ArrowRight
                        aria-hidden="true"
                        className="spotlight-cta-arrow h-4 w-4 shrink-0"
                      />
                    </>
                  )}
                </button>
              </div>
            </section>
          );
        })}
      </div>

      <section
        aria-labelledby="post-guide-title"
        style={{ "--i": POST_OPTIONS.length } as CSSProperties}
        className="surface-card rise-in flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:gap-4"
      >
        <h2
          id="post-guide-title"
          className="shrink-0 font-display text-sm font-bold text-foreground"
        >
          Not sure?
        </h2>
        <ul className="flex min-w-0 flex-1 flex-wrap gap-2">
          {EXAMPLES.map((example) => (
            <li key={example.situation}>
              <button
                type="button"
                onClick={() => handleChoiceClick(example.href)}
                disabled={isBusy}
                className="chip-pop flex min-h-9 items-center gap-2 rounded-full border border-border/70 bg-card py-1 pl-3 pr-1 text-left text-xs transition-colors hover:border-foreground/25 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-wait"
              >
                <span className="text-foreground/85">{example.situation}</span>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 font-semibold",
                    OPTION_TILES[example.option]
                  )}
                >
                  {example.destination}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <Link href="/advertise" prefetch={false} className="link-arrow shrink-0 text-xs lg:ml-auto">
          See advertising options
        </Link>
      </section>
    </div>
  );
}
