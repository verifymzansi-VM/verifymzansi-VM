"use client";

import Link from "next/link";
import Image from "next/image";
import { Building2, Calendar, Eye, MapPin } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { PromotionContactActions } from "@/app/promotion/[id]/promotion-contact-actions";
import { TrustBadge } from "@/components/trust/trust-badge";
import { formatZAR } from "@/lib/utils/format";
import { normalizeMediaUrl } from "@/lib/utils/media-url";
import {
  PROMOTION_TYPE_LABELS,
  type BusinessCategory,
  type PromotionType,
  type SellerVerificationStatus,
} from "@/types/enums";
import { getPromotionCategoryDisplayLabel } from "@/lib/utils/promotion-category";
import { computeTrustLevel } from "@/lib/constants/trust-scale";
import { readAccountVerificationStatus } from "@/lib/account/compat";

export interface PromotionDetailRecord {
  id: string;
  seller_id: string;
  business_id: string | null;
  title: string;
  description: string;
  promotion_type: string;
  category: string | null;
  category_key: BusinessCategory | null;
  photos: string[] | null;
  videos: string[] | null;
  video_thumbnail: string | null;
  price_cents: number | null;
  price_negotiable: boolean;
  location_province: string;
  location_city: string;
  contact_methods: string[] | null;
  start_date: string | null;
  end_date: string | null;
  boost_until: string | null;
  featured_until: string | null;
  view_count: number | null;
  created_at: string;
}

export interface PromotionAdvertiserRecord {
  display_name: string | null;
  account_verification_status?: SellerVerificationStatus | null;
  seller_verification_status: SellerVerificationStatus | null;
  phone: string | null;
  masked_phone_public: string | null;
}

export interface LinkedBusinessRecord {
  id: string;
  business_name: string;
  logo_url: string | null;
}

function getEventState(startDate: string | null, endDate: string | null) {
  const now = new Date();
  const startsAt = startDate ? new Date(startDate) : null;
  const endsAt = endDate ? new Date(endDate) : null;

  if (startsAt && startsAt > now) return "upcoming";
  if (endsAt && endsAt < now) return "ended";
  return "ongoing";
}

const EVENT_STATE_BADGE: Record<string, { label: string; className: string }> = {
  upcoming: {
    label: "Upcoming Event",
    className: "bg-brand-blue text-white",
  },
  ongoing: {
    label: "Happening Now",
    className: "bg-brand-green text-white",
  },
  ended: {
    label: "Event Ended",
    className: "bg-muted text-foreground",
  },
};

const CONTACT_METHOD_LABELS: Record<string, string> = {
  call: "Phone Call",
  whatsapp: "WhatsApp",
  form: "Contact Form",
};

