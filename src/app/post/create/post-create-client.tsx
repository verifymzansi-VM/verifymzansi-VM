"use client";

import { BrandShieldAlert as ShieldAlert } from "@/components/shared/brand-shield";
import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Building2,
  Camera,
  ClipboardCheck,
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

interface PostOption {
  title: string;
  tagline: string;
  examples: readonly string[];
  cta: string;
  icon: LucideIcon;
  href: string;
  image: string;
  tile: string;
  accent: string;
  ring: string;
  ctaColor: string;
}

const POST_OPTIONS: readonly PostOption[] = [
  {
    title: "Mzansi Market",
    tagline: "Sell or rent out one item.",
    examples: ["Cars & bakkies", "Phones", "Property"],
    cta: "Post an item",
    icon: ShoppingBag,
    href: "/post/create-listing",
    image: "/images/showrooms/market-v2-mobile.avif",
    tile: "area-market-tile",
    accent: "bg-brand-green-600 dark:bg-brand-green-400",
    ring: "hover:border-brand-green-400/70 focus-visible:ring-brand-green-500/50 dark:hover:border-brand-green-600",
    ctaColor: "text-brand-green-700 dark:text-brand-green-300",
  },
  {
    title: "Mzansi Business",
    tagline: "Create a profile for your business.",
    examples: ["Salons", "Trades", "Restaurants"],
    cta: "Create a business profile",
    icon: Building2,
    href: "/post/create-business",
    image: "/images/showrooms/business-v2-mobile.avif",
    tile: "area-business-tile",
    accent: "bg-brand-blue-600 dark:bg-brand-blue-400",
    ring: "hover:border-brand-blue-400/70 focus-visible:ring-brand-blue-500/50 dark:hover:border-brand-blue-600",
    ctaColor: "text-brand-blue-700 dark:text-brand-blue-300",
  },
  {
    title: "Tourism & Events",
    tagline: "List a stay, experience or event.",
    examples: ["Guest houses", "Tours", "Festivals"],
    cta: "List a stay or event",
    icon: TreePalm,
    href: "/post/create-tourism",
    image: "/images/showrooms/tourism-v2-mobile.avif",
    tile: "area-tourism-tile",
    accent: "bg-sunset-600 dark:bg-sunset-400",
    ring: "hover:border-sunset-400/70 focus-visible:ring-sunset-500/50 dark:hover:border-sunset-600",
    ctaColor: "text-sunset-700 dark:text-sunset-300",
  },
];

const HOW_IT_WORKS: readonly { icon: LucideIcon; title: string }[] = [
  { icon: ShoppingBag, title: "Choose an area" },
  { icon: Camera, title: "Add details and photos" },
  { icon: ClipboardCheck, title: "We check it, then it goes live" },
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

  function handleCategoryClick(optionHref: string) {
    if (pendingHref) return;

    const href = buildPostCategoryHref(optionHref, verificationStatus);
    setPendingHref(href);
    router.push(href);
  }

  const showVerificationCta = verificationStatus !== "pending_review";

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

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-5">
        {POST_OPTIONS.map((option) => {
          const Icon = option.icon;
          const href = buildPostCategoryHref(option.href, verificationStatus);
          const isPending = pendingHref === href;
          const isDisabled = pendingHref !== null;

          return (
            <button
              key={option.href}
              type="button"
              onClick={() => handleCategoryClick(option.href)}
              disabled={isDisabled}
              className={cn(
                "group relative flex h-full w-full flex-col overflow-hidden rounded-3xl border border-border/70 bg-card text-left elev-xs transition-all duration-200 ease-out hover:-translate-y-0.5 hover:elev-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-wait motion-reduce:transition-none motion-reduce:hover:translate-y-0",
                option.ring,
                isPending && "ring-2 ring-offset-2",
                isDisabled && !isPending && "opacity-60"
              )}
            >
              <span aria-hidden="true" className={cn("h-1.5 w-full md:hidden", option.accent)} />
              <span className="relative hidden aspect-[16/9] w-full overflow-hidden md:block">
                <Image
                  src={option.image}
                  alt=""
                  fill
                  sizes="(min-width: 1280px) 400px, 33vw"
                  className="object-cover transition-transform duration-500 group-hover:scale-[1.03] motion-reduce:transition-none"
                />
                <span
                  aria-hidden="true"
                  className="absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-transparent"
                />
              </span>

              <span className="flex flex-1 flex-col gap-4 p-5">
                <span className="flex items-start gap-3.5">
                  <span
                    aria-hidden="true"
                    className="relative z-10 shrink-0 rounded-[1.1rem] md:-mt-12 md:bg-card md:p-1 md:elev-sm"
                  >
                    <span
                      className={cn(
                        "flex h-12 w-12 items-center justify-center rounded-2xl md:h-14 md:w-14",
                        option.tile
                      )}
                    >
                      <Icon className="h-6 w-6" />
                    </span>
                  </span>
                  <span className="min-w-0 pt-0.5 md:pt-0">
                    <span className="block font-display text-xl font-bold leading-tight tracking-tight text-foreground">
                      {option.title}
                    </span>
                    <span className="mt-1 block text-sm font-medium text-foreground/80">
                      {option.tagline}
                    </span>
                  </span>
                </span>

                <span className="flex flex-wrap gap-1.5">
                  {option.examples.map((example) => (
                    <span key={example} className="chip py-0.5">
                      {example}
                    </span>
                  ))}
                </span>

                <span
                  className={cn(
                    "mt-auto flex min-h-11 items-center justify-between gap-2 border-t border-border/60 pt-3 text-sm font-semibold",
                    option.ctaColor
                  )}
                >
                  {isPending ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      Loading...
                    </span>
                  ) : (
                    <span className="underline-offset-4 group-hover:underline">{option.cta}</span>
                  )}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <section
        aria-labelledby="post-how-it-works"
        className="surface-card grid gap-4 p-5 sm:grid-cols-[auto_1fr] sm:items-center sm:gap-8"
      >
        <h2
          id="post-how-it-works"
          className="font-display text-lg font-bold tracking-tight text-foreground"
        >
          How posting works
        </h2>
        <ol className="grid gap-4 sm:grid-cols-3">
          {HOW_IT_WORKS.map((item, index) => {
            const StepIcon = item.icon;
            return (
              <li key={item.title} className="flex items-center gap-3">
                <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground/80">
                  <StepIcon className="h-5 w-5" aria-hidden="true" />
                  <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-brand-green-600 text-[11px] font-bold text-white dark:bg-brand-green-400 dark:text-brand-green-950">
                    {index + 1}
                  </span>
                </span>
                <span className="min-w-0 text-sm font-semibold text-foreground">{item.title}</span>
              </li>
            );
          })}
        </ol>
      </section>

      <p className="text-sm text-muted-foreground">
        Need more visibility after launch?{" "}
        <Link href="/advertise" prefetch={false} className="link-arrow inline">
          See advertising options
        </Link>
      </p>
    </div>
  );
}
