"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Building2, Megaphone, ShieldAlert, ShoppingBag } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { buildPostCategoryHref } from "@/app/post/_lib/post-access";
import { useAuth } from "@/hooks/use-auth";
import { readAccountVerificationStatus } from "@/lib/account/compat";
import { createLogger } from "@/lib/utils/logger";
import type { AccountVerificationStatus } from "@/types/enums";

const log = createLogger("PostCreateClient");

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
    badge: "Mzansi Market",
    badgeColor: "bg-brand-green text-white",
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
    badge: "Mzansi Business",
    badgeColor: "bg-brand-blue text-white",
    iconColor: "text-brand-blue",
    iconBg: "bg-brand-blue/10",
  },
  {
    title: "Promotions & Events",
    tagline: "Promote something time-sensitive.",
    bullets: [
      "Deals, specials & launches",
      "Event marketing & campaigns",
      "Opening promotions & product drops",
    ],
    icon: Megaphone,
    href: "/post/create-promotion",
    badge: "Promotions & Events",
    badgeColor: "bg-amber-600 text-white",
    iconColor: "text-amber-600",
    iconBg: "bg-amber-600/10",
  },
] as const;

function getVerificationNote(status: AccountVerificationStatus | null | undefined) {
  switch (status) {
    case "pending_review":
      return "Your verification is under review. You can browse categories, but approval is needed before posting.";
    case "rejected":
      return "Your previous verification was not approved. Please verify again to start posting.";
    case "incomplete":
    default:
      return "Verification is required before you can post. Browse the categories, then continue to verification.";
  }
}

export function PostCreateClient() {
  const { isLoading, isAuthenticated, profile, refresh } = useAuth();
  const refreshedRef = useRef(false);
  const [resolvedStatus, setResolvedStatus] = useState<
    AccountVerificationStatus | null | undefined
  >(() => readAccountVerificationStatus(profile));
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);

  useEffect(() => {
    setResolvedStatus(readAccountVerificationStatus(profile));
  }, [profile]);

  useEffect(() => {
    if (refreshedRef.current) {
      return;
    }

    refreshedRef.current = true;
    if (typeof refresh === "function") {
      void refresh();
    }
  }, [refresh]);

  useEffect(() => {
    if (isLoading || !isAuthenticated) {
      return;
    }

    const controller = new AbortController();

    async function syncResolvedStatus() {
      setIsCheckingStatus(true);

      try {
        const response = await fetch("/api/verification/status", {
          signal: controller.signal,
          cache: "no-store",
        });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as {
          accountVerificationStatus?: AccountVerificationStatus | null;
          overallStatus?: AccountVerificationStatus | null;
        };

        setResolvedStatus(payload.accountVerificationStatus ?? payload.overallStatus ?? null);
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        log.warn("Failed to load reconciled verification status", {
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        if (!controller.signal.aborted) {
          setIsCheckingStatus(false);
        }
      }
    }

    void syncResolvedStatus();

    return () => {
      controller.abort();
    };
  }, [isAuthenticated, isLoading]);

  const verificationStatus = resolvedStatus;
  const canPost = verificationStatus === "verified";
  const showLoadingState = isLoading || (isAuthenticated && isCheckingStatus);

  return (
    <div className="space-y-4">
      {!showLoadingState && !canPost && (
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
          const href = showLoadingState
            ? "/post/create"
            : buildPostCategoryHref(option.href, verificationStatus);

          return (
            <Link
              key={option.href}
              href={href}
              aria-disabled={showLoadingState}
              onClick={(event) => {
                if (showLoadingState) {
                  event.preventDefault();
                }
              }}
              className={showLoadingState ? "pointer-events-auto" : undefined}
            >
              <Card className="h-full cursor-pointer transition-all hover:border-brand-green/40 hover:shadow-lg">
                <CardContent className="flex h-full flex-col gap-4 p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div className={`rounded-xl p-3 ${option.iconBg}`}>
                      <Icon className={`h-8 w-8 ${option.iconColor}`} />
                    </div>
                    <Badge className={option.badgeColor}>{option.badge}</Badge>
                  </div>

                  <div>
                    <h2 className="font-display text-lg font-semibold">{option.title}</h2>
                    <p className="mt-0.5 text-sm text-muted-foreground">{option.tagline}</p>
                  </div>

                  <ul className="space-y-1.5 text-sm text-muted-foreground">
                    {option.bullets.map((bullet) => (
                      <li key={bullet} className="flex items-start gap-2">
                        <span
                          className={`mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full ${option.badgeColor.split(" ")[0]}`}
                        />
                        {bullet}
                      </li>
                    ))}
                  </ul>

                  <div className="mt-auto flex items-center gap-1 text-sm font-medium text-brand-green">
                    {showLoadingState ? "Checking access" : "Get Started"}
                    <ArrowRight className="h-4 w-4" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
