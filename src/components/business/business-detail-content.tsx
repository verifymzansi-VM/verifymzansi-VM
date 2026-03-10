"use client";

import Image from "next/image";
import {
  Clock,
  CreditCard,
  Facebook,
  Globe,
  Instagram,
  Mail,
  MapPin,
  MessageCircle,
  MessageSquare,
  Music2,
  Phone,
  ShieldCheck,
  Store,
  Truck,
  Twitter,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { TrustBadge } from "@/components/trust/trust-badge";
import { ShareButton } from "@/components/shared/share-button";
import { ReportDialog } from "@/components/shared/report-dialog";
import { BusinessGallery } from "@/components/listings/business-gallery";
import { BusinessPromoVideo } from "@/components/listings/business-promo-video";
import { PromotionCard } from "@/components/listings/promotion-card";
import { normalizeMediaUrl } from "@/lib/utils/media-url";
import {
  BUSINESS_CATEGORY_LABELS,
  BUSINESS_TYPE_LABELS,
  type BusinessCategory,
  type BusinessType,
  type PromotionType,
} from "@/types/enums";
import { getPromotionCategoryDisplayLabel } from "@/lib/utils/promotion-category";
import {
  PRIMARY_ORDER_CHANNEL_LABELS,
  WALK_IN_POLICY_LABELS,
} from "@/lib/forms/business-type-details";
import type { BusinessDetails } from "@/types/business-details";

const zarCurrency = new Intl.NumberFormat("en-ZA", {
  style: "currency",
  currency: "ZAR",
  maximumFractionDigits: 0,
});

export interface BusinessDetailRecord {
  id: string;
  seller_id: string;
  business_name: string;
  description: string | null;
  status: string;
  business_type: string;
  category: string;
  cover_photo: string | null;
  logo_url: string | null;
  cover_video: string | null;
  video_thumbnail: string | null;
  gallery_photos: string[] | null;
  social_links: Record<string, string> | null;
  operating_hours: Record<string, string> | null;
  services_offered: string[] | null;
  payment_methods_accepted: string[] | null;
  delivery_options: string[] | null;
  service_areas: { areas?: string[] } | null;
  location_city: string | null;
  location_province: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  website: string | null;
  store_number: string | null;
  mall_id: string | null;
  map_directions: string | null;
  business_details: BusinessDetails | null;
}

export interface BusinessSellerRecord {
  display_name: string | null;
}

export interface BusinessLinkedMallRecord {
  id: string;
  name: string;
}

export interface BusinessPromotionRecord {
  id: string;
  title: string;
  promotion_type: string;
  category: string | null;
  category_key: string | null;
  photos: string[] | null;
  videos: string[] | null;
  video_thumbnail: string | null;
  price_cents: number | null;
  price_negotiable: boolean;
  location_province: string;
  location_city: string;
  boost_until: string | null;
  featured_until: string | null;
  view_count: number | null;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
}

function ContactCard({
  business,
  hasOnlineLinks,
  socialLinks,
}: {
  business: BusinessDetailRecord;
  hasOnlineLinks: boolean;
  socialLinks: Record<string, string> | null;
}) {
  return (
    <Card className="border-t-4 border-t-brand-blue shadow-md">
      <CardContent className="space-y-5 p-6">
        <h3 className="font-display text-lg font-bold">Contact Business</h3>

        <address className="space-y-3 not-italic">
          {business.phone && (
            <a
              href={`tel:${business.phone}`}
              className="flex items-center gap-3 rounded-lg bg-muted/50 p-3 transition-colors hover:bg-muted"
            >
              <div className="rounded-full bg-primary/10 p-2 text-primary">
                <Phone className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Call
                </p>
                <p className="font-medium">{business.phone}</p>
              </div>
            </a>
          )}

          {business.whatsapp && (
            <a
              href={`https://wa.me/${business.whatsapp.replace(/\D/g, "")}`}
              target="_blank"
              rel="noopener noreferrer nofollow ugc"
              className="flex items-center gap-3 rounded-lg border border-green-100 bg-green-50 p-3 transition-colors hover:bg-green-100 dark:border-green-800 dark:bg-green-950/40 dark:hover:bg-green-950/60"
            >
              <div className="rounded-full bg-green-500 p-2 text-white">
                <MessageCircle className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-green-700 dark:text-green-300">
                  WhatsApp
                </p>
                <p className="font-medium text-green-900 dark:text-green-100">
                  {business.whatsapp}
                </p>
              </div>
            </a>
          )}

          {business.email && (
            <a
              href={`mailto:${business.email}`}
              className="flex items-center gap-3 rounded-lg bg-muted/50 p-3 transition-colors hover:bg-muted"
            >
              <div className="rounded-full bg-secondary p-2 text-secondary-foreground">
                <Mail className="h-5 w-5" />
              </div>
              <div className="overflow-hidden">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Email
                </p>
                <p className="truncate font-medium">{business.email}</p>
              </div>
            </a>
          )}

          {!business.phone && !business.whatsapp && !business.email && (
            <a
              href={`mailto:support@verifymzansi.com?subject=Enquiry about ${encodeURIComponent(
                business.business_name
              )}&body=Hi, I found ${encodeURIComponent(
                business.business_name
              )} on VerifyMzansi and would like to get in touch.`}
            >
              <Button className="w-full gap-2" size="lg">
                <MessageSquare className="h-4 w-4" />
                Send Message via Platform
              </Button>
            </a>
          )}
        </address>

        {hasOnlineLinks && (
          <>
            <Separator />
            <div>
              <p className="mb-3 text-sm font-medium text-muted-foreground">Connect Online</p>
              <div className="flex gap-2">
                {socialLinks?.facebook && (
                  <a
                    href={socialLinks.facebook}
                    target="_blank"
                    rel="noopener noreferrer nofollow ugc"
                    title="Facebook"
                    className="rounded-full bg-[#1877F2]/10 p-2.5 text-[#1877F2] transition-colors hover:bg-[#1877F2]/20"
                  >
                    <Facebook className="h-5 w-5 fill-current" />
                  </a>
                )}
                {socialLinks?.instagram && (
                  <a
                    href={socialLinks.instagram}
                    target="_blank"
                    rel="noopener noreferrer nofollow ugc"
                    title="Instagram"
                    className="rounded-full bg-[#E4405F]/10 p-2.5 text-[#E4405F] transition-colors hover:bg-[#E4405F]/20"
                  >
                    <Instagram className="h-5 w-5" />
                  </a>
                )}
                {socialLinks?.twitter && (
                  <a
                    href={socialLinks.twitter}
                    target="_blank"
                    rel="noopener noreferrer nofollow ugc"
                    title="Twitter"
                    className="rounded-full bg-black/5 p-2.5 text-black transition-colors hover:bg-black/10 dark:bg-white/10 dark:text-white dark:hover:bg-white/20"
                  >
                    <Twitter className="h-5 w-5 fill-current" />
                  </a>
                )}
                {socialLinks?.tiktok && (
                  <a
                    href={socialLinks.tiktok}
                    target="_blank"
                    rel="noopener noreferrer nofollow ugc"
                    title="TikTok"
                    className="rounded-full bg-black/5 p-2.5 text-foreground transition-colors hover:bg-black/10 dark:bg-white/10 dark:text-white dark:hover:bg-white/20"
                  >
                    <Music2 className="h-5 w-5" />
                  </a>
                )}
                {business.website && (
                  <a
                    href={business.website}
                    target="_blank"
                    rel="noopener noreferrer nofollow ugc"
                    title="Website"
                    className="rounded-full bg-muted p-2.5 text-foreground transition-colors hover:bg-muted/80"
                  >
                    <Globe className="h-5 w-5" />
                  </a>
                )}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function BusinessDetailsCard({
  business,
  businessType,
  businessDetails,
  linkedMall,
  serviceAreas,
}: {
  business: BusinessDetailRecord;
  businessType: BusinessType;
  businessDetails: BusinessDetails | null;
  linkedMall: BusinessLinkedMallRecord | null;
  serviceAreas: { areas?: string[] } | null;
}) {
  const canShowMapDirections = businessType !== "home_business";

  if (
    !(
      businessDetails ||
      business.store_number ||
      (canShowMapDirections && business.map_directions) ||
      serviceAreas
    )
  ) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Business Details</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {businessType === "mall_store" && (
          <>
            {business.store_number && (
              <div className="flex items-start justify-between gap-4">
                <span className="text-muted-foreground">Store number</span>
                <span className="text-right font-medium">{business.store_number}</span>
              </div>
            )}
            {linkedMall?.name && (
              <div className="flex items-start justify-between gap-4">
                <span className="text-muted-foreground">Mall</span>
                <span className="text-right font-medium">{linkedMall.name}</span>
              </div>
            )}
            {businessDetails?.type === "mall_store" && businessDetails.floor_or_wing && (
              <div className="flex items-start justify-between gap-4">
                <span className="text-muted-foreground">Floor / wing</span>
                <span className="text-right font-medium">{businessDetails.floor_or_wing}</span>
              </div>
            )}
            {businessDetails?.type === "mall_store" && businessDetails.nearest_entrance && (
              <div className="flex items-start justify-between gap-4">
                <span className="text-muted-foreground">Nearest entrance</span>
                <span className="text-right font-medium">{businessDetails.nearest_entrance}</span>
              </div>
            )}
            {businessDetails?.type === "mall_store" && businessDetails.parking_notes && (
              <div className="space-y-1">
                <p className="text-muted-foreground">Parking notes</p>
                <p className="font-medium">{businessDetails.parking_notes}</p>
              </div>
            )}
          </>
        )}

        {businessType === "standalone_shop" && businessDetails?.type === "standalone_shop" && (
          <>
            <div className="flex items-start justify-between gap-4">
              <span className="text-muted-foreground">Street address</span>
              <span className="text-right font-medium">{businessDetails.street_address}</span>
            </div>
            <div className="flex items-start justify-between gap-4">
              <span className="text-muted-foreground">Suburb</span>
              <span className="text-right font-medium">{businessDetails.suburb}</span>
            </div>
            {businessDetails.landmark && (
              <div className="flex items-start justify-between gap-4">
                <span className="text-muted-foreground">Landmark</span>
                <span className="text-right font-medium">{businessDetails.landmark}</span>
              </div>
            )}
            {businessDetails.walk_in_policy && (
              <div className="flex items-start justify-between gap-4">
                <span className="text-muted-foreground">Walk-in policy</span>
                <span className="text-right font-medium">
                  {WALK_IN_POLICY_LABELS[businessDetails.walk_in_policy]}
                </span>
              </div>
            )}
          </>
        )}

        {businessType === "home_business" && businessDetails?.type === "home_business" && (
          <>
            <div className="flex items-start justify-between gap-4">
              <span className="text-muted-foreground">Service suburb</span>
              <span className="text-right font-medium">{businessDetails.service_suburb}</span>
            </div>
            <div className="flex items-start justify-between gap-4">
              <span className="text-muted-foreground">Appointment required</span>
              <span className="text-right font-medium">
                {businessDetails.appointment_required ? "Yes" : "No"}
              </span>
            </div>
            <div className="flex items-start justify-between gap-4">
              <span className="text-muted-foreground">Customer pickup</span>
              <span className="text-right font-medium">
                {businessDetails.customer_pickup_allowed ? "Available" : "Not available"}
              </span>
            </div>
            {businessDetails.visitor_notes && (
              <div className="space-y-1">
                <p className="text-muted-foreground">Visitor notes</p>
                <p className="font-medium">{businessDetails.visitor_notes}</p>
              </div>
            )}
          </>
        )}

        {businessType === "mobile_service" && businessDetails?.type === "mobile_service" && (
          <>
            {serviceAreas?.areas && serviceAreas.areas.length > 0 && (
              <div className="space-y-1">
                <p className="text-muted-foreground">Service areas</p>
                <div className="flex flex-wrap gap-2">
                  {serviceAreas.areas.map((area) => (
                    <Badge key={area} variant="secondary">
                      {area}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {typeof businessDetails.travel_radius_km === "number" && (
              <div className="flex items-start justify-between gap-4">
                <span className="text-muted-foreground">Travel radius</span>
                <span className="text-right font-medium">
                  {businessDetails.travel_radius_km} km
                </span>
              </div>
            )}
            {typeof businessDetails.callout_fee_from === "number" && (
              <div className="flex items-start justify-between gap-4">
                <span className="text-muted-foreground">Callout fee from</span>
                <span className="text-right font-medium">
                  {zarCurrency.format(businessDetails.callout_fee_from)}
                </span>
              </div>
            )}
            <div className="flex items-start justify-between gap-4">
              <span className="text-muted-foreground">Emergency callouts</span>
              <span className="text-right font-medium">
                {businessDetails.emergency_callouts ? "Available" : "Not available"}
              </span>
            </div>
          </>
        )}

        {businessType === "online_only" && businessDetails?.type === "online_only" && (
          <>
            {businessDetails.primary_order_channel && (
              <div className="flex items-start justify-between gap-4">
                <span className="text-muted-foreground">Primary order channel</span>
                <span className="text-right font-medium">
                  {PRIMARY_ORDER_CHANNEL_LABELS[businessDetails.primary_order_channel]}
                </span>
              </div>
            )}
            <Button asChild variant="outline" className="w-full gap-2">
              <a
                href={businessDetails.order_url}
                target="_blank"
                rel="noopener noreferrer nofollow"
              >
                <Globe className="h-4 w-4" />
                Order Online
              </a>
            </Button>
            <div className="space-y-1">
              <p className="text-muted-foreground">Delivery regions</p>
              <div className="flex flex-wrap gap-2">
                {businessDetails.delivery_regions.map((region) => (
                  <Badge key={region} variant="secondary">
                    {region}
                  </Badge>
                ))}
              </div>
            </div>
            {businessDetails.support_response_time && (
              <div className="flex items-start justify-between gap-4">
                <span className="text-muted-foreground">Support response time</span>
                <span className="text-right font-medium">
                  {businessDetails.support_response_time}
                </span>
              </div>
            )}
          </>
        )}

        {businessType === "market_stall" && businessDetails?.type === "market_stall" && (
          <>
            <div className="flex items-start justify-between gap-4">
              <span className="text-muted-foreground">Market name</span>
              <span className="text-right font-medium">{businessDetails.market_name}</span>
            </div>
            {businessDetails.stall_label && (
              <div className="flex items-start justify-between gap-4">
                <span className="text-muted-foreground">Stall label</span>
                <span className="text-right font-medium">{businessDetails.stall_label}</span>
              </div>
            )}
            <div className="space-y-1">
              <p className="text-muted-foreground">Trading days</p>
              <div className="flex flex-wrap gap-2">
                {businessDetails.trading_days.map((day) => (
                  <Badge key={day} variant="secondary">
                    {day}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="flex items-start justify-between gap-4">
              <span className="text-muted-foreground">Trading hours</span>
              <span className="text-right font-medium">{businessDetails.trading_hours}</span>
            </div>
          </>
        )}

        {canShowMapDirections && business.map_directions && (
          <Button asChild variant="outline" className="w-full gap-2">
            <a href={business.map_directions} target="_blank" rel="noopener noreferrer nofollow">
              <MapPin className="h-4 w-4" />
              Open Map Directions
            </a>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function BusinessDetailContent({
  business,
  trustLevel,
  seller,
  linkedMall,
  promotions = [],
  showPromotions = true,
  showPublicActions = true,
}: {
  business: BusinessDetailRecord;
  trustLevel: number | null;
  seller: BusinessSellerRecord | null;
  linkedMall: BusinessLinkedMallRecord | null;
  promotions?: BusinessPromotionRecord[];
  showPromotions?: boolean;
  showPublicActions?: boolean;
}) {
  const socialLinks = business.social_links;
  const opHours = business.operating_hours;
  const businessDetails = business.business_details;
  const galleryPhotos = business.gallery_photos ?? [];
  const serviceAreas = business.service_areas;
  const hasOnlineLinks = Boolean(
    socialLinks?.facebook ||
    socialLinks?.instagram ||
    socialLinks?.twitter ||
    socialLinks?.tiktok ||
    business.website
  );
  const businessType = business.business_type as BusinessType;
  const businessCategory = business.category as BusinessCategory;

  return (
    <>
      <div className="relative overflow-hidden rounded-2xl border bg-background shadow-sm">
        {business.cover_photo ? (
          <div className="relative aspect-[21/9] overflow-hidden bg-muted md:aspect-[4/1]">
            <Image
              src={normalizeMediaUrl(business.cover_photo)}
              alt={`${business.business_name} Cover`}
              fill
              className="object-cover"
              priority
              sizes="100vw"
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
          </div>
        ) : (
          <div className="flex aspect-[21/9] items-center justify-center bg-gradient-to-r from-brand-blue/80 to-brand-blue md:aspect-[4/1]">
            <Store className="h-20 w-20 text-white/50" />
          </div>
        )}

        <div className="relative z-10 mx-auto flex w-full flex-col items-center gap-6 px-6 pb-6 pt-4 text-center md:flex-row md:items-end md:gap-8 md:text-left">
          <div className="h-24 w-24 flex-shrink-0 overflow-hidden rounded-2xl border bg-white p-2 shadow-xl dark:bg-warm-900">
            {business.logo_url ? (
              <Image
                src={normalizeMediaUrl(business.logo_url)}
                alt={`${business.business_name} Logo`}
                width={128}
                height={128}
                className="h-full w-full rounded-xl object-contain"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center rounded-xl bg-muted">
                <Store className="h-10 w-10 text-muted-foreground" />
              </div>
            )}
          </div>
          <div className="flex-1 pt-12 md:pt-0">
            <h1 className="font-display text-2xl font-bold text-foreground md:text-3xl">
              {business.business_name}
            </h1>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2 md:justify-start">
              <Badge variant="outline" className="text-xs">
                {BUSINESS_TYPE_LABELS[businessType]}
              </Badge>
              <Badge variant="secondary" className="text-xs">
                {BUSINESS_CATEGORY_LABELS[businessCategory]}
              </Badge>
              {business.store_number && business.store_number !== "N/A" && (
                <span className="flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 text-sm text-foreground">
                  <Store className="h-4 w-4 text-brand-blue" />
                  Shop {business.store_number}
                </span>
              )}
              {(business.location_province || business.location_city) && (
                <span className="flex items-center gap-1 text-sm text-muted-foreground">
                  <MapPin className="h-4 w-4" />
                  {[business.location_city, business.location_province].filter(Boolean).join(", ")}
                </span>
              )}
            </div>
          </div>
          <div className="mb-2 hidden gap-3 self-end md:flex">
            {business.phone && (
              <Button asChild className="gap-2 shrink-0 shadow-md">
                <a href={`tel:${business.phone}`}>
                  <Phone className="h-4 w-4" /> Call
                </a>
              </Button>
            )}
          </div>
        </div>
      </div>
      <article className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {business.cover_video && (
            <BusinessPromoVideo
              videoUrl={normalizeMediaUrl(business.cover_video)}
              thumbnailUrl={
                business.video_thumbnail ? normalizeMediaUrl(business.video_thumbnail) : undefined
              }
              businessName={business.business_name}
            />
          )}

          {galleryPhotos.length > 0 && (
            <BusinessGallery
              photos={galleryPhotos.map((url) => normalizeMediaUrl(url))}
              businessName={business.business_name}
            />
          )}

          <Card>
            <CardContent className="space-y-4 p-6">
              <h2 className="font-display text-xl font-bold">About {business.business_name}</h2>
              <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">
                {business.description || "No description provided."}
              </p>
            </CardContent>
          </Card>

          <BusinessDetailsCard
            business={business}
            businessType={businessType}
            businessDetails={businessDetails}
            linkedMall={linkedMall}
            serviceAreas={serviceAreas}
          />

          {business.services_offered && business.services_offered.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Wrench className="h-4 w-4 text-muted-foreground" />
                  Services Offered
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {business.services_offered.map((service, index) => (
                    <Badge key={index} variant="secondary">
                      {service}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {businessType === "mobile_service" && business.service_areas && (
            <Card className="border-brand-blue/30 bg-brand-blue/5">
              <CardContent className="p-6">
                <div className="flex items-center gap-3">
                  <div className="rounded-full bg-brand-blue/10 p-3">
                    <MapPin className="h-6 w-6 text-brand-blue" />
                  </div>
                  <div>
                    <h3 className="font-display text-lg font-semibold">We Come to You</h3>
                    <p className="text-sm text-muted-foreground">
                      This is a mobile service provider that travels to your location.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {((business.payment_methods_accepted && business.payment_methods_accepted.length > 0) ||
            (business.delivery_options && business.delivery_options.length > 0)) && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {business.payment_methods_accepted &&
                business.payment_methods_accepted.length > 0 && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <CreditCard className="h-4 w-4 text-muted-foreground" />
                        Payment Methods
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="flex flex-wrap gap-2">
                        {business.payment_methods_accepted.map((method) => (
                          <Badge key={method} variant="outline" className="capitalize">
                            {method.replace(/_/g, " ")}
                          </Badge>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

              {business.delivery_options && business.delivery_options.length > 0 && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Truck className="h-4 w-4 text-muted-foreground" />
                      Delivery Options
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      {business.delivery_options.map((option) => (
                        <Badge key={option} variant="outline" className="capitalize">
                          {option.replace(/_/g, " ")}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {showPromotions &&
            (promotions.length > 0 ? (
              <div className="space-y-4">
                <h3 className="px-1 font-display text-xl font-bold">Promotions & Offers</h3>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {promotions.map((promo) => (
                    <PromotionCard
                      key={promo.id}
                      id={promo.id}
                      title={promo.title}
                      price={promo.price_cents}
                      negotiable={promo.price_negotiable}
                      imageUrl={promo.videos?.[0] || promo.photos?.[0]}
                      posterUrl={promo.video_thumbnail || promo.photos?.[0] || undefined}
                      categoryLabel={getPromotionCategoryDisplayLabel(
                        promo.category_key,
                        promo.category
                      )}
                      province={promo.location_province}
                      city={promo.location_city}
                      promotionType={promo.promotion_type as PromotionType}
                      createdAt={promo.created_at}
                      viewCount={promo.view_count ?? undefined}
                      boosted={promo.boost_until ? new Date(promo.boost_until) > new Date() : false}
                      featured={
                        promo.featured_until ? new Date(promo.featured_until) > new Date() : false
                      }
                      endDate={promo.end_date}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed bg-muted/30 p-6 text-center">
                <Store className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
                <h4 className="mb-1 text-lg font-medium">Promotions & Offers</h4>
                <p className="mx-auto max-w-sm text-muted-foreground">
                  This business has not posted any promotions or offers yet.
                </p>
              </div>
            ))}
        </div>

        <div className="space-y-6">
          <ContactCard
            business={business}
            hasOnlineLinks={hasOnlineLinks}
            socialLinks={socialLinks}
          />

          {opHours && Object.keys(opHours).length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  Operating Hours
                </CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="space-y-2 text-sm">
                  {opHours.Mon_Fri && (
                    <div className="flex items-center justify-between py-1">
                      <dt className="text-muted-foreground">Mon - Fri</dt>
                      <dd className="font-medium">{opHours.Mon_Fri}</dd>
                    </div>
                  )}
                  {opHours.Sat && (
                    <div className="flex items-center justify-between border-t py-1">
                      <dt className="text-muted-foreground">Saturday</dt>
                      <dd className="font-medium">{opHours.Sat}</dd>
                    </div>
                  )}
                  {opHours.Sun && (
                    <div className="flex items-center justify-between border-t py-1">
                      <dt className="text-muted-foreground">Sunday / Holidays</dt>
                      <dd className="font-medium">{opHours.Sun}</dd>
                    </div>
                  )}
                </dl>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="space-y-4 p-5">
              <h3 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Managed By
              </h3>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                  <ShieldCheck className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="font-medium">{seller?.display_name || "Verified Owner"}</p>
                  {trustLevel && <TrustBadge level={trustLevel} size="sm" />}
                </div>
              </div>
            </CardContent>
          </Card>

          {showPublicActions ? (
            <div className="flex items-center justify-between px-1">
              <ShareButton
                title={business.business_name}
                text={`Check out ${business.business_name} on VerifyMzansi`}
              />
              <ReportDialog
                targetId={business.id}
                targetType="business"
                targetName={business.business_name}
              />
            </div>
          ) : null}
        </div>
      </article>
    </>
  );
}
