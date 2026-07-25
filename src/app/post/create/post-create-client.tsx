"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Building2, Loader2, TreePalm, ShieldAlert, ShoppingBag } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { buildPostCategoryHref } from "@/app/post/_lib/post-access";
import { normalizeAccountVerificationStatus } from "@/lib/account/compat";
import type { AccountVerificationStatus } from "@/types/enums";

const POST_OPTIONS = [
  {
    title: "Mzansi Market",
    tagline: "Sell, buy, or rent a single item.",
    bullets: [
      "Cars, bakkies & vehicles",
      "Property for sale or to rent",
      "Electronics, spare parts & everyday classifieds",
    ],
    icon: ShoppingBag,
    href: "/post/create-listing",
    iconColor: "text-brand-green",
    iconBg: "bg-brand-green/10",
  },
  {
    title: "Mzansi Business",
    tagline: "Create your full business profile.",
    bullets: [
      "Services, hours & location",
      "Contact details in one place",
      "Long-term presence on the platform",
    ],
    icon: Building2,
    href: "/post/create-business",
    iconColor: "text-brand-blue",
    iconBg: "bg-brand-blue/10",
  },
  {
    title: "Tourism & Events",
    tagline: "List accommodation, attractions, or events.",
    bullets: [
      "Hotels, lodges & guest houses",
      "Tours, attractions & experiences",
      "Festivals, concerts & community events",
    ],
    icon: TreePalm,
    href: "/post/create-tourism",
    iconColor: "text-teal-600",
    iconBg: "bg-teal-600/10",
  },
] as const;

function getVerificationNote(status: AccountVerificationStatus | null | undefined) {
  switch (status) {
    case "pending_review":
      return "Your verification is under review. You can browse categories, but approval is needed before posting.";
    case "rejected":
      return "Your verification was rejected. Review the feedback and resubmit the required steps before posting.";
    case "incomplete":
    default:
      return "Verification is required before you can post. Browse the categories, then continue to verification.";
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

  return (
    <div className="space-y-5">
      {hasConfirmedAuth && !canPost && (
        <Alert className="border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <div>
            <AlertTitle>Verification required before posting</AlertTitle>
            <AlertDescription>{getVerificationNote(verificationStatus)}</AlertDescription>
          </div>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
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
              className="group block h-full w-full rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green/50 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-100"
            >
              <Card
                className={`h-full transition-all duration-200 ${
                  isPending
                    ? "border-brand-green/50 bg-brand-green/5"
                    : "cursor-pointer hover:border-brand-green/40 hover:bg-accent/30"
                } ${isDisabled && !isPending ? "opacity-75" : ""}`}
              >
                <CardContent className="flex h-full flex-col gap-4 p-5">
                  <div className={`w-fit rounded-xl p-3 ${option.iconBg}`}>
                    <Icon className={`h-7 w-7 ${option.iconColor}`} />
                  </div>

                  <div>
                    <h2 className="font-display text-lg font-semibold">{option.title}</h2>
                    <p className="mt-0.5 text-sm text-muted-foreground">{option.tagline}</p>
                  </div>

                  <ul className="space-y-1.5 text-sm text-muted-foreground">
                    {option.bullets.map((bullet) => (
                      <li key={bullet} className="flex items-start gap-2">
                        <span
                          aria-hidden="true"
                          className="mt-2 h-1 w-1 flex-shrink-0 rounded-full bg-muted-foreground/50"
                        />
                        {bullet}
                      </li>
                    ))}
                  </ul>

                  <div className="mt-auto flex items-center gap-1 text-sm font-medium text-brand-green">
                    {isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading...
                      </>
                    ) : (
                      <>
                        Get Started
                        <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            </button>
          );
        })}
      </div>

      <p className="text-sm text-muted-foreground">
        Need more visibility after launch?{" "}
        <Link
          href="/advertise"
          prefetch={false}
          className="font-medium text-brand-green underline-offset-4 transition-colors hover:text-brand-green-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          See advertising options
        </Link>
      </p>
    </div>
  );
}
