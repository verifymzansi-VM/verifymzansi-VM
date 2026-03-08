"use client";

import Link from "next/link";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Megaphone,
  ShieldAlert,
  ShoppingBag,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { buildPostCategoryHref } from "@/app/post/_lib/post-access";
import { useAuth } from "@/hooks/use-auth";
import type { SellerVerificationStatus } from "@/types/enums";

const POST_OPTIONS = [
  {
    title: "Mzansi Market",
    summary: "For one item or one listing people want to buy, sell, or rent right now.",
    detail:
      "Use this for products, vehicles, property, spare parts, electronics, and everyday classifieds.",
    whyItMatters:
      "Choose this when the main thing you are advertising is the item itself, not your full business profile.",
    icon: ShoppingBag,
    href: "/post/create-listing",
    badge: "Mzansi Market",
    badgeColor: "bg-brand-green text-white",
    iconColor: "text-brand-green",
  },
  {
    title: "Mzansi Business",
    summary: "For your main business profile and long-term presence on the platform.",
    detail:
      "Use this when people need your services, contact details, hours, location, and business information in one place.",
    whyItMatters:
      "Choose this when you want customers to discover your business, trust it, and contact you beyond a single product post.",
    icon: Building2,
    href: "/post/create-business",
    badge: "Mzansi Business",
    badgeColor: "bg-brand-blue text-white",
    iconColor: "text-brand-blue",
  },
  {
    title: "Promotions & Events",
    summary: "For limited-time offers, launches, specials, campaigns, and event announcements.",
    detail:
      "Use this for deals, opening promotions, event marketing, product launches, and anything time-sensitive.",
    whyItMatters:
      "Choose this when urgency matters and you want people to act within a date, campaign window, or event timeline.",
    icon: Megaphone,
    href: "/post/create-promotion",
    badge: "Promotions & Events",
    badgeColor: "bg-amber-600 text-white",
    iconColor: "text-amber-600",
  },
] as const;

function getVerificationNote(status: SellerVerificationStatus | null | undefined) {
  switch (status) {
    case "pending_review":
      return "Your verification is under review. You can compare the categories now, but approval is required before you open a posting form.";
    case "rejected":
      return "Your previous verification was not approved. Please complete verification again before you start a post.";
    case "incomplete":
    default:
      return "Verification is required before you open a posting form. You can review the categories here first, then continue to verification.";
  }
}

export function PostCreateClient() {
  const { isLoading, isVerified, profile } = useAuth();
  const verificationStatus = profile?.seller_verification_status ?? null;

  return (
    <div className="space-y-4">
      <Alert variant="info" hideIcon className="border-foreground/10 bg-muted/40 text-foreground">
        <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <div>
          <AlertTitle>How to choose the right category</AlertTitle>
          <AlertDescription>
            Mzansi Market is for a single listing. Mzansi Business is for your business profile.
            Promotions &amp; Events is for temporary offers, campaigns, and events.
          </AlertDescription>
        </div>
      </Alert>

      {!isLoading && !isVerified && (
        <Alert className="border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <div>
            <AlertTitle>Verification required before posting</AlertTitle>
            <AlertDescription>{getVerificationNote(verificationStatus)}</AlertDescription>
          </div>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {POST_OPTIONS.map((option) => {
          const Icon = option.icon;
          const href = isLoading
            ? "/post/create"
            : buildPostCategoryHref(option.href, verificationStatus);

          return (
            <Link
              key={option.href}
              href={href}
              aria-disabled={isLoading}
              onClick={(event) => {
                if (isLoading) {
                  event.preventDefault();
                }
              }}
              className={isLoading ? "pointer-events-auto" : undefined}
            >
              <Card className="h-full cursor-pointer transition-all hover:border-brand-green/40 hover:shadow-lg">
                <CardContent className="flex h-full flex-col gap-4 p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="rounded-lg bg-muted p-3">
                      <Icon className={`h-6 w-6 ${option.iconColor}`} />
                    </div>
                    <Badge className={option.badgeColor}>{option.badge}</Badge>
                  </div>

                  <div className="space-y-2">
                    <h2 className="font-display text-xl font-semibold">{option.title}</h2>
                    <p className="text-sm font-medium text-foreground">{option.summary}</p>
                    <p className="text-sm text-muted-foreground">{option.detail}</p>
                  </div>

                  <div className="rounded-xl border border-border/70 bg-muted/30 p-3 text-sm">
                    <p className="font-medium text-foreground">Why you need it</p>
                    <p className="mt-1 text-muted-foreground">{option.whyItMatters}</p>
                  </div>

                  <div className="mt-auto flex items-center gap-1 text-sm font-medium text-brand-green">
                    {isLoading ? "Checking access" : "Get Started"}
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
