"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Building2, Megaphone, ShieldAlert, ShoppingBag } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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

interface PostCreateClientProps {
  initialVerificationStatus: AccountVerificationStatus | null;
  isAuthenticated: boolean;
}

export function PostCreateClient({
  initialVerificationStatus,
  isAuthenticated,
}: PostCreateClientProps) {
  const [resolvedVerificationStatus, setResolvedVerificationStatus] =
    useState<AccountVerificationStatus | null>(null);
  const [hasConfirmedAuth, setHasConfirmedAuth] = useState(isAuthenticated);
  const verificationStatus = resolvedVerificationStatus ?? initialVerificationStatus;
  const canPost = verificationStatus === "verified";

  useEffect(() => {
    let isCancelled = false;

    if (initialVerificationStatus === "verified") {
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

    return () => {
      isCancelled = true;
    };
  }, [initialVerificationStatus, isAuthenticated]);

  return (
    <div className="space-y-4">
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

          return (
            <Link key={option.href} href={href}>
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
                    Get Started
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
