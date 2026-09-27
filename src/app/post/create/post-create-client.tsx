"use client";

import { BrandShieldAlert as ShieldAlert } from "@/components/shared/brand-shield";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Baby,
  BedDouble,
  Briefcase,
  Building2,
  CalendarDays,
  Car,
  ChevronRight,
  Cog,
  Globe,
  House,
  Loader2,
  ShoppingBag,
  Smartphone,
  Sofa,
  Store,
  Tent,
  Tractor,
  TreePalm,
  Truck,
  type LucideIcon,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buildPostCategoryHref } from "@/app/post/_lib/post-access";
import { normalizeAccountVerificationStatus } from "@/lib/account/compat";
import { cn } from "@/lib/utils";
import type { AccountVerificationStatus } from "@/types/enums";

interface PostChoice {
  label: string;
  hint: string;
  icon: LucideIcon;
  href: string;
}

interface PostArea {
  id: string;
  title: string;
  fitsWhen: string;
  question: string;
  icon: LucideIcon;
  tile: string;
  accent: string;
  choices: readonly PostChoice[];
}

// Each choice opens the matching form with the category or type already set.
const POST_AREAS: readonly PostArea[] = [
  {
    id: "market",
    title: "Mzansi Market",
    fitsWhen: "You have one thing to sell or rent out, or a job to fill.",
    question: "What is it?",
    icon: ShoppingBag,
    tile: "area-market-tile",
    accent: "bg-brand-green-600 dark:bg-brand-green-400",
    choices: [
      {
        label: "Property",
        hint: "House, flat, room or land",
        icon: House,
        href: "/post/create-listing?category=property",
      },
      {
        label: "Vehicle",
        hint: "Car, bakkie, bike or truck",
        icon: Car,
        href: "/post/create-listing?category=vehicles",
      },
      {
        label: "Auto parts",
        hint: "Spares, tyres, accessories",
        icon: Cog,
        href: "/post/create-listing?category=auto_parts",
      },
      {
        label: "Electronics",
        hint: "Phone, laptop, TV, console",
        icon: Smartphone,
        href: "/post/create-listing?category=electronics",
      },
      {
        label: "Home & lifestyle",
        hint: "Furniture, appliances, fashion",
        icon: Sofa,
        href: "/post/create-listing?category=home_lifestyle",
      },
      {
        label: "Baby & kids",
        hint: "Prams, toys, clothes",
        icon: Baby,
        href: "/post/create-listing?category=baby_kids",
      },
      {
        label: "Farming",
        hint: "Livestock, crops, equipment",
        icon: Tractor,
        href: "/post/create-listing?category=farming_agriculture",
      },
      {
        label: "Job or service",
        hint: "Vacancy or once-off service",
        icon: Briefcase,
        href: "/post/create-listing?category=jobs_services",
      },
    ],
  },
  {
    id: "business",
    title: "Mzansi Business",
    fitsWhen: "You run a business and want customers to find you.",
    question: "How do customers reach you?",
    icon: Building2,
    tile: "area-business-tile",
    accent: "bg-brand-blue-600 dark:bg-brand-blue-400",
    choices: [
      {
        label: "Own premises",
        hint: "Shop, office, salon or workshop",
        icon: Store,
        href: "/post/create-business?type=standalone_shop",
      },
      {
        label: "From home",
        hint: "Run from where you live",
        icon: House,
        href: "/post/create-business?type=home_business",
      },
      {
        label: "Mobile service",
        hint: "You travel to your clients",
        icon: Truck,
        href: "/post/create-business?type=mobile_service",
      },
      {
        label: "Online only",
        hint: "Website or social media",
        icon: Globe,
        href: "/post/create-business?type=online_only",
      },
      {
        label: "Mall store",
        hint: "Inside a shopping centre",
        icon: Building2,
        href: "/post/create-business?type=mall_store",
      },
      {
        label: "Market stall",
        hint: "Flea or farmers market",
        icon: Tent,
        href: "/post/create-business?type=market_stall",
      },
    ],
  },
  {
    id: "tourism",
    title: "Tourism & Events",
    fitsWhen: "You host visitors or you're putting on an event.",
    question: "What are you listing?",
    icon: TreePalm,
    tile: "area-tourism-tile",
    accent: "bg-sunset-600 dark:bg-sunset-400",
    choices: [
      {
        label: "Stay, tour or attraction",
        hint: "Guest house, lodge, tours, safaris",
        icon: BedDouble,
        href: "/post/create-tourism?type=tourism_business",
      },
      {
        label: "Event",
        hint: "Festival, gig, market or expo",
        icon: CalendarDays,
        href: "/post/create-tourism?type=event",
      },
    ],
  },
];

