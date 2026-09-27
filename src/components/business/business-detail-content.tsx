"use client";

import { BedDouble, Globe, MapPin, Star } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { Badge } from "@/components/ui/badge";

import { safeExternalHref } from "@/lib/utils/sanitize-html";
import { type BusinessCategory, type BusinessType } from "@/types/enums";

import {
  PRIMARY_ORDER_CHANNEL_LABELS,
  WALK_IN_POLICY_LABELS,
} from "@/lib/forms/business-type-details";
import {
  TOURISM_ACCOMMODATION_TYPES,
  TOURISM_CANCELLATION_POLICIES,
  TOURISM_PRICE_RANGES,
  TOURISM_SUBCATEGORIES,
  TOURISM_TOUR_DURATIONS,
  TOURISM_DIFFICULTY_LEVELS,
  TOURISM_AGE_RESTRICTIONS,
  TOURISM_VISIT_DURATIONS,
} from "@/lib/constants/categories";

import type { TourismCategoryDetails } from "@/types/tourism-details";
import type { BusinessDetails } from "@/types/business-details";

import { formatRandAmount } from "@/lib/utils/format";

export interface BusinessDetailRecord {
  id: string;
  owner_id: string;
  business_name: string;
  description: string | null;
  status: string;
  business_type: string;
  category: string;
  subcategory: string | null;
  category_details: Record<string, unknown> | null;
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
  location_town: string | null;
  location_address: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  website: string | null;
  store_number: string | null;
  map_directions: string | null;
  business_details: BusinessDetails | null;
  layout_template?: string | null;
  view_count?: number | null;
}

export interface BusinessOwnerRecord {
  display_name: string | null;
}

export interface BusinessPromotionRecord {
  id: string;
  title: string;
  promotion_type: string;
  category: string | null;
  category_key: BusinessCategory | null;
  photos: string[] | null;
  videos: string[] | null;
  video_thumbnail: string | null;
  focal_x: number | null;
  focal_y: number | null;
  media_width: number | null;
  media_height: number | null;
  price_cents: number | null;
  price_negotiable: boolean;
  location_province: string;
  location_city: string;
  boost_until: string | null;
  featured_until: string | null;
  view_count: number | null;
  like_count?: number | null;
  viewer_has_liked?: boolean;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
}

