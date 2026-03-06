import { notFound } from "next/navigation";
import Image from "next/image";
import {
  MapPin,
  ShieldCheck,
  Phone,
  MessageSquare,
  Store,
  Globe,
  Clock,
  MessageCircle,
  Mail,
  Facebook,
  Instagram,
  Music2,
  Twitter,
  Wrench,
  CreditCard,
  Truck,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { TrustBadge } from "@/components/trust/trust-badge";
import { computeTrustLevel } from "@/lib/constants/trust-scale";
import { ShareButton } from "@/components/shared/share-button";
import { ReportDialog } from "@/components/shared/report-dialog";
import { BusinessGallery } from "@/components/listings/business-gallery";
import { BusinessPromoVideo } from "@/components/listings/business-promo-video";
import { PromotionCard } from "@/components/listings/promotion-card";
import { normalizeMediaUrl } from "@/lib/utils/media-url";
import {
  BUSINESS_TYPE_LABELS,
  BUSINESS_CATEGORY_LABELS,
  type BusinessType,
  type BusinessCategory,
} from "@/types/enums";
import type { Metadata } from "next";
import { getPromotionCategoryDisplayLabel } from "@/lib/utils/promotion-category";
import {
  PRIMARY_ORDER_CHANNEL_LABELS,
  WALK_IN_POLICY_LABELS,
} from "@/lib/forms/business-type-details";
import type { BusinessDetails } from "@/types/business-details";

interface BusinessDetailPageProps {
  params: Promise<{ id: string }>;
}

const zarCurrency = new Intl.NumberFormat("en-ZA", {
  style: "currency",
  currency: "ZAR",
  maximumFractionDigits: 0,
});

export async function generateMetadata({ params }: BusinessDetailPageProps): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data: business } = await supabase
    .from("businesses")
    .select("business_name, description")
    .eq("id", id)
    .single();

  if (!business) {
    return { title: "Business Not Found" };
  }

  return {
    title: `${business.business_name} | Mzansi Business`,
    description: business.description?.slice(0, 160),
  };
}

