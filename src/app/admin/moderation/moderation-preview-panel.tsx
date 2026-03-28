"use client";

import { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Clock3,
  CreditCard,
  Globe,
  Mail,
  MapPin,
  MessageCircle,
  Package,
  Phone,
  Play,
  ShieldCheck,
  Store,
  Tag,
  Truck,
  User,
  Wrench,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { VideoWithPoster } from "@/components/ui/video-with-poster";
import { formatZAR, formatRelativeTime } from "@/lib/utils/format";
import { normalizeMediaUrl, normalizeVideoUrl } from "@/lib/utils/media-url";
import { cn } from "@/lib/utils";
import {
  hasBusinessDeliveryAvailable,
  PRIMARY_ORDER_CHANNEL_LABELS,
  WALK_IN_POLICY_LABELS,
} from "@/lib/forms/business-type-details";
import type { BusinessDetails } from "@/types/business-details";
import {
  BUSINESS_CATEGORY_LABELS,
  BUSINESS_TYPE_LABELS,
  type BusinessCategory,
  type BusinessType,
} from "@/types/enums";

export interface ModerationItem {
  id: string;
  title?: string;
  status: string;
  created_at: string;
  category?: string;
  owner_id?: string;
  area: string;
  areaLabel: string;
  itemType: string;
  // Extended fields for preview
  description?: string;
  photos?: string[];
  videos?: string[];
  video_thumbnail?: string | null;
  price_cents?: number | null;
  price_negotiable?: boolean;
  location_province?: string;
  location_city?: string;
  location_suburb?: string | null;
  attributes?: Record<string, unknown>;
  contact_methods?: string[];
  buyer_verification_required?: boolean;
  // Storefront fields
  mall_name?: string;
  store_number?: string | null;
  // Business profile fields
  business_name?: string;
  business_type?: BusinessType | string;
  logo_url?: string | null;
  cover_photo?: string | null;
  cover_video?: string | null;
  gallery_photos?: string[] | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  website?: string | null;
  social_links?: Record<string, string> | null;
  operating_hours?: Record<string, string> | null;
  services_offered?: string[] | null;
  payment_methods_accepted?: string[] | null;
  delivery_options?: string[] | null;
  service_areas?: { areas?: string[] } | null;
  map_directions?: string | null;
  business_details?: BusinessDetails | null;
}

interface ModerationPreviewPanelProps {
  item: ModerationItem;
}

interface ModerationMediaItem {
  url: string;
  isVideo: boolean;
}

const ATTRIBUTE_LABELS: Record<string, string> = {
  condition: "Condition",
  make: "Make",
  model: "Model",
  year: "Year",
  mileage_km: "Mileage (km)",
  fuel_type: "Fuel Type",
  transmission: "Transmission",
  colour: "Colour",
  brand: "Brand",
  storage: "Storage",
  bedrooms: "Bedrooms",
  bathrooms: "Bathrooms",
  size_sqm: "Size (m²)",
  property_type: "Property Type",
  furnished: "Furnished",
  parking: "Parking",
};

function formatEnumLabel(value: string) {
  return value.replace(/_/g, " ");
}

function formatOperatingHourLabel(key: string) {
  switch (key) {
    case "Mon_Fri":
      return "Mon - Fri";
    case "Sat":
      return "Saturday";
    case "Sun":
      return "Sunday / Holidays";
    default:
      return formatEnumLabel(key);
  }
}

function getBusinessGalleryMedia(item: ModerationItem): ModerationMediaItem[] {
  const media: ModerationMediaItem[] = [];
  const seen = new Set<string>();

  const addImage = (url?: string | null) => {
    if (!url) return;
    const normalized = normalizeMediaUrl(url);
    if (seen.has(normalized)) return;
    seen.add(normalized);
    media.push({ url: normalized, isVideo: false });
  };

  const addVideo = (url?: string | null) => {
    if (!url) return;
    const normalized = normalizeVideoUrl(url);
    if (seen.has(normalized)) return;
    seen.add(normalized);
    media.push({ url: normalized, isVideo: true });
  };

  addImage(item.cover_photo);
  addVideo(item.cover_video);
  (item.gallery_photos ?? []).forEach((photo) => addImage(photo));

  return media;
}

/** Small thumbnail placeholder for videos in the thumbnail strip */
function VideoThumbnailThumb({ firstPhoto }: { firstPhoto?: string }) {
  return firstPhoto ? (
    <div className="relative w-full h-full">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={firstPhoto}
        alt="Video thumbnail"
        className="w-full h-full object-cover"
        loading="lazy"
        width={80}
        height={80}
      />
      <div className="absolute inset-0 flex items-center justify-center bg-black/30">
        <Play className="h-3.5 w-3.5 text-white fill-white" />
      </div>
    </div>
  ) : (
    <div className="w-full h-full bg-gradient-to-br from-warm-200 to-warm-300 dark:from-warm-700 dark:to-warm-800 flex items-center justify-center">
      <Play className="h-4 w-4 text-muted-foreground" />
    </div>
  );
}

function BusinessInfoCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <p className="mt-1 text-sm font-medium break-words whitespace-pre-wrap">{value}</p>
    </div>
  );
}

