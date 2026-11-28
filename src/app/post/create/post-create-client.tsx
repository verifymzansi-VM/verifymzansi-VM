"use client";

import { BrandShieldAlert as ShieldAlert } from "@/components/shared/brand-shield";
import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Building2,
  CalendarDays,
  Loader2,
  ShoppingBag,
  TreePalm,
  type LucideIcon,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  lightTealHoverClassName,
  lightTealSelectedClassName,
} from "@/components/ui/selected-state";
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
  /** The kinds of posts the section is split into. */
  covers: string;
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
    covers: "Property, vehicles and parts, electronics, home, clothing, farming, jobs",
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
    covers: "Shops, food, beauty, health, trades, cleaning, transport, professional services",
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
    covers: "Hotels, guest houses, lodges, self-catering, campsites, tours, attractions",
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
    covers: "Festivals, concerts, workshops, markets, sport, church and community events",
    icon: CalendarDays,
    tile: "area-tourism-tile",
    accent: "bg-teal-500",
    glow: "glow-tourism",
    mark: "text-teal-600",
    href: "/post/create-tourism?type=event",
    badge: "Free to post",
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
                className={cn(
                  "inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-full px-5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  lightTealSelectedClassName,
                  lightTealHoverClassName
                )}
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
                  <p className="text-[11px] font-semibold text-muted-foreground">{option.area}</p>
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

              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                <span className="font-semibold text-foreground/80">Covers: </span>
                {option.covers}
              </p>
              <div className="mt-auto pt-4">
                <button
                  type="button"
                  onClick={() => handleChoiceClick(option.href)}
                  disabled={isBusy}
                  aria-label={`${option.action}: ${option.about} (${option.area})`}
                  className={cn(
                    "spotlight-cta relative z-[1] flex h-11 w-full items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-wait",
                    lightTealSelectedClassName,
                    lightTealHoverClassName,
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
    </div>
  );
}
