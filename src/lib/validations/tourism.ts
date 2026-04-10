import { z } from "zod";
import { priceSchema } from "./shared";
import { isTrustedPlatformMediaUrl } from "@/lib/utils/media-url";
import { SOCIAL_AUTHORIZATION_VERSION } from "@/lib/promotions/social-authorization";

/* ── Allowed-value lists ─────────────────────────────────── */

const TOURISM_SUBCATEGORY_VALUES = [
  "hotel_resort",
  "guest_house_bnb",
  "lodge_game_lodge",
  "backpackers_hostel",
  "self_catering",
  "tour_operator",
  "travel_agency",
  "safari_wildlife",
  "adventure_activities",
  "cultural_heritage",
  "car_rental_tourism",
  "campground_caravan",
  "spa_wellness_retreat",
  "tourist_attraction",
] as const;

const EVENT_TYPE_VALUES = [
  "festival_concert",
  "conference_seminar",
  "market_expo",
  "sports_event",
  "cultural_heritage",
  "food_wine",
  "outdoor_adventure",
  "workshop_masterclass",
  "charity_fundraiser",
  "community_gathering",
  "comedy_theatre",
  "kids_family",
  "nightlife_party",
] as const;

const PRICE_RANGE_VALUES = ["budget", "midrange", "premium", "luxury"] as const;

const CANCELLATION_POLICY_VALUES = [
  "free",
  "flexible",
  "moderate",
  "strict",
  "non_refundable",
] as const;

const AGE_RESTRICTION_VALUES = ["all_ages", "12_plus", "16_plus", "18_plus", "21_plus"] as const;

const TOURISM_AGE_RESTRICTION_VALUES = [
  "all_ages",
  "6_plus",
  "12_plus",
  "16_plus",
  "18_plus",
] as const;

const TOUR_DURATION_VALUES = ["1_2_hours", "half_day", "full_day", "multi_day", "custom"] as const;

const DIFFICULTY_LEVEL_VALUES = ["easy", "moderate", "challenging", "expert"] as const;

const VISIT_DURATION_VALUES = [
  "under_1_hour",
  "1_2_hours",
  "2_4_hours",
  "half_day",
  "full_day",
] as const;

const SOCIAL_AUTHORIZER_RELATIONSHIP_VALUES = [
  "owner",
  "business_representative",
  "agency_or_marketing_partner",
] as const;

/* ── Reusable fragments ──────────────────────────────────── */

const trustedUrlArray = (max: number) =>
  z
    .array(
      z.string().url().refine(isTrustedPlatformMediaUrl, {
        message: "Media must be hosted on the VerifyMzansi platform",
      })
    )
    .max(max);

const socialAuthorizationSchema = z
  .object({
    granted: z.boolean(),
    authorizerName: z.string().trim().max(100).optional(),
    authorizerRole: z.string().trim().max(100).optional(),
    relationship: z.enum(SOCIAL_AUTHORIZER_RELATIONSHIP_VALUES).optional(),
    monetizationAcknowledged: z.boolean().optional(),
    acceptedVersion: z.string().max(30).optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.granted) return;

    if (!value.authorizerName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["authorizerName"],
        message: "Authorizer name is required when social distribution is authorized.",
      });
    }
    if (!value.authorizerRole) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["authorizerRole"],
        message: "Authorizer role is required when social distribution is authorized.",
      });
    }
    if (!value.relationship) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["relationship"],
        message: "Relationship is required when social distribution is authorized.",
      });
    }
    if (value.monetizationAcknowledged !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["monetizationAcknowledged"],
        message: "Monetization acknowledgement is required when social distribution is authorized.",
      });
    }
    if (value.acceptedVersion !== SOCIAL_AUTHORIZATION_VERSION) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["acceptedVersion"],
        message: "You must accept the current social authorization terms.",
      });
    }
  });

/* ── Shared fields (both tourism business & event) ───────── */

const sharedFields = {
  title: z
    .string()
    .min(5, "Title must be at least 5 characters")
    .max(120, "Title cannot exceed 120 characters"),
  description: z
    .string()
    .min(20, "Description must be at least 20 characters")
    .max(5000, "Description cannot exceed 5 000 characters"),
  province: z.string().min(1, "Province is required").max(50),
  city: z.string().min(1, "City is required").max(80),
  location_town: z.string().trim().min(1).max(120).optional(),
  location_address: z.string().trim().min(1).max(300).optional(),
  contact_methods: z
    .array(z.enum(["call", "whatsapp", "form"]))
    .min(1, "At least one contact method is required"),
  images: trustedUrlArray(10).min(1, "At least 1 image is required"),
  videos: trustedUrlArray(3).optional().default([]),
  video_thumbnail: z
    .string()
    .url()
    .refine(isTrustedPlatformMediaUrl, {
      message: "Video thumbnail must be hosted on the VerifyMzansi platform",
    })
    .optional(),
  media_width: z.number().int().positive().optional(),
  media_height: z.number().int().positive().optional(),
  focal_x: z.number().min(0).max(1).optional(),
  focal_y: z.number().min(0).max(1).optional(),
  business_id: z.string().uuid().optional(),
};

/* ── Tourism business schema ─────────────────────────────── */