export function PromotionDetailContent({
  promotion,
  advertiserProfile,
  linkedBusiness,
  showContactActions = true,
  showContactSummary = false,
}: {
  promotion: PromotionDetailRecord;
  advertiserProfile: PromotionAdvertiserRecord | null;
  linkedBusiness: LinkedBusinessRecord | null;
  showContactActions?: boolean;
  showContactSummary?: boolean;
}) {
  const photos = promotion.photos ?? [];
  const videos = promotion.videos ?? [];
  const leadVideo = videos[0];
  const leadPhoto = photos[0];
  const leadPoster = promotion.video_thumbnail || leadPhoto || undefined;
  const contactMethods = promotion.contact_methods ?? [];
  const now = new Date();
  const isBoosted = promotion.boost_until ? new Date(promotion.boost_until) > now : false;
  const isFeatured = promotion.featured_until ? new Date(promotion.featured_until) > now : false;
  const isEvent = promotion.promotion_type === "event";
  const eventState = isEvent ? getEventState(promotion.start_date, promotion.end_date) : null;
  const categoryLabel = getPromotionCategoryDisplayLabel(
    promotion.category_key,
    promotion.category
  );
  const trustLevel = advertiserProfile
    ? computeTrustLevel(readAccountVerificationStatus(advertiserProfile))
    : 0;

  return (
    <article className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        {(photos.length > 0 || videos.length > 0) && (
          <div className="grid grid-cols-1 gap-2">
            <div className="relative aspect-[2/1] overflow-hidden rounded-lg bg-warm-100 dark:bg-warm-800">
              {leadVideo ? (
                <video
                  src={normalizeMediaUrl(leadVideo)}
                  controls
                  playsInline
                  preload="metadata"
                  poster={leadPoster ? normalizeMediaUrl(leadPoster) : undefined}
                  className="h-full w-full bg-black object-contain"
                >
                  <track kind="captions" />
                </video>
              ) : (
                <Image
                  src={normalizeMediaUrl(leadPhoto || "/images/placeholder.png")}
                  alt={promotion.title}
                  fill
                  className="object-cover"
                  sizes="(max-width: 1024px) 100vw, 66vw"
                  priority
                />
              )}
              <div className="absolute left-3 top-3 flex gap-1">
                {isFeatured && <Badge className="bg-brand-gold text-amber-950">Featured</Badge>}
                {isBoosted && <Badge className="bg-brand-blue text-white">Boosted</Badge>}
                <Badge variant="secondary">
                  {PROMOTION_TYPE_LABELS[promotion.promotion_type as PromotionType] || "Ad"}
                </Badge>
              </div>
            </div>

            {(leadVideo ? photos.length > 0 : photos.length > 1) && (
              <div className="grid grid-cols-4 gap-2">
                {(leadVideo ? photos : photos.slice(1)).slice(0, 4).map((photo, index) => (
                  <div
                    key={index}
                    className="relative aspect-square overflow-hidden rounded-lg bg-warm-100 dark:bg-warm-800"
                  >
                    <Image
                      src={normalizeMediaUrl(photo)}
                      alt={`${promotion.title} photo ${index + 2}`}
                      fill
                      className="object-cover"
                      sizes="(max-width: 640px) 25vw, 16vw"
                    />
                  </div>
                ))}
              </div>
            )}

            {(leadVideo ? videos.length > 1 : videos.length > 0) && (
              <div className="grid grid-cols-1 gap-2">
                {(leadVideo ? videos.slice(1) : videos).map((videoUrl, index) => (
                  <div
                    key={index}
                    className="relative aspect-video overflow-hidden rounded-lg bg-black"
                  >
                    <video
                      src={normalizeMediaUrl(videoUrl)}
                      controls
                      playsInline
                      preload="metadata"
                      poster={leadPoster ? normalizeMediaUrl(leadPoster) : undefined}
                      className="h-full w-full object-contain"
                    >
                      <track kind="captions" />
                    </video>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <Card>
          <CardContent className="space-y-4 p-6">
            {isEvent && eventState ? (
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={EVENT_STATE_BADGE[eventState].className}>
                  {EVENT_STATE_BADGE[eventState].label}
                </Badge>
                {promotion.start_date && (
                  <Badge variant="outline">
                    Starts {new Date(promotion.start_date).toLocaleDateString("en-ZA")}
                  </Badge>
                )}
                {promotion.end_date && (
                  <Badge variant="outline">
                    Ends {new Date(promotion.end_date).toLocaleDateString("en-ZA")}
                  </Badge>
                )}
              </div>
            ) : null}

            <h2 className="text-lg font-semibold">About this promotion</h2>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
              {promotion.description}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 p-6">
            <h2 className="text-lg font-semibold">Details</h2>
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Type</dt>
              <dd className="font-medium">
                {PROMOTION_TYPE_LABELS[promotion.promotion_type as PromotionType] ||
                  promotion.promotion_type}
              </dd>

              {categoryLabel && (
                <>
                  <dt className="text-muted-foreground">Category</dt>
                  <dd className="font-medium">{categoryLabel}</dd>
                </>
              )}

              <dt className="text-muted-foreground">Location</dt>
              <dd className="flex items-center gap-1 font-medium">
                <MapPin className="h-3 w-3" />
                {promotion.location_city}, {promotion.location_province}
              </dd>

              {promotion.start_date && (
                <>
                  <dt className="text-muted-foreground">Starts</dt>
                  <dd className="flex items-center gap-1 font-medium">
                    <Calendar className="h-3 w-3" />
                    <time dateTime={promotion.start_date}>
                      {new Date(promotion.start_date).toLocaleDateString("en-ZA")}
                    </time>
                  </dd>
                </>
              )}

              {promotion.end_date && (
                <>
                  <dt className="text-muted-foreground">Ends</dt>
                  <dd className="flex items-center gap-1 font-medium">
                    <Calendar className="h-3 w-3" />
                    <time dateTime={promotion.end_date}>
                      {new Date(promotion.end_date).toLocaleDateString("en-ZA")}
                    </time>
                  </dd>
                </>
              )}

              <dt className="text-muted-foreground">Views</dt>
              <dd className="flex items-center gap-1 font-medium">
                <Eye className="h-3 w-3" />
                {promotion.view_count || 0}
              </dd>
            </dl>

            {(showContactSummary || contactMethods.length > 0) && contactMethods.length > 0 && (
              <>
                <Separator />
                <div className="space-y-2">
                  <p className="text-sm font-medium">
                    {showContactSummary ? "Saved contact methods" : "Contact options"}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {contactMethods.map((method) => (
                      <Badge key={method} variant="outline" className="capitalize">
                        {CONTACT_METHOD_LABELS[method] ?? method}
                      </Badge>
                    ))}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        {promotion.price_cents != null && promotion.price_cents > 0 && (
          <Card>
            <CardContent className="space-y-2 p-6">
              <div className="flex items-baseline gap-2">
                <span className="font-display text-2xl font-bold">
                  {formatZAR(promotion.price_cents)}
                </span>
                {promotion.price_negotiable && (
                  <Badge variant="outline" className="text-brand-green">
                    Negotiable
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="space-y-4 p-6">
            <h3 className="font-semibold">Advertiser</h3>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-green font-bold text-white">
                {advertiserProfile?.display_name?.charAt(0)?.toUpperCase() || "A"}
              </div>
              <div>
                <p className="text-sm font-medium">
                  {advertiserProfile?.display_name || "Advertiser"}
                </p>
                <TrustBadge level={trustLevel} size="sm" />
              </div>
            </div>

            <Separator />

            {showContactActions ? (
              <PromotionContactActions
                promotionId={promotion.id}
                contactMethods={contactMethods}
                advertiserPhone={
                  contactMethods.includes("call")
                    ? (advertiserProfile?.masked_phone_public ?? null)
                    : null
                }
                advertiserWhatsapp={
                  contactMethods.includes("whatsapp") ? (advertiserProfile?.phone ?? null) : null
                }
              />
            ) : (
              <div className="space-y-2 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">Creator preview</p>
                <p>Public contact actions appear after approval.</p>
              </div>
            )}
          </CardContent>
        </Card>

        {linkedBusiness && (
          <Card>
            <CardContent className="space-y-3 p-5">
              <h3 className="text-sm font-semibold text-muted-foreground">From Business</h3>
              <Link
                href={`/mzansi-business/${linkedBusiness.id}`}
                className="flex items-center gap-3 transition-opacity hover:opacity-80"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-brand-blue/10">
                  {linkedBusiness.logo_url ? (
                    <Image
                      src={normalizeMediaUrl(linkedBusiness.logo_url)}
                      alt={linkedBusiness.business_name}
                      width={40}
                      height={40}
                      className="object-cover"
                    />
                  ) : (
                    <Building2 className="h-5 w-5 text-brand-blue" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{linkedBusiness.business_name}</p>
                  <p className="text-xs text-brand-blue">View Business</p>
                </div>
              </Link>
            </CardContent>
          </Card>
        )}

        <p className="text-center text-xs text-muted-foreground">
          Posted{" "}
          <time dateTime={promotion.created_at}>
            {new Date(promotion.created_at).toLocaleDateString("en-ZA")}
          </time>
        </p>
      </div>
    </article>
  );
}