// The mix-ups people hit most often, each with where it belongs.
const EXAMPLES: readonly { situation: string; destination: string; href: string }[] = [
  {
    situation: "Selling your own car",
    destination: "Market · Vehicle",
    href: "/post/create-listing?category=vehicles",
  },
  {
    situation: "You own a car dealership",
    destination: "Business · Own premises",
    href: "/post/create-business?type=standalone_shop",
  },
  {
    situation: "Renting out a flat by the month",
    destination: "Market · Property",
    href: "/post/create-listing?category=property",
  },
  {
    situation: "Renting out rooms by the night",
    destination: "Tourism · Stay",
    href: "/post/create-tourism?type=tourism_business",
  },
  {
    situation: "Hiring staff for your shop",
    destination: "Market · Job or service",
    href: "/post/create-listing?category=jobs_services",
  },
  {
    situation: "You're a plumber or electrician",
    destination: "Business · Mobile service",
    href: "/post/create-business?type=mobile_service",
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
    <div className="space-y-6">
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

      <div className="space-y-4">
        {POST_AREAS.map((area) => {
          const AreaIcon = area.icon;
          const headingId = `post-area-${area.id}`;

          return (
            <section
              key={area.id}
              aria-labelledby={headingId}
              className="surface-card relative overflow-hidden p-4 sm:p-5 lg:grid lg:grid-cols-[16rem_1fr] lg:gap-6"
            >
              <span
                aria-hidden="true"
                className={cn("absolute inset-y-0 left-0 w-1", area.accent)}
              />

              <div className="flex items-start gap-3 lg:flex-col lg:gap-3">
                <span aria-hidden="true" className={cn("icon-tile h-11 w-11", area.tile)}>
                  <AreaIcon className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <h2
                    id={headingId}
                    className="font-display text-lg font-bold leading-tight tracking-tight text-foreground"
                  >
                    {area.title}
                  </h2>
                  <p className="mt-1 text-sm text-foreground/80">{area.fitsWhen}</p>
                </div>
              </div>

              <div className="mt-4 lg:mt-0">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {area.question}
                </p>
                <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  {area.choices.map((choice) => {
                    const ChoiceIcon = choice.icon;
                    const isPending = pendingHref === choice.href;

                    return (
                      <li key={choice.href}>
                        <button
                          type="button"
                          onClick={() => handleChoiceClick(choice.href)}
                          disabled={isBusy}
                          aria-label={`${choice.label}: ${choice.hint} (${area.title})`}
                          className={cn(
                            "group flex h-full min-h-14 w-full items-center gap-3 rounded-xl border border-border/70 bg-card px-3 py-2.5 text-left transition-colors hover:border-foreground/25 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-wait",
                            isPending && "border-foreground/30 bg-muted/60",
                            isBusy && !isPending && "opacity-60"
                          )}
                        >
                          <span aria-hidden="true" className="text-foreground/70">
                            {isPending ? (
                              <Loader2 className="h-5 w-5 animate-spin" />
                            ) : (
                              <ChoiceIcon className="h-5 w-5" />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold text-foreground">
                              {choice.label}
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              {isPending ? "Opening form..." : choice.hint}
                            </span>
                          </span>
                          <ChevronRight
                            aria-hidden="true"
                            className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                          />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </section>
          );
        })}
      </div>

      <details className="surface-card group p-4 sm:p-5">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">
          Not sure where it fits? See common examples
          <ChevronRight
            aria-hidden="true"
            className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90 motion-reduce:transition-none"
          />
        </summary>
        <ul className="mt-3 divide-y divide-border/60">
          {EXAMPLES.map((example) => (
            <li key={example.situation}>
              <button
                type="button"
                onClick={() => handleChoiceClick(example.href)}
                disabled={isBusy}
                className="flex min-h-11 w-full items-center justify-between gap-3 py-2 text-left text-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait"
              >
                <span className="text-foreground/80">{example.situation}</span>
                <span className="shrink-0 font-semibold text-foreground">
                  {example.destination}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </details>

      <p className="text-sm text-muted-foreground">
        Need more visibility after launch?{" "}
        <Link href="/advertise" prefetch={false} className="link-arrow inline">
          See advertising options
        </Link>
      </p>
    </div>
  );
}