const tourismCategoryDetailsSchema = z.object({
  subcategory: z.enum(TOURISM_SUBCATEGORY_VALUES).optional(),
  star_rating: z.number().int().min(1).max(5).optional(),
  number_of_rooms: z.number().int().min(0).optional(),
  accommodation_types: z.array(z.string().max(80)).optional(),
  check_in_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "Use HH:mm format")
    .optional(),
  check_out_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "Use HH:mm format")
    .optional(),
  price_range: z.enum(PRICE_RANGE_VALUES).optional(),
  amenities: z.array(z.string().max(80)).optional(),
  meal_options: z.array(z.string().max(80)).optional(),
  languages_spoken: z.string().max(500).optional(),
  cancellation_policy: z.enum(CANCELLATION_POLICY_VALUES).optional(),
  booking_url: z.string().url("Enter a valid booking URL").max(2000).optional().or(z.literal("")),
  pets_allowed: z.boolean().optional(),
  smoking_allowed: z.boolean().optional(),
  /* Spa & Wellness (Group B) */
  treatment_types: z.array(z.string().max(80)).optional(),
  /* Tours & Safaris (Group C) */
  activity_types: z.array(z.string().max(80)).optional(),
  tour_duration: z.enum(TOUR_DURATION_VALUES).optional(),
  max_group_size: z.number().int().min(1).optional(),
  difficulty_level: z.enum(DIFFICULTY_LEVEL_VALUES).optional(),
  equipment_provided: z.boolean().optional(),
  whats_included: z.string().max(2000).optional(),
  age_restriction: z.enum(TOURISM_AGE_RESTRICTION_VALUES).optional(),
  /* Travel Agency (Group D) */
  services_offered: z.array(z.string().max(80)).optional(),
  specializations: z.array(z.string().max(80)).optional(),
  /* Attractions & Sites (Group E) */
  guided_tours: z.boolean().optional(),
  audio_guide: z.boolean().optional(),
  visit_duration: z.enum(VISIT_DURATION_VALUES).optional(),
  /* Car Rental (Group F) */
  vehicle_types: z.array(z.string().max(80)).optional(),
  delivery_collection: z.boolean().optional(),
  min_driver_age: z.number().int().min(16).max(99).optional(),
  insurance_included: z.boolean().optional(),
  gps_available: z.boolean().optional(),
});

export const tourismBusinessSchema = z.object({
  listing_type: z.literal("tourism_business"),
  ...sharedFields,
  phone: z
    .string()
    .regex(/^(\+27|0)[6-8][0-9]{8}$/, "Enter a valid SA mobile number")
    .optional()
    .or(z.literal("")),
  whatsapp: z
    .string()
    .regex(/^(\+27|0)[6-8][0-9]{8}$/, "Enter a valid SA WhatsApp number")
    .optional()
    .or(z.literal("")),
  email: z.string().email("Enter a valid email").max(254).optional().or(z.literal("")),
  website: z.string().url("Enter a valid website URL").max(2000).optional().or(z.literal("")),
  logo: z
    .string()
    .url()
    .refine(isTrustedPlatformMediaUrl, {
      message: "Logo must be hosted on the VerifyMzansi platform",
    })
    .optional(),
  category_details: tourismCategoryDetailsSchema,
  operating_hours: z
    .object({
      weekday: z.string().max(50).optional(),
      saturday: z.string().max(50).optional(),
      sunday: z.string().max(50).optional(),
    })
    .optional(),
});

/* ── Event schema ────────────────────────────────────────── */

const ticketTierSchema = z.object({
  name: z.string().min(1, "Tier name is required").max(80),
  price_cents: z.number().int().min(0).nullable(),
});

const eventDetailsSchema = z.object({
  event_type: z.enum(EVENT_TYPE_VALUES).optional(),
  venue_name: z.string().max(200).optional(),
  venue_capacity: z.number().int().min(0).optional(),
  ticket_tiers: z.array(ticketTierSchema).max(10).optional(),
  tickets_url: z.string().url("Enter a valid ticketing URL").max(2000).optional().or(z.literal("")),
  age_restriction: z.enum(AGE_RESTRICTION_VALUES).optional(),
  dress_code: z.string().max(300).optional(),
  lineup: z.string().max(2000).optional(),
  parking_available: z.boolean().optional(),
  accessibility: z.array(z.string().max(80)).optional(),
  food_drinks_available: z.boolean().optional(),
  bring_your_own: z.string().max(500).optional(),
});

export const eventSchema = z
  .object({
    listing_type: z.literal("event"),
    ...sharedFields,
    price_zar: priceSchema.optional(),
    negotiable: z.boolean().default(false),
    start_date: z.string().datetime({ message: "Start date is required" }),
    end_date: z.string().datetime().optional(),
    event_details: eventDetailsSchema,
    socialAuthorization: socialAuthorizationSchema.optional(),
  })
  .refine(
    (data) => {
      if (data.start_date && data.end_date) {
        return new Date(data.end_date) >= new Date(data.start_date);
      }
      return true;
    },
    { message: "End date must be on or after start date", path: ["end_date"] }
  );

/* ── Discriminated union ─────────────────────────────────── */

export const tourismSchema = z.discriminatedUnion("listing_type", [
  tourismBusinessSchema,
  eventSchema,
]);

/* ── Inferred types ──────────────────────────────────────── */

export type TourismBusinessInput = z.infer<typeof tourismBusinessSchema>;
export type EventInput = z.infer<typeof eventSchema>;
export type TourismInput = z.infer<typeof tourismSchema>;
