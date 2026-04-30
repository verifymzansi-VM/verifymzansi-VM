import { z } from "zod";
import {
  platformMediaUrlArraySchema,
  platformMediaUrlSchema,
  postLocationFields,
  postMediaMetadataFields,
  priceSchema,
  externalUrlOrEmptySchema,
} from "./shared";

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

/* ── Reusable fragments ──────────────────────────────────── */

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
  ...postLocationFields,
  contact_methods: z
    .array(z.enum(["call", "whatsapp", "form"]))
    .min(1, "At least one contact method is required"),
  images: platformMediaUrlArraySchema(10).min(1, "At least 1 image is required"),
  videos: platformMediaUrlArraySchema(3).optional().default([]),
  video_thumbnail: platformMediaUrlSchema(
    "Video thumbnail must be hosted on the VerifyMzansi platform"
  ).optional(),
  ...postMediaMetadataFields,
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
  booking_url: externalUrlOrEmptySchema("Enter a valid booking URL"),
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
  /* SA tourism additions */
  tgcsa_grading: z.enum(["1_star", "2_star", "3_star", "4_star", "5_star"]).optional(),
  minimum_stay_nights: z.number().int().min(1).optional(),
  child_policy: z
    .enum(["children_welcome", "children_over_6", "children_over_12", "adults_only"])
    .optional(),
  seasonal_pricing: z.boolean().optional(),
  nearby_attractions: z.string().max(500).optional(),
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
  website: externalUrlOrEmptySchema("Enter a valid website URL"),
  logo: platformMediaUrlSchema("Logo must be hosted on the VerifyMzansi platform").optional(),
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
  tickets_url: externalUrlOrEmptySchema("Enter a valid ticketing URL"),
  age_restriction: z.enum(AGE_RESTRICTION_VALUES).optional(),
  dress_code: z.string().max(300).optional(),
  lineup: z.string().max(2000).optional(),
  parking_available: z.boolean().optional(),
  accessibility: z.array(z.string().max(80)).optional(),
  food_drinks_available: z.boolean().optional(),
  bring_your_own: z.string().max(500).optional(),
  /* SA event additions */
  recurring: z.enum(["one_off", "weekly", "monthly", "annual"]).optional(),
  rain_policy: z
    .enum(["outdoor_rain_or_shine", "moved_indoors", "postponed", "refunded"])
    .optional(),
  early_bird_deadline: z.string().max(30).optional(),
  group_discount_available: z.boolean().optional(),
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

type _TourismBusinessInput = z.infer<typeof tourismBusinessSchema>;
type _EventInput = z.infer<typeof eventSchema>;
type _TourismInput = z.infer<typeof tourismSchema>;