function BusinessDetailsSection({ item }: { item: ModerationItem }) {
  const businessType = item.business_type as BusinessType | undefined;
  const details = item.business_details;
  const serviceAreas = item.service_areas?.areas?.filter(Boolean) ?? [];

  if (!businessType || !details) {
    return serviceAreas.length > 0 ? (
      <>
        <Separator />
        <div className="space-y-2">
          <h4 className="text-sm font-semibold flex items-center gap-1.5">
            <Tag className="h-3.5 w-3.5" />
            Business details
          </h4>
          <div className="flex flex-wrap gap-2">
            {serviceAreas.map((area) => (
              <Badge key={area} variant="secondary">
                {area}
              </Badge>
            ))}
          </div>
        </div>
      </>
    ) : null;
  }

  const detailRows: Array<{ label: string; value: string }> = [];
  const detailBadges: Array<{ label: string; values: string[] }> = [];

  switch (businessType) {
    case "mall_store":
      if (details.type === "mall_store") {
        if (details.mall_name) detailRows.push({ label: "Mall", value: details.mall_name });
        if (item.store_number) detailRows.push({ label: "Store number", value: item.store_number });
        if (details.mall_address)
          detailRows.push({ label: "Mall address", value: details.mall_address });
        if (details.floor_or_wing)
          detailRows.push({ label: "Floor / wing", value: details.floor_or_wing });
        if (details.nearest_entrance)
          detailRows.push({ label: "Nearest entrance", value: details.nearest_entrance });
        if (details.parking_notes)
          detailRows.push({ label: "Parking notes", value: details.parking_notes });
        if (details.mall_summary)
          detailRows.push({ label: "Mall information", value: details.mall_summary });
      }
      break;
    case "standalone_shop":
      if (details.type === "standalone_shop") {
        if (details.street_address)
          detailRows.push({ label: "Street address", value: details.street_address });
        if (details.suburb) detailRows.push({ label: "Suburb", value: details.suburb });
        if (details.landmark) detailRows.push({ label: "Landmark", value: details.landmark });
        if (details.walk_in_policy) {
          detailRows.push({
            label: "Walk-in policy",
            value: WALK_IN_POLICY_LABELS[details.walk_in_policy],
          });
        }
      }
      break;
    case "home_business":
      if (details.type === "home_business") {
        if (details.service_suburb)
          detailRows.push({ label: "Service suburb", value: details.service_suburb });
        detailRows.push({
          label: "Appointment required",
          value: details.appointment_required ? "Yes" : "No",
        });
        detailRows.push({
          label: "Customer pickup",
          value: details.customer_pickup_allowed ? "Available" : "Not available",
        });
        if (details.visitor_notes)
          detailRows.push({ label: "Visitor notes", value: details.visitor_notes });
      }
      break;
    case "mobile_service":
      if (details.type === "mobile_service") {
        if (typeof details.travel_radius_km === "number") {
          detailRows.push({
            label: "Travel radius",
            value: `${details.travel_radius_km} km`,
          });
        }
        if (typeof details.callout_fee_from === "number") {
          detailRows.push({
            label: "Callout fee from",
            value: formatZAR(details.callout_fee_from * 100),
          });
        }
        detailRows.push({
          label: "Emergency callouts",
          value: details.emergency_callouts ? "Available" : "Not available",
        });
        if (serviceAreas.length > 0) {
          detailBadges.push({ label: "Service areas", values: serviceAreas });
        }
      }
      break;
    case "online_only":
      if (details.type === "online_only") {
        if (details.primary_order_channel) {
          detailRows.push({
            label: "Primary order channel",
            value: PRIMARY_ORDER_CHANNEL_LABELS[details.primary_order_channel],
          });
        }
        if (details.order_url) detailRows.push({ label: "Order URL", value: details.order_url });
        if (details.support_response_time) {
          detailRows.push({
            label: "Support response time",
            value: details.support_response_time,
          });
        }
      }
      break;
    case "market_stall":
      if (details.type === "market_stall") {
        if (details.market_name)
          detailRows.push({ label: "Market name", value: details.market_name });
        if (details.stall_label)
          detailRows.push({ label: "Stall label", value: details.stall_label });
        if (details.trading_hours)
          detailRows.push({ label: "Trading hours", value: details.trading_hours });
        if (details.trading_days.length > 0) {
          detailBadges.push({ label: "Trading days", values: details.trading_days });
        }
      }
      break;
  }

  if (detailRows.length === 0 && detailBadges.length === 0) {
    return null;
  }

  return (
    <>
      <Separator />
      <div className="space-y-2">
        <h4 className="text-sm font-semibold flex items-center gap-1.5">
          <Tag className="h-3.5 w-3.5" />
          Business details
        </h4>
        {detailRows.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2">
            {detailRows.map((detail) => (
              <div
                key={`${detail.label}-${detail.value}`}
                className="rounded-lg border bg-muted/20 p-3"
              >
                <p className="text-xs text-muted-foreground">{detail.label}</p>
                <p className="mt-1 text-sm font-medium whitespace-pre-wrap break-words">
                  {detail.value}
                </p>
              </div>
            ))}
          </div>
        )}
        {detailBadges.map((group) => (
          <div key={group.label} className="space-y-2">
            <p className="text-xs text-muted-foreground">{group.label}</p>
            <div className="flex flex-wrap gap-2">
              {group.values.map((value) => (
                <Badge key={`${group.label}-${value}`} variant="secondary">
                  {value}
                </Badge>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function BusinessModerationPreview({ item }: ModerationPreviewPanelProps) {
  const allMedia = getBusinessGalleryMedia(item);
  const [activeIndex, setActiveIndex] = useState(0);
  const activeMedia = allMedia[activeIndex];
  const activeUrl = activeMedia?.url || "";
  const isVideo = activeMedia?.isVideo ?? false;
  const posterUrl =
    (item.video_thumbnail ? normalizeMediaUrl(item.video_thumbnail) : undefined) ||
    allMedia.find((media) => !media.isVideo)?.url ||
    undefined;
  const logoUrl = item.logo_url ? normalizeMediaUrl(item.logo_url) : null;
  const coverPhotoUrl = item.cover_photo ? normalizeMediaUrl(item.cover_photo) : null;
  const coverVideoUrl = item.cover_video ? normalizeVideoUrl(item.cover_video) : null;
  const galleryCount = item.gallery_photos?.filter(Boolean).length ?? 0;
  const businessTypeLabel = item.business_type
    ? (BUSINESS_TYPE_LABELS[item.business_type as BusinessType] ??
      formatEnumLabel(item.business_type))
    : null;
  const businessCategoryLabel = item.category
    ? (BUSINESS_CATEGORY_LABELS[item.category as BusinessCategory] ??
      formatEnumLabel(item.category))
    : null;
  const location = [item.location_city, item.location_province].filter(Boolean).join(", ");
  const operatingHoursEntries = Object.entries(item.operating_hours ?? {}).filter(
    ([, value]) => typeof value === "string" && value.trim().length > 0
  );
  const services = item.services_offered?.filter(Boolean) ?? [];
  const paymentMethods = item.payment_methods_accepted?.filter(Boolean) ?? [];
  const deliveryAvailable = hasBusinessDeliveryAvailable(
    item.delivery_options,
    item.business_details
  );
  const socialLinks = Object.entries(item.social_links ?? {}).filter(
    ([, value]) => typeof value === "string" && value.trim().length > 0
  );

  function goTo(index: number) {
    if (index >= 0 && index < allMedia.length) {
      setActiveIndex(index);
    }
  }

  return (
    <ScrollArea className="h-[calc(100vh-10rem)]">
      <div className="space-y-5 pr-4">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold">Business media</h4>
              <p className="text-xs text-muted-foreground">
                Photos, promo video, and brand logo exactly as submitted for review.
              </p>
            </div>
            <div className="flex flex-wrap justify-end gap-1.5">
              {coverPhotoUrl && (
                <Badge variant="secondary" className="text-[10px]">
                  Cover photo
                </Badge>
              )}
              {coverVideoUrl && (
                <Badge variant="secondary" className="text-[10px]">
                  Promo video
                </Badge>
              )}
              {galleryCount > 0 && (
                <Badge variant="secondary" className="text-[10px]">
                  {galleryCount} gallery photo{galleryCount > 1 ? "s" : ""}
                </Badge>
              )}
              {logoUrl && (
                <Badge variant="outline" className="text-[10px]">
                  Logo
                </Badge>
              )}
            </div>
          </div>

          {allMedia.length === 0 && !logoUrl ? (
            <div
              className="rounded-xl border border-dashed bg-muted/20 p-4"
              data-testid="business-media-empty-state"
            >
              <div className="flex items-start gap-3">
                <div className="rounded-full bg-background p-2 shadow-sm">
                  <Store className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="space-y-3">
                  <div>
                    <p className="text-sm font-medium">No business visuals submitted</p>
                    <p className="text-sm text-muted-foreground">
                      There are no photos, promo video, or logo for this business yet.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline" className="text-[10px]">
                      No cover photo
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      No promo video
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      No gallery photos
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      No logo
                    </Badge>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_132px]">
              {allMedia.length > 0 ? (
                <div className="space-y-2">
                  <div className="relative group rounded-lg overflow-hidden bg-warm-100 dark:bg-warm-800">
                    <div className="aspect-video relative">
                      {isVideo ? (
                        <VideoWithPoster
                          key={activeUrl}
                          src={activeUrl}
                          posterUrl={posterUrl}
                          controls
                          playsInline
                          className="w-full h-full object-contain bg-black rounded-lg"
                          wrapperClassName="w-full h-full"
                        />
                      ) : (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={activeUrl}
                          alt={`${item.title ?? item.business_name ?? "Business"} - image ${activeIndex + 1}`}
                          className="absolute inset-0 w-full h-full object-cover"
                        />
                      )}

                      {allMedia.length > 1 && (
                        <>
                          <button
                            type="button"
                            onClick={() => goTo(activeIndex - 1)}
                            disabled={activeIndex === 0}
                            className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/40 text-white backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-0 hover:bg-black/60"
                            aria-label="Previous image"
                          >
                            <ChevronLeft className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => goTo(activeIndex + 1)}
                            disabled={activeIndex === allMedia.length - 1}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/40 text-white backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-0 hover:bg-black/60"
                            aria-label="Next image"
                          >
                            <ChevronRight className="h-4 w-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {allMedia.length > 1 && (
                    <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
                      {allMedia.map((media, index) => (
                        <button
                          key={`${media.url}-${index}`}
                          type="button"
                          onClick={() => setActiveIndex(index)}
                          className={cn(
                            "relative flex-shrink-0 w-14 h-14 rounded-md overflow-hidden border-2 transition-all",
                            index === activeIndex
                              ? "border-brand-green ring-1 ring-brand-green/20"
                              : "border-transparent opacity-60 hover:opacity-100"
                          )}
                        >
                          {media.isVideo ? (
                            <VideoThumbnailThumb firstPhoto={posterUrl} />
                          ) : (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img
                              src={media.url}
                              alt={`Thumbnail ${index + 1}`}
                              className="w-full h-full object-cover"
                            />
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="self-start rounded-xl border border-dashed bg-muted/30 px-4 py-6">
                  <div className="flex items-center gap-3">
                    <div className="rounded-full bg-background p-2 shadow-sm">
                      <Store className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">No business media submitted</p>
                      <p className="text-sm text-muted-foreground">
                        Moderation can continue with the profile details below.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div
                className="self-start rounded-xl border bg-muted/20 p-3"
                data-testid="business-logo-panel"
              >
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Brand logo
                </p>
                {logoUrl ? (
                  <div className="mt-3 rounded-lg border bg-background p-3">
                    <div className="relative aspect-square overflow-hidden rounded-md">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={logoUrl}
                        alt={`${item.business_name ?? item.title ?? "Business"} logo`}
                        className="absolute inset-0 h-full w-full object-contain"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 rounded-lg border border-dashed bg-background px-3 py-6 text-center">
                    <Store className="mx-auto h-5 w-5 text-muted-foreground" />
                    <p className="mt-2 text-xs text-muted-foreground">No logo submitted</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="space-y-2">
            <h3 className="text-lg font-semibold font-display">
              {item.business_name || item.title || `Business ${item.id.slice(0, 8)}`}
            </h3>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="text-[10px]">
                {item.itemType}
              </Badge>
              <Badge variant="secondary" className="text-[10px]">
                {item.areaLabel}
              </Badge>
              {businessTypeLabel && (
                <Badge variant="outline" className="text-[10px]">
                  {businessTypeLabel}
                </Badge>
              )}
              {businessCategoryLabel && (
                <Badge variant="secondary" className="text-[10px]">
                  {businessCategoryLabel}
                </Badge>
              )}
            </div>
          </div>

          {(location || item.store_number) && (
            <div className="grid gap-2 sm:grid-cols-2">
              {location && (
                <BusinessInfoCard
                  icon={<MapPin className="h-3.5 w-3.5" />}
                  label="Location"
                  value={location}
                />
              )}
              {item.store_number && item.store_number !== "N/A" && (
                <BusinessInfoCard
                  icon={<Store className="h-3.5 w-3.5" />}
                  label="Store number"
                  value={item.store_number}
                />
              )}
            </div>
          )}
        </div>

        {item.description && (
          <div className="space-y-1.5">
            <h4 className="text-sm font-semibold">Description</h4>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
              {item.description}
            </p>
          </div>
        )}

        {(item.phone || item.whatsapp || item.email || item.website || socialLinks.length > 0) && (
          <>
            <Separator />
            <div className="space-y-2">
              <h4 className="text-sm font-semibold">Contact & links</h4>
              <div className="grid gap-2">
                {item.phone && (
                  <BusinessInfoCard
                    icon={<Phone className="h-3.5 w-3.5" />}
                    label="Phone"
                    value={item.phone}
                  />
                )}
                {item.whatsapp && (
                  <BusinessInfoCard
                    icon={<MessageCircle className="h-3.5 w-3.5" />}
                    label="WhatsApp"
                    value={item.whatsapp}
                  />
                )}
                {item.email && (
                  <BusinessInfoCard
                    icon={<Mail className="h-3.5 w-3.5" />}
                    label="Email"
                    value={item.email}
                  />
                )}
                {item.website && (
                  <BusinessInfoCard
                    icon={<Globe className="h-3.5 w-3.5" />}
                    label="Website"
                    value={item.website}
                  />
                )}
              </div>
              {socialLinks.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">Social profiles</p>
                  <div className="flex flex-wrap gap-2">
                    {socialLinks.map(([platform]) => (
                      <Badge key={platform} variant="outline" className="capitalize">
                        {formatEnumLabel(platform)}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {operatingHoursEntries.length > 0 && (
          <>
            <Separator />
            <div className="space-y-2">
              <h4 className="text-sm font-semibold flex items-center gap-1.5">
                <Clock3 className="h-3.5 w-3.5" />
                Operating hours
              </h4>
              <div className="grid gap-2 sm:grid-cols-2">
                {operatingHoursEntries.map(([key, value]) => (
                  <div key={key} className="rounded-lg border bg-muted/20 p-3">
                    <p className="text-xs text-muted-foreground">{formatOperatingHourLabel(key)}</p>
                    <p className="mt-1 text-sm font-medium">{value}</p>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {services.length > 0 && (
          <>
            <Separator />
            <div className="space-y-2">
              <h4 className="text-sm font-semibold flex items-center gap-1.5">
                <Wrench className="h-3.5 w-3.5" />
                Services offered
              </h4>
              <div className="flex flex-wrap gap-2">
                {services.map((service) => (
                  <Badge key={service} variant="secondary">
                    {service}
                  </Badge>
                ))}
              </div>
            </div>
          </>
        )}

        {(paymentMethods.length > 0 || deliveryAvailable) && (
          <>
            <Separator />
            <div className="grid gap-4 sm:grid-cols-2">
              {paymentMethods.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold flex items-center gap-1.5">
                    <CreditCard className="h-3.5 w-3.5" />
                    Payment methods
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {paymentMethods.map((method) => (
                      <Badge key={method} variant="outline" className="capitalize">
                        {formatEnumLabel(method)}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {deliveryAvailable && (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold flex items-center gap-1.5">
                    <Truck className="h-3.5 w-3.5" />
                    Delivery
                  </h4>
                  <Badge variant="outline">Available</Badge>
                </div>
              )}
            </div>
          </>
        )}

        <BusinessDetailsSection item={item} />

        <Separator />
        <div className="space-y-1.5">
          <h4 className="text-sm font-semibold flex items-center gap-1.5">
            <User className="h-3.5 w-3.5" />
            Account
          </h4>
          <div className="grid gap-2 sm:grid-cols-2">
            {item.owner_id && (
              <BusinessInfoCard
                icon={<User className="h-3.5 w-3.5" />}
                label="Owner ID"
                value={`${item.owner_id.slice(0, 12)}…`}
              />
            )}
            <BusinessInfoCard
              icon={<Package className="h-3.5 w-3.5" />}
              label="Submitted"
              value={formatRelativeTime(item.created_at)}
            />
            {item.map_directions && (
              <BusinessInfoCard
                icon={<MapPin className="h-3.5 w-3.5" />}
                label="Map directions"
                value={item.map_directions}
              />
            )}
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}

export function ModerationPreviewPanel({ item }: ModerationPreviewPanelProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  if (item.area === "MZANSI_BUSINESS") {
    return <BusinessModerationPreview item={item} />;
  }

  const allMedia: ModerationMediaItem[] = [
    ...((item.photos ?? []).filter(Boolean).map((url) => ({
      url: normalizeMediaUrl(url),
      isVideo: false,
    })) satisfies ModerationMediaItem[]),
    ...((item.videos ?? []).filter(Boolean).map((url) => ({
      url: normalizeVideoUrl(url),
      isVideo: true,
    })) satisfies ModerationMediaItem[]),
  ];
  // Use video_thumbnail if available, then fall back to first photo
  const firstPhotoUrl =
    (item.video_thumbnail ? normalizeMediaUrl(item.video_thumbnail) : undefined) ||
    allMedia.find((media) => !media.isVideo)?.url ||
    undefined;

  const activeMedia = allMedia[activeIndex];
  const activeUrl = activeMedia?.url || "";
  const isVideo = activeMedia?.isVideo ?? false;

  function goTo(index: number) {
    if (index >= 0 && index < allMedia.length) {
      setActiveIndex(index);
    }
  }

  const attributes = item.attributes ?? {};
  const attributeEntries = Object.entries(attributes).filter(
    ([, v]) => v !== null && v !== undefined && v !== ""
  );

  const locationParts = [item.location_suburb, item.location_city, item.location_province].filter(
    Boolean
  );

  return (
    <ScrollArea className="h-[calc(100vh-10rem)]">
      <div className="space-y-5 pr-4">
        {/* ── Media Gallery ─────────────────────────── */}
        {allMedia.length > 0 ? (
          <div className="space-y-2">
            <div className="relative group rounded-lg overflow-hidden bg-warm-100 dark:bg-warm-800">
              <div className="aspect-video relative">
                {isVideo ? (
                  <VideoWithPoster
                    key={activeUrl}
                    src={activeUrl}
                    posterUrl={firstPhotoUrl}
                    controls
                    playsInline
                    className="w-full h-full object-contain bg-black rounded-lg"
                    wrapperClassName="w-full h-full"
                  />
                ) : (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={activeUrl}
                    alt={`${item.title ?? "Item"} - image ${activeIndex + 1}`}
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                )}

                {allMedia.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={() => goTo(activeIndex - 1)}
                      disabled={activeIndex === 0}
                      className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/40 text-white backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-0 hover:bg-black/60"
                      aria-label="Previous image"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => goTo(activeIndex + 1)}
                      disabled={activeIndex === allMedia.length - 1}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/40 text-white backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-0 hover:bg-black/60"
                      aria-label="Next image"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </>
                )}

                {allMedia.length > 1 && (
                  <div className="absolute bottom-2 right-2 bg-black/50 text-white text-xs font-medium px-2 py-0.5 rounded-full backdrop-blur-sm">
                    {activeIndex + 1} / {allMedia.length}
                  </div>
                )}
              </div>
            </div>

            {/* Thumbnails */}
            {allMedia.length > 1 && (
              <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
                {allMedia.map((media, i) => {
                  return (
                    <button
                      key={`${media.url}-${i}`}
                      type="button"
                      onClick={() => setActiveIndex(i)}
                      className={cn(
                        "relative flex-shrink-0 w-14 h-14 rounded-md overflow-hidden border-2 transition-all",
                        i === activeIndex
                          ? "border-brand-green ring-1 ring-brand-green/20"
                          : "border-transparent opacity-60 hover:opacity-100"
                      )}
                    >
                      {media.isVideo ? (
                        <VideoThumbnailThumb firstPhoto={firstPhotoUrl} />
                      ) : (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={media.url}
                          alt={`Thumbnail ${i + 1}`}
                          className="w-full h-full object-cover"
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="aspect-video rounded-lg bg-muted flex items-center justify-center">
            <p className="text-sm text-muted-foreground">No media</p>
          </div>
        )}

        {/* ── Title & Badges ───────────────────────── */}
        <div className="space-y-2">
          <h3 className="text-lg font-semibold font-display">
            {item.title || `Item ${item.id.slice(0, 8)}`}
          </h3>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="text-[10px]">
              {item.itemType}
            </Badge>
            <Badge variant="secondary" className="text-[10px]">
              {item.areaLabel}
            </Badge>
            {item.category && (
              <Badge variant="secondary" className="text-[10px] capitalize">
                {item.category.replace(/_/g, " ")}
              </Badge>
            )}
            {typeof attributes.condition === "string" && (
              <Badge variant="outline" className="text-[10px] capitalize">
                {attributes.condition.replace(/_/g, " ")}
              </Badge>
            )}
          </div>
        </div>

        {/* ── Price ────────────────────────────────── */}
        {item.price_cents != null && (
          <div className="flex items-baseline gap-2">
            <p className="text-2xl font-bold font-display text-brand-green">
              {formatZAR(item.price_cents)}
            </p>
            {item.price_negotiable && (
              <Badge className="bg-brand-green/10 text-brand-green text-xs">Negotiable</Badge>
            )}
          </div>
        )}

        <Separator />

        {/* ── Description ──────────────────────────── */}
        {item.description && (
          <div className="space-y-1.5">
            <h4 className="text-sm font-semibold">Description</h4>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
              {item.description}
            </p>
          </div>
        )}

        {/* ── Location ─────────────────────────────── */}
        {locationParts.length > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <div className="rounded-full bg-brand-green/10 p-1.5">
              <MapPin className="h-3.5 w-3.5 text-brand-green" />
            </div>
            <span className="text-muted-foreground">{locationParts.join(", ")}</span>
          </div>
        )}

        {/* ── Category Attributes ──────────────────── */}
        {attributeEntries.length > 0 && (
          <>
            <Separator />
            <div className="space-y-1.5">
              <h4 className="text-sm font-semibold flex items-center gap-1.5">
                <Tag className="h-3.5 w-3.5" />
                Details
              </h4>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                {attributeEntries.map(([key, value]) => (
                  <div key={key} className="text-sm">
                    <span className="text-muted-foreground">
                      {ATTRIBUTE_LABELS[key] || key.replace(/_/g, " ")}:
                    </span>{" "}
                    <span className="font-medium capitalize">
                      {typeof value === "boolean"
                        ? value
                          ? "Yes"
                          : "No"
                        : String(value).replace(/_/g, " ")}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ── Contact Methods ──────────────────────── */}
        {item.contact_methods && item.contact_methods.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Contact:</span>
            {item.contact_methods.map((m) => (
              <Badge key={m} variant="outline" className="text-[10px] capitalize">
                {m}
              </Badge>
            ))}
          </div>
        )}

        {/* ── Account Info ─────────────────────────── */}
        <Separator />
        <div className="space-y-1.5">
          <h4 className="text-sm font-semibold flex items-center gap-1.5">
            <User className="h-3.5 w-3.5" />
            Account
          </h4>
          <div className="text-sm text-muted-foreground space-y-1">
            <p>
              <span className="text-muted-foreground">ID:</span>{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">
                {item.owner_id?.slice(0, 12)}…
              </code>
            </p>
            {item.buyer_verification_required && (
              <p className="flex items-center gap-1 text-amber-600">
                <ShieldCheck className="h-3.5 w-3.5" />
                Buyer verification required
              </p>
            )}
          </div>
        </div>

        {/* ── Submission Time ──────────────────────── */}
        <p className="text-xs text-muted-foreground">
          Submitted {formatRelativeTime(item.created_at)}
        </p>
      </div>
    </ScrollArea>
  );
}
