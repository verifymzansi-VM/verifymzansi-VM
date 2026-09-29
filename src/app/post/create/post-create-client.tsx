"use client";

import { BrandShieldAlert as ShieldAlert } from "@/components/shared/brand-shield";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BedDouble,
  Building2,
  CalendarDays,
  Check,
  ChevronRight,
  Loader2,
  ShoppingBag,
  TreePalm,
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
  badge?: string;
}

interface PostArea {
  id: string;
  title: string;
  fitsWhen: string;
  question: string;
  questionHint?: string;
  /** What the poster ends up with, in plain words. */
  youGet?: readonly string[];
  haveReady?: string;
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
    fitsWhen: "Sell an item, list property or advertise a job",
    question:
      "Create a listing for something you are selling or renting out, or a vacancy you want to fill.",
    questionHint: "For example: a phone, a bakkie, a room to rent or a job vacancy.",
    icon: ShoppingBag,
    tile: "area-market-tile",
    accent: "bg-brand-green-600",
    choices: [
      {
        label: "Create a market listing",
        hint: "Choose your category in the form",
        icon: ShoppingBag,
        href: "/post/create-listing",
      },
    ],
  },
  {
    id: "business",
    title: "Mzansi Business",
    fitsWhen: "Help customers find your business",
    question:
      "Create a profile for your shop, practice or services, with contact details, opening hours and photos.",
    questionHint: "For example: a spaza shop, hair salon, plumber, accountant or online shop.",
    icon: Building2,
    tile: "area-business-tile",
    accent: "bg-brand-blue-600",
    choices: [
      {
        label: "Create a business profile",
        hint: "Tell customers what you offer",
        icon: Building2,
        href: "/post/create-business",
      },
    ],
  },
  {
    id: "tourism",
    title: "Tourism & Events",
    fitsWhen: "List a stay, experience or event",
    question: "Help visitors find accommodation, things to do or an event to attend.",
    icon: TreePalm,
    tile: "area-tourism-tile",
    accent: "bg-sunset-600",
    choices: [
      {
        label: "List a stay, experience or attraction",
        hint: "Guest house, tour, safari or visitor attraction",
        icon: BedDouble,
        href: "/post/create-tourism?type=tourism_business",
      },
      {
        label: "Create an event",
        hint: "A festival, workshop, concert or community event",
        icon: CalendarDays,
        href: "/post/create-tourism?type=event",
        badge: "Free to post",
      },
    ],
  },
];
const EXAMPLES: readonly { situation: string; destination: string; href: string }[] = [
  {
    situation: "Selling a cake mixer",
    destination: "Market",
    href: "/post/create-listing?category=home_lifestyle",
  },
  {
    situation: "Advertising a baking business",
    destination: "Business",
    href: "/post/create-business?category=food_dining",
  },
  {
    situation: "Advertising a baking workshop on a particular date",
    destination: "Event",
    href: "/post/create-tourism?type=event",
  },
  {
    situation: "Renting out a residential flat",
    destination: "Market",
    href: "/post/create-listing?category=property",
  },
  {
    situation: "Advertising holiday accommodation",
    destination: "Tourism",
    href: "/post/create-tourism?type=tourism_business",
  },
  {
    situation: "Advertising a venue for hire",
    destination: "Business",
    href: "/post/create-business?category=events_entertainment",
  },
  {
    situation: "Advertising a concert at that venue",
    destination: "Event",
    href: "/post/create-tourism?type=event",
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
              className="surface-card relative overflow-hidden p-4 sm:p-5 lg:grid lg:grid-cols-[18rem_1fr] lg:gap-6"
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
                  {area.youGet ? (
                    <ul className="mt-3 space-y-1.5 text-sm text-foreground/80">
                      {area.youGet.map((item) => (
                        <li key={item} className="flex gap-2">
                          <Check
                            aria-hidden="true"
                            className="mt-0.5 h-4 w-4 shrink-0 text-brand-green-600 dark:text-brand-green-400"
                          />
                          {item}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {area.haveReady ? (
                    <p className="mt-3 text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground/80">Have ready: </span>
                      {area.haveReady}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="mt-4 lg:mt-0">
                <p className="text-sm leading-6 text-foreground">{area.question}</p>
                {area.questionHint ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">{area.questionHint}</p>
                ) : null}
                <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
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
                            <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                              {choice.label}
                              {choice.badge ? (
                                <span className="rounded-full bg-brand-green-600/10 px-1.5 py-px text-[11px] font-semibold text-brand-green-700 dark:bg-brand-green-400/15 dark:text-brand-green-300">
                                  {choice.badge}
                                </span>
                              ) : null}
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
          Not sure where to post?
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