export function BusinessDetailsCard({
  business,
  businessType,
  businessDetails,
  serviceAreas,
}: {
  business: BusinessDetailRecord;
  businessType: BusinessType;
  businessDetails: BusinessDetails | null;
  serviceAreas: { areas?: string[] } | null;
}) {
  const canShowMapDirections = businessType !== "home_business";
  const mallDetails =
    businessType === "mall_store" && businessDetails?.type === "mall_store"
      ? businessDetails
      : null;

  if (!(
    businessDetails ||
    business.store_number ||
    (canShowMapDirections && business.map_directions) ||
    serviceAreas
  )) {
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
            {mallDetails?.mall_name && (
              <div className="flex items-start justify-between gap-4">
                <span className="text-muted-foreground">Mall</span>
                <span className="text-right font-medium">{mallDetails.mall_name}</span>
              </div>
            )}
            {business.store_number && (
              <div className="flex items-start justify-between gap-4">
                <span className="text-muted-foreground">Store number</span>
                <span className="text-right font-medium">{business.store_number}</span>
              </div>
            )}
            {mallDetails?.mall_address && (
              <div className="space-y-1">
                <p className="text-muted-foreground">Mall address</p>
                <p className="font-medium">{mallDetails.mall_address}</p>
              </div>
            )}
            {mallDetails?.floor_or_wing && (
              <div className="flex items-start justify-between gap-4">
                <span className="text-muted-foreground">Floor / wing</span>
                <span className="text-right font-medium">{mallDetails.floor_or_wing}</span>
              </div>
            )}
            {mallDetails?.nearest_entrance && (
              <div className="flex items-start justify-between gap-4">
                <span className="text-muted-foreground">Nearest entrance</span>
                <span className="text-right font-medium">{mallDetails.nearest_entrance}</span>
              </div>
            )}
            {mallDetails?.parking_notes && (
              <div className="space-y-1">
                <p className="text-muted-foreground">Parking notes</p>
                <p className="font-medium">{mallDetails.parking_notes}</p>
              </div>
            )}
            {mallDetails?.mall_summary && (
              <div className="space-y-1">
                <p className="text-muted-foreground">Mall information</p>
                <p className="font-medium whitespace-pre-wrap">{mallDetails.mall_summary}</p>
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
                  {`R ${formatRandAmount(businessDetails.callout_fee_from)}`}
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
            {businessDetails.order_url && (
              <Button asChild variant="outline" className="w-full gap-2">
                <a
                  href={safeExternalHref(businessDetails.order_url)}
                  target="_blank"
                  rel="noopener noreferrer nofollow ugc"
                >
                  <Globe className="h-4 w-4" />
                  Order Online
                </a>
              </Button>
            )}
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
            <a
              href={safeExternalHref(business.map_directions)}
              target="_blank"
              rel="noopener noreferrer nofollow ugc"
            >
              <MapPin className="h-4 w-4" />
              Open Map Directions
            </a>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Tourism‑specific details card                                      */
/* ------------------------------------------------------------------ */

function lookupLabel(
  list: ReadonlyArray<{ value: string; label: string }>,
  value: string | undefined
): string | null {
  if (!value) return null;
  return list.find((i) => i.value === value)?.label ?? value.replace(/_/g, " ");
}

export function TourismDetailsCard({ details }: { details: TourismCategoryDetails }) {
  const hasContent =
    details.star_rating ||
    details.number_of_rooms ||
    details.accommodation_types?.length ||
    details.check_in_time ||
    details.price_range ||
    details.amenities?.length ||
    details.meal_options?.length ||
    details.languages_spoken ||
    details.cancellation_policy ||
    details.booking_url ||
    details.pets_allowed != null ||
    details.smoking_allowed != null ||
    details.treatment_types?.length ||
    details.activity_types?.length ||
    details.tour_duration ||
    details.max_group_size ||
    details.difficulty_level ||
    details.equipment_provided != null ||
    details.whats_included ||
    details.age_restriction ||
    details.guided_tours != null ||
    details.audio_guide != null ||
    details.visit_duration ||
    details.services_offered?.length ||
    details.specializations?.length ||
    details.vehicle_types?.length ||
    details.delivery_collection != null ||
    details.min_driver_age ||
    details.insurance_included != null ||
    details.gps_available != null;

  if (!hasContent) return null;

  const subcategoryLabel = details.subcategory
    ? TOURISM_SUBCATEGORIES.find((s) => s.value === details.subcategory)?.label
    : null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <BedDouble className="h-4 w-4 text-muted-foreground" />
          Tourism &amp; Hospitality Details
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {subcategoryLabel && (
          <div className="flex items-start justify-between gap-4">
            <span className="text-muted-foreground">Type</span>
            <Badge variant="secondary">{subcategoryLabel}</Badge>
          </div>
        )}

        {typeof details.star_rating === "number" && details.star_rating > 0 && (
          <div className="flex items-start justify-between gap-4">
            <span className="text-muted-foreground">Rating</span>
            <span className="flex gap-0.5" role="img" aria-label={`${details.star_rating} stars`}>
              {Array.from({ length: details.star_rating }).map((_, i) => (
                <Star key={i} className="h-4 w-4 fill-amber-400 text-amber-400" />
              ))}
            </span>
          </div>
        )}

        {typeof details.number_of_rooms === "number" && (
          <div className="flex items-start justify-between gap-4">
            <span className="text-muted-foreground">Rooms / Units</span>
            <span className="font-medium">{details.number_of_rooms}</span>
          </div>
        )}

        {details.accommodation_types && details.accommodation_types.length > 0 && (
          <div className="space-y-1">
            <p className="text-muted-foreground">Accommodation types</p>
            <div className="flex flex-wrap gap-2">
              {details.accommodation_types.map((t) => (
                <Badge key={t} variant="secondary">
                  {TOURISM_ACCOMMODATION_TYPES.includes(
                    t as (typeof TOURISM_ACCOMMODATION_TYPES)[number]
                  )
                    ? t
                    : t}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {(details.check_in_time || details.check_out_time) && (
          <div className="grid grid-cols-2 gap-4">
            {details.check_in_time && (
              <div>
                <p className="text-muted-foreground">Check-in</p>
                <p className="font-medium">{details.check_in_time}</p>
              </div>
            )}
            {details.check_out_time && (
              <div>
                <p className="text-muted-foreground">Check-out</p>
                <p className="font-medium">{details.check_out_time}</p>
              </div>
            )}
          </div>
        )}

        {details.price_range && (
          <div className="flex items-start justify-between gap-4">
            <span className="text-muted-foreground">Price range</span>
            <span className="font-medium">
              {lookupLabel(TOURISM_PRICE_RANGES, details.price_range)}
            </span>
          </div>
        )}

        {details.amenities && details.amenities.length > 0 && (
          <div className="space-y-1">
            <p className="text-muted-foreground">Amenities</p>
            <div className="flex flex-wrap gap-2">
              {details.amenities.map((a) => (
                <Badge key={a} variant="outline">
                  {a}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {details.meal_options && details.meal_options.length > 0 && (
          <div className="space-y-1">
            <p className="text-muted-foreground">Meal options</p>
            <div className="flex flex-wrap gap-2">
              {details.meal_options.map((m) => (
                <Badge key={m} variant="outline">
                  {m}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {details.languages_spoken && (
          <div className="flex items-start justify-between gap-4">
            <span className="text-muted-foreground">Languages spoken</span>
            <span className="text-right font-medium">{details.languages_spoken}</span>
          </div>
        )}

        {details.cancellation_policy && (
          <div className="flex items-start justify-between gap-4">
            <span className="text-muted-foreground">Cancellation</span>
            <span className="font-medium">
              {lookupLabel(TOURISM_CANCELLATION_POLICIES, details.cancellation_policy)}
            </span>
          </div>
        )}

        {(details.pets_allowed != null || details.smoking_allowed != null) && (
          <div className="grid grid-cols-2 gap-4">
            {details.pets_allowed != null && (
              <div className="flex items-start justify-between gap-4">
                <span className="text-muted-foreground">Pets</span>
                <span className="font-medium">
                  {details.pets_allowed ? "Allowed" : "Not allowed"}
                </span>
              </div>
            )}
            {details.smoking_allowed != null && (
              <div className="flex items-start justify-between gap-4">
                <span className="text-muted-foreground">Smoking</span>
                <span className="font-medium">
                  {details.smoking_allowed ? "Allowed" : "Not allowed"}
                </span>
              </div>
            )}
          </div>
        )}

        {details.booking_url && (
          <Button asChild variant="outline" className="w-full gap-2">
            <a
              href={safeExternalHref(details.booking_url)}
              target="_blank"
              rel="noopener noreferrer nofollow ugc"
            >
              <Globe className="h-4 w-4" />
              Book Online
            </a>
          </Button>
        )}

        {/* ── Spa fields ── */}
        {details.treatment_types && details.treatment_types.length > 0 && (
          <div className="space-y-1">
            <p className="text-muted-foreground">Treatment types</p>
            <div className="flex flex-wrap gap-2">
              {details.treatment_types.map((t) => (
                <Badge key={t} variant="outline">
                  {t}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* ── Tour / Safari fields ── */}
        {details.activity_types && details.activity_types.length > 0 && (
          <div className="space-y-1">
            <p className="text-muted-foreground">Activity types</p>
            <div className="flex flex-wrap gap-2">
              {details.activity_types.map((a) => (
                <Badge key={a} variant="outline">
                  {a}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {details.tour_duration && (
          <div className="flex items-start justify-between gap-4">
            <span className="text-muted-foreground">Tour duration</span>
            <span className="font-medium">
              {lookupLabel(TOURISM_TOUR_DURATIONS, details.tour_duration)}
            </span>
          </div>
        )}

        {typeof details.max_group_size === "number" && (
          <div className="flex items-start justify-between gap-4">
            <span className="text-muted-foreground">Max group size</span>
            <span className="font-medium">{details.max_group_size}</span>
          </div>
        )}

        {details.difficulty_level && (
          <div className="flex items-start justify-between gap-4">
            <span className="text-muted-foreground">Difficulty</span>
            <span className="font-medium">
              {lookupLabel(TOURISM_DIFFICULTY_LEVELS, details.difficulty_level)}
            </span>
          </div>
        )}

        {details.equipment_provided != null && (
          <div className="flex items-start justify-between gap-4">
            <span className="text-muted-foreground">Equipment</span>
            <span className="font-medium">
              {details.equipment_provided ? "Provided" : "Not provided"}
            </span>
          </div>
        )}

        {details.whats_included && (
          <div className="flex items-start justify-between gap-4">
            <span className="text-muted-foreground">What&apos;s included</span>
            <span className="text-right font-medium">{details.whats_included}</span>
          </div>
        )}

        {details.age_restriction && (
          <div className="flex items-start justify-between gap-4">
            <span className="text-muted-foreground">Age restriction</span>
            <span className="font-medium">
              {lookupLabel(TOURISM_AGE_RESTRICTIONS, details.age_restriction)}
            </span>
          </div>
        )}

        {/* ── Attraction fields ── */}
        {(details.guided_tours != null || details.audio_guide != null) && (
          <div className="grid grid-cols-2 gap-4">
            {details.guided_tours != null && (
              <div className="flex items-start justify-between gap-4">
                <span className="text-muted-foreground">Guided tours</span>
                <span className="font-medium">{details.guided_tours ? "Yes" : "No"}</span>
              </div>
            )}
            {details.audio_guide != null && (
              <div className="flex items-start justify-between gap-4">
                <span className="text-muted-foreground">Audio guide</span>
                <span className="font-medium">{details.audio_guide ? "Yes" : "No"}</span>
              </div>
            )}
          </div>
        )}

        {details.visit_duration && (
          <div className="flex items-start justify-between gap-4">
            <span className="text-muted-foreground">Visit duration</span>
            <span className="font-medium">
              {lookupLabel(TOURISM_VISIT_DURATIONS, details.visit_duration)}
            </span>
          </div>
        )}

        {/* ── Travel Agency fields ── */}
        {details.services_offered && details.services_offered.length > 0 && (
          <div className="space-y-1">
            <p className="text-muted-foreground">Services offered</p>
            <div className="flex flex-wrap gap-2">
              {details.services_offered.map((s) => (
                <Badge key={s} variant="outline">
                  {s}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {details.specializations && details.specializations.length > 0 && (
          <div className="space-y-1">
            <p className="text-muted-foreground">Specializations</p>
            <div className="flex flex-wrap gap-2">
              {details.specializations.map((s) => (
                <Badge key={s} variant="outline">
                  {s}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* ── Car Rental fields ── */}
        {details.vehicle_types && details.vehicle_types.length > 0 && (
          <div className="space-y-1">
            <p className="text-muted-foreground">Vehicle types</p>
            <div className="flex flex-wrap gap-2">
              {details.vehicle_types.map((v) => (
                <Badge key={v} variant="outline">
                  {v}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {typeof details.min_driver_age === "number" && (
          <div className="flex items-start justify-between gap-4">
            <span className="text-muted-foreground">Min driver age</span>
            <span className="font-medium">{details.min_driver_age}</span>
          </div>
        )}

        {(details.delivery_collection != null ||
          details.insurance_included != null ||
          details.gps_available != null) && (
          <div className="flex flex-wrap gap-4">
            {details.delivery_collection != null && (
              <Badge variant={details.delivery_collection ? "secondary" : "outline"}>
                Delivery &amp; Collection: {details.delivery_collection ? "Yes" : "No"}
              </Badge>
            )}
            {details.insurance_included != null && (
              <Badge variant={details.insurance_included ? "secondary" : "outline"}>
                Insurance Included: {details.insurance_included ? "Yes" : "No"}
              </Badge>
            )}
            {details.gps_available != null && (
              <Badge variant={details.gps_available ? "secondary" : "outline"}>
                GPS Available: {details.gps_available ? "Yes" : "No"}
              </Badge>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