export default async function BusinessDetailPage({ params }: BusinessDetailPageProps) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: business } = await supabase
    .from("businesses")
    .select("*")
    .eq("id", id)
    .eq("status", "live")
    .single();

  if (!business) notFound();

  const linkedMall = business.mall_id
    ? (await supabase.from("malls").select("id, name").eq("id", business.mall_id).maybeSingle())
        .data
    : null;

  // Fetch seller profile (maybeSingle — seller account may have been deleted)
  const { data: seller } = await supabase
    .from("seller_profiles")
    .select("id, display_name, location_province, location_city, seller_verification_status")
    .eq("user_id", business.seller_id)
    .maybeSingle();

  // Fetch linked promotions
  const { data: promotions } = await supabase
    .from("promotions")
    .select(
      "id, title, promotion_type, category, category_key, photos, videos, video_thumbnail, price_cents, price_negotiable, location_province, location_city, boost_until, featured_until, view_count, start_date, end_date, created_at"
    )
    .eq("business_id", id)
    .eq("status", "live")
    .order("created_at", { ascending: false })
    .limit(12);

  const trustLevel = seller
    ? computeTrustLevel(seller.seller_verification_status ?? "unverified")
    : null;

  const socialLinks = business.social_links as Record<string, string> | null;
  const opHours = business.operating_hours as Record<string, string> | null;
  const bType = business.business_type as BusinessType;
  const bCategory = business.category as BusinessCategory;
  const businessDetails = business.business_details as BusinessDetails | null;
  const galleryPhotos = (business.gallery_photos as string[] | null) ?? [];
  const serviceAreas = business.service_areas as { areas?: string[] } | null;
  const hasOnlineLinks = Boolean(
    socialLinks?.facebook ||
    socialLinks?.instagram ||
    socialLinks?.twitter ||
    socialLinks?.tiktok ||
    business.website
  );

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: business.business_name,
    description: business.description?.slice(0, 300),
    ...(business.cover_photo && { image: business.cover_photo }),
    address: {
      "@type": "PostalAddress",
      addressLocality: business.location_city || undefined,
      addressRegion: business.location_province || undefined,
      addressCountry: "ZA",
    },
  };

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <Header />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <main className="flex-1">
        <div className="container-page py-4 space-y-5">
          {/* Cover Header Area */}
          <div className="relative rounded-2xl overflow-hidden bg-background shadow-sm border">
            {business.cover_photo ? (
              <div className="aspect-[21/9] md:aspect-[4/1] bg-muted overflow-hidden relative">
                <Image
                  src={normalizeMediaUrl(business.cover_photo)}
                  alt={`${business.business_name} Cover`}
                  fill
                  className="object-cover"
                  priority
                  sizes="100vw"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />
              </div>
            ) : (
              <div className="aspect-[21/9] md:aspect-[4/1] bg-gradient-to-r from-brand-blue/80 to-brand-blue flex items-center justify-center">
                <Store className="h-20 w-20 text-white/50" />
              </div>
            )}

            {/* Logo and Title */}
            <div className="px-6 pb-6 pt-4 flex flex-col md:flex-row items-center md:items-end gap-6 md:gap-8 -mt-12 md:-mt-16 relative z-10 w-full text-center md:text-left mx-auto">
              <div className="h-24 w-24 rounded-2xl bg-white dark:bg-warm-900 p-2 shadow-xl border overflow-hidden flex-shrink-0">
                {business.logo_url ? (
                  <Image
                    src={normalizeMediaUrl(business.logo_url)}
                    alt={`${business.business_name} Logo`}
                    width={128}
                    height={128}
                    className="w-full h-full object-contain rounded-xl"
                  />
                ) : (
                  <div className="w-full h-full rounded-xl bg-muted flex items-center justify-center">
                    <Store className="h-10 w-10 text-muted-foreground" />
                  </div>
                )}
              </div>
              <div className="flex-1 pt-12 md:pt-0">
                <h1 className="text-2xl md:text-3xl font-display font-bold text-foreground">
                  {business.business_name}
                </h1>
                <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 mt-3">
                  <Badge variant="outline" className="text-xs">
                    {BUSINESS_TYPE_LABELS[bType]}
                  </Badge>
                  <Badge variant="secondary" className="text-xs">
                    {BUSINESS_CATEGORY_LABELS[bCategory]}
                  </Badge>
                  {business.store_number && business.store_number !== "N/A" && (
                    <span className="flex items-center gap-1.5 bg-muted px-2.5 py-1 rounded-md text-foreground text-sm">
                      <Store className="h-4 w-4 text-brand-blue" />
                      Shop {business.store_number}
                    </span>
                  )}
                  {(business.location_province || business.location_city) && (
                    <span className="flex items-center gap-1 text-muted-foreground text-sm">
                      <MapPin className="h-4 w-4" />
                      {[business.location_city, business.location_province]
                        .filter(Boolean)
                        .join(", ")}
                    </span>
                  )}
                </div>
              </div>
              <div className="hidden md:flex gap-3 self-end mb-2">
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

          <article className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Main Content */}
            <div className="lg:col-span-2 space-y-6">
              {/* Promo Video Section */}
              {business.cover_video && (
                <BusinessPromoVideo
                  videoUrl={normalizeMediaUrl(business.cover_video)}
                  thumbnailUrl={
                    business.video_thumbnail
                      ? normalizeMediaUrl(business.video_thumbnail)
                      : undefined
                  }
                  businessName={business.business_name}
                />
              )}

              {/* Gallery Photos Section */}
              {galleryPhotos.length > 0 && (
                <BusinessGallery
                  photos={galleryPhotos.map((url: string) => normalizeMediaUrl(url))}
                  businessName={business.business_name}
                />
              )}

              <Card>
                <CardContent className="p-6 space-y-4">
                  <h2 className="font-display text-xl font-bold">About {business.business_name}</h2>
                  <p className="text-muted-foreground whitespace-pre-wrap leading-relaxed">
                    {business.description || "No description provided."}
                  </p>
                </CardContent>
              </Card>

              {(businessDetails ||
                business.store_number ||
                business.map_directions ||
                serviceAreas) && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Business Details</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    {bType === "mall_store" && (
                      <>
                        {business.store_number && (
                          <div className="flex items-start justify-between gap-4">
                            <span className="text-muted-foreground">Store number</span>
                            <span className="font-medium text-right">{business.store_number}</span>
                          </div>
                        )}
                        {linkedMall?.name && (
                          <div className="flex items-start justify-between gap-4">
                            <span className="text-muted-foreground">Mall</span>
                            <span className="font-medium text-right">{linkedMall.name}</span>
                          </div>
                        )}
                        {businessDetails?.type === "mall_store" &&
                          businessDetails.floor_or_wing && (
                            <div className="flex items-start justify-between gap-4">
                              <span className="text-muted-foreground">Floor / wing</span>
                              <span className="font-medium text-right">
                                {businessDetails.floor_or_wing}
                              </span>
                            </div>
                          )}
                        {businessDetails?.type === "mall_store" &&
                          businessDetails.nearest_entrance && (
                            <div className="flex items-start justify-between gap-4">
                              <span className="text-muted-foreground">Nearest entrance</span>
                              <span className="font-medium text-right">
                                {businessDetails.nearest_entrance}
                              </span>
                            </div>
                          )}
                        {businessDetails?.type === "mall_store" &&
                          businessDetails.parking_notes && (
                            <div className="space-y-1">
                              <p className="text-muted-foreground">Parking notes</p>
                              <p className="font-medium">{businessDetails.parking_notes}</p>
                            </div>
                          )}
                        {business.map_directions && (
                          <Button asChild variant="outline" className="w-full gap-2">
                            <a
                              href={business.map_directions}
                              target="_blank"
                              rel="noopener noreferrer nofollow"
                            >
                              <MapPin className="h-4 w-4" />
                              Open Map Directions
                            </a>
                          </Button>
                        )}
                      </>
                    )}

                    {bType === "standalone_shop" && businessDetails?.type === "standalone_shop" && (
                      <>
                        <div className="flex items-start justify-between gap-4">
                          <span className="text-muted-foreground">Street address</span>
                          <span className="font-medium text-right">
                            {businessDetails.street_address}
                          </span>
                        </div>
                        <div className="flex items-start justify-between gap-4">
                          <span className="text-muted-foreground">Suburb</span>
                          <span className="font-medium text-right">{businessDetails.suburb}</span>
                        </div>
                        {businessDetails.landmark && (
                          <div className="flex items-start justify-between gap-4">
                            <span className="text-muted-foreground">Landmark</span>
                            <span className="font-medium text-right">
                              {businessDetails.landmark}
                            </span>
                          </div>
                        )}
                        {businessDetails.walk_in_policy && (
                          <div className="flex items-start justify-between gap-4">
                            <span className="text-muted-foreground">Walk-in policy</span>
                            <span className="font-medium text-right">
                              {WALK_IN_POLICY_LABELS[businessDetails.walk_in_policy]}
                            </span>
                          </div>
                        )}
                        {business.map_directions && (
                          <Button asChild variant="outline" className="w-full gap-2">
                            <a
                              href={business.map_directions}
                              target="_blank"
                              rel="noopener noreferrer nofollow"
                            >
                              <MapPin className="h-4 w-4" />
                              Open Map Directions
                            </a>
                          </Button>
                        )}
                      </>
                    )}

                    {bType === "home_business" && businessDetails?.type === "home_business" && (
                      <>
                        <div className="flex items-start justify-between gap-4">
                          <span className="text-muted-foreground">Service suburb</span>
                          <span className="font-medium text-right">
                            {businessDetails.service_suburb}
                          </span>
                        </div>
                        <div className="flex items-start justify-between gap-4">
                          <span className="text-muted-foreground">Appointment required</span>
                          <span className="font-medium text-right">
                            {businessDetails.appointment_required ? "Yes" : "No"}
                          </span>
                        </div>
                        <div className="flex items-start justify-between gap-4">
                          <span className="text-muted-foreground">Customer pickup</span>
                          <span className="font-medium text-right">
                            {businessDetails.customer_pickup_allowed
                              ? "Available"
                              : "Not available"}
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

                    {bType === "mobile_service" && businessDetails?.type === "mobile_service" && (
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
                            <span className="font-medium text-right">
                              {businessDetails.travel_radius_km} km
                            </span>
                          </div>
                        )}
                        {typeof businessDetails.callout_fee_from === "number" && (
                          <div className="flex items-start justify-between gap-4">
                            <span className="text-muted-foreground">Callout fee from</span>
                            <span className="font-medium text-right">
                              {zarCurrency.format(businessDetails.callout_fee_from)}
                            </span>
                          </div>
                        )}
                        <div className="flex items-start justify-between gap-4">
                          <span className="text-muted-foreground">Emergency callouts</span>
                          <span className="font-medium text-right">
                            {businessDetails.emergency_callouts ? "Available" : "Not available"}
                          </span>
                        </div>
                      </>
                    )}

                    {bType === "online_only" && businessDetails?.type === "online_only" && (
                      <>
                        {businessDetails.primary_order_channel && (
                          <div className="flex items-start justify-between gap-4">
                            <span className="text-muted-foreground">Primary order channel</span>
                            <span className="font-medium text-right">
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
                            <span className="font-medium text-right">
                              {businessDetails.support_response_time}
                            </span>
                          </div>
                        )}
                      </>
                    )}

                    {bType === "market_stall" && businessDetails?.type === "market_stall" && (
                      <>
                        <div className="flex items-start justify-between gap-4">
                          <span className="text-muted-foreground">Market name</span>
                          <span className="font-medium text-right">
                            {businessDetails.market_name}
                          </span>
                        </div>
                        {businessDetails.stall_label && (
                          <div className="flex items-start justify-between gap-4">
                            <span className="text-muted-foreground">Stall label</span>
                            <span className="font-medium text-right">
                              {businessDetails.stall_label}
                            </span>
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
                          <span className="font-medium text-right">
                            {businessDetails.trading_hours}
                          </span>
                        </div>
                        {business.map_directions && (
                          <Button asChild variant="outline" className="w-full gap-2">
                            <a
                              href={business.map_directions}
                              target="_blank"
                              rel="noopener noreferrer nofollow"
                            >
                              <MapPin className="h-4 w-4" />
                              Open Map Directions
                            </a>
                          </Button>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Services Offered */}
              {business.services_offered && business.services_offered.length > 0 && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Wrench className="w-4 h-4 text-muted-foreground" />
                      Services Offered
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      {business.services_offered.map((service: string, i: number) => (
                        <Badge key={i} variant="secondary">
                          {service}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Mobile Service Badge */}
              {bType === "mobile_service" && business.service_areas && (
                <Card className="border-brand-blue/30 bg-brand-blue/5">
                  <CardContent className="p-6">
                    <div className="flex items-center gap-3">
                      <div className="bg-brand-blue/10 p-3 rounded-full">
                        <MapPin className="h-6 w-6 text-brand-blue" />
                      </div>
                      <div>
                        <h3 className="font-display font-semibold text-lg">We Come to You</h3>
                        <p className="text-muted-foreground text-sm">
                          This is a mobile service provider that travels to your location.
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Payment Methods & Delivery */}
              {((business.payment_methods_accepted &&
                business.payment_methods_accepted.length > 0) ||
                (business.delivery_options && business.delivery_options.length > 0)) && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {business.payment_methods_accepted &&
                    business.payment_methods_accepted.length > 0 && (
                      <Card>
                        <CardHeader className="pb-3">
                          <CardTitle className="text-base flex items-center gap-2">
                            <CreditCard className="w-4 h-4 text-muted-foreground" />
                            Payment Methods
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="flex flex-wrap gap-2">
                            {business.payment_methods_accepted.map((method: string) => (
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
                        <CardTitle className="text-base flex items-center gap-2">
                          <Truck className="w-4 h-4 text-muted-foreground" />
                          Delivery Options
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="flex flex-wrap gap-2">
                          {business.delivery_options.map((option: string) => (
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

              {/* Linked Promotions */}
              {promotions && promotions.length > 0 ? (
                <div className="space-y-4">
                  <h3 className="font-display text-xl font-bold px-1">Promotions & Offers</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                        promotionType={promo.promotion_type}
                        createdAt={promo.created_at}
                        viewCount={promo.view_count}
                        boosted={
                          promo.boost_until ? new Date(promo.boost_until) > new Date() : false
                        }
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
                  <Store className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
                  <h4 className="font-medium text-lg mb-1">Promotions & Offers</h4>
                  <p className="text-muted-foreground max-w-sm mx-auto">
                    This business has not posted any promotions or offers yet.
                  </p>
                </div>
              )}
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* Contact Card */}
              <Card className="shadow-md border-t-4 border-t-brand-blue">
                <CardContent className="p-6 space-y-5">
                  <h3 className="font-display font-bold text-lg">Contact Business</h3>

                  <address className="space-y-3 not-italic">
                    {business.phone && (
                      <a
                        href={`tel:${business.phone}`}
                        className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                      >
                        <div className="bg-primary/10 p-2 rounded-full text-primary">
                          <Phone className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
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
                        className="flex items-center gap-3 p-3 rounded-lg bg-green-50 dark:bg-green-950/40 hover:bg-green-100 dark:hover:bg-green-950/60 transition-colors border border-green-100 dark:border-green-800"
                      >
                        <div className="bg-green-500 p-2 rounded-full text-white">
                          <MessageCircle className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="text-xs text-green-700 dark:text-green-300 font-medium uppercase tracking-wider">
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
                        className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                      >
                        <div className="bg-secondary p-2 rounded-full text-secondary-foreground">
                          <Mail className="h-5 w-5" />
                        </div>
                        <div className="overflow-hidden">
                          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                            Email
                          </p>
                          <p className="font-medium truncate">{business.email}</p>
                        </div>
                      </a>
                    )}

                    {!business.phone && !business.whatsapp && !business.email && (
                      <a
                        href={`mailto:support@verifymzansi.co.za?subject=Enquiry about ${encodeURIComponent(business.business_name)}&body=Hi, I found ${encodeURIComponent(business.business_name)} on VerifyMzansi and would like to get in touch.`}
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
                        <p className="text-sm font-medium text-muted-foreground mb-3">
                          Connect Online
                        </p>
                        <div className="flex gap-2">
                          {socialLinks?.facebook && (
                            <a
                              href={socialLinks?.facebook}
                              target="_blank"
                              rel="noopener noreferrer nofollow ugc"
                              title="Facebook"
                              className="p-2.5 rounded-full bg-[#1877F2]/10 text-[#1877F2] hover:bg-[#1877F2]/20 transition-colors"
                            >
                              <Facebook className="h-5 w-5 fill-current" />
                            </a>
                          )}
                          {socialLinks?.instagram && (
                            <a
                              href={socialLinks?.instagram}
                              target="_blank"
                              rel="noopener noreferrer nofollow ugc"
                              title="Instagram"
                              className="p-2.5 rounded-full bg-[#E4405F]/10 text-[#E4405F] hover:bg-[#E4405F]/20 transition-colors"
                            >
                              <Instagram className="h-5 w-5" />
                            </a>
                          )}
                          {socialLinks?.twitter && (
                            <a
                              href={socialLinks?.twitter}
                              target="_blank"
                              rel="noopener noreferrer nofollow ugc"
                              title="Twitter"
                              className="p-2.5 rounded-full bg-black/5 text-black hover:bg-black/10 transition-colors dark:bg-white/10 dark:text-white dark:hover:bg-white/20"
                            >
                              <Twitter className="h-5 w-5 fill-current" />
                            </a>
                          )}
                          {socialLinks?.tiktok && (
                            <a
                              href={socialLinks?.tiktok}
                              target="_blank"
                              rel="noopener noreferrer nofollow ugc"
                              title="TikTok"
                              className="p-2.5 rounded-full bg-black/5 text-foreground hover:bg-black/10 transition-colors dark:bg-white/10 dark:text-white dark:hover:bg-white/20"
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
                              className="p-2.5 rounded-full bg-muted text-foreground hover:bg-muted/80 transition-colors"
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

              {/* Operating Hours */}
              {opHours && Object.keys(opHours).length > 0 && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Clock className="w-4 h-4 text-muted-foreground" />
                      Operating Hours
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <dl className="space-y-2 text-sm">
                      {opHours.Mon_Fri && (
                        <div className="flex justify-between items-center py-1">
                          <dt className="text-muted-foreground">Mon - Fri</dt>
                          <dd className="font-medium">{opHours.Mon_Fri}</dd>
                        </div>
                      )}
                      {opHours.Sat && (
                        <div className="flex justify-between items-center py-1 border-t">
                          <dt className="text-muted-foreground">Saturday</dt>
                          <dd className="font-medium">{opHours.Sat}</dd>
                        </div>
                      )}
                      {opHours.Sun && (
                        <div className="flex justify-between items-center py-1 border-t">
                          <dt className="text-muted-foreground">Sunday / Holidays</dt>
                          <dd className="font-medium">{opHours.Sun}</dd>
                        </div>
                      )}
                    </dl>
                  </CardContent>
                </Card>
              )}

              {/* Owner Info */}
              <Card>
                <CardContent className="p-5 space-y-4">
                  <h3 className="font-display font-semibold text-sm text-muted-foreground uppercase tracking-wider">
                    Managed By
                  </h3>
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                      <ShieldCheck className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="font-medium">{seller?.display_name || "Verified Owner"}</p>
                      {trustLevel && <TrustBadge level={trustLevel} size="sm" />}
                    </div>
                  </div>
                </CardContent>
              </Card>

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
            </div>
          </article>
        </div>
      </main>

      <Footer />
    </div>
  );
}
