"use client";
import { PostSelect } from "@/components/post/post-select";
import { EventDateFields } from "@/components/post/event-date-fields";
import { eventTimeToIso } from "@/lib/forms/event-time";

import { settleMediaUploads } from "@/app/post/_lib/settle-media-uploads";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Camera, ClipboardList, Eye, MapPin, TreePalm } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PostLabel as Label } from "@/components/post/post-label";
import { Textarea } from "@/components/ui/textarea";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { MediaUpload } from "@/components/ui/media-upload";
import { UploadProgressPanel, type UploadSlotStatus } from "@/components/ui/upload-progress-panel";
import { VideoFrameSelector } from "@/components/ui/video-frame-selector";
import { MediaCropPreview, type CropPosition } from "@/components/ui/media-crop-preview";
import {
  PlanGate,
  usePlanMaxPhotos,
  usePlanMaxVideos,
  usePlanVideoAllowed,
} from "@/components/billing/plan-gate";
import { LocationSelector, type LocationValue } from "@/components/ui/location-selector";
import {
  TOURISM_SUBCATEGORIES,
  TOURISM_AMENITIES,
  TOURISM_MEAL_OPTIONS,
  TOURISM_PRICE_RANGES,
  TOURISM_CANCELLATION_POLICIES,
  TOURISM_ACCOMMODATION_TYPES,
  TOURISM_SUBCATEGORY_FIELD_GROUPS,
  TOURISM_TREATMENT_TYPES,
  TOURISM_ACTIVITY_TYPES,
  TOURISM_TOUR_DURATIONS,
  TOURISM_DIFFICULTY_LEVELS,
  TOURISM_AGE_RESTRICTIONS,
  TOURISM_VISIT_DURATIONS,
  TOURISM_VEHICLE_TYPES,
  TOURISM_TRAVEL_SERVICES,
  TOURISM_TRAVEL_SPECIALIZATIONS,
  EVENT_TYPES,
  EVENT_AGE_RESTRICTIONS,
  EVENT_ACCESSIBILITY_OPTIONS,
} from "@/lib/constants/categories";
import { PhotoOrderList } from "@/components/post/photo-order-list";
import {
  PostDraftStatus,
  PostFormFooter,
  PostFormScaffold,
  PostFormSection,
  type PostFormStep,
} from "@/components/post/post-form-scaffold";
import {
  normalizeCreatePostError,
  normalizeCreatePostRuntimeError,
} from "@/app/post/_lib/create-post-errors";
import {
  getPromotionMediaUploadErrorState,
  uploadPromotionVideoFiles,
  uploadRequiredPromotionMedia,
} from "@/app/post/_lib/promotion-media-upload";
import { prewarmVideosForFastUpload } from "@/app/post/_lib/video-fast-upload";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { usePostDraftAutosave } from "@/hooks/use-post-draft-autosave";
import { validateTourismStep } from "@/lib/forms/tourism-form";
import type { TourismListingType } from "@/types/tourism-details";
import {
  OperatingHoursInput,
  formatHoursValue,
  parseHoursValue,
} from "@/components/ui/operating-hours-input";
import { ensureCsrfTokenReady, withCsrfHeaders } from "@/lib/utils/csrf";
import { checkUploadServiceReachable } from "@/lib/utils/upload-preflight";
import { readMediaDimensions } from "@/lib/utils/media-metadata";
import type { TourismDraftData } from "@/lib/post-drafts/storage";
import { BusinessLayoutRouter } from "@/components/business/layouts/business-layout-router";
import type { BusinessDetailRecord } from "@/components/business/business-detail-content";
import { PromotionCard } from "@/components/listings/promotion-card";
import {
  PromotionDetailContent,
  type PromotionDetailRecord,
  type PromotionAdvertiserRecord,
} from "@/components/listings/promotion-detail-content";
import { normalizeUserEnteredUrl } from "@/lib/utils/external-url";

const SELECT_CLASS =
  "flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:h-10 sm:text-sm";

const STEPS: PostFormStep[] = [
  {
    label: "About your listing",
    icon: TreePalm,
    description: "Type, name and category",
  },
  { label: "Visitor details", icon: ClipboardList, description: "What guests should know" },
  {
    label: "Location & Contact",
    icon: MapPin,
    description: "Address, contact and hours",
  },
  { label: "Photos & review", icon: Camera, description: "Photos, video and review" },
];

const FIELD_IDS: Record<string, string> = {
  listingType: "listing-type-group",
  title: "title",
  description: "description",
  subcategory: "subcategory",
  eventType: "eventType",
  starRating: "starRating",
  numberOfRooms: "numberOfRooms",
  bookingUrl: "bookingUrl",
  startDate: "start_date",
  endDate: "end_date",
  priceZar: "priceZar",
  venueCapacity: "venueCapacity",
  ticketsUrl: "ticketsUrl",
  province: "province",
  city: "city",
  contactMethods: "tourism-contact-methods",
  joinMethods: "tourism-join-methods",
  meetingPoint: "meetingPoint",
  pickupAreas: "pickupAreas",
  phone: "phone",
  whatsapp: "whatsapp",
  email: "email",
  website: "website",
  locationAddress: "locationAddress",
  locationTown: "locationTown",
  logo_url: "tourism-logo",
  images: "tourism-images",
  videos: "tourism-videos",
  video_thumbnail: "tourism-video-thumbnail",
  termsAccepted: "tourism-terms-checkbox",
};

const FIELD_KEY_ALIASES: Record<string, string> = {
  listing_type: "listingType",
  event_type: "eventType",
  venue_capacity: "venueCapacity",
  booking_url: "bookingUrl",
  tickets_url: "ticketsUrl",
  price_zar: "priceZar",
  start_date: "startDate",
  end_date: "endDate",
  contact_methods: "contactMethods",
  location_province: "province",
  location_city: "city",
  location_town: "locationTown",
  location_address: "locationAddress",
  social_facebook: "socialFacebook",
  social_instagram: "socialInstagram",
  social_twitter: "socialTwitter",
  social_tiktok: "socialTiktok",
  "business_details.street_address": "locationAddress",
  "business_details.suburb": "locationTown",
};

/** Human-readable labels for each form field key, used in the error alert. */
const FIELD_LABELS: Record<string, string> = {
  listingType: "Listing type",
  title: "Title",
  description: "Description",
  subcategory: "Subcategory",
  province: "Province",
  city: "City",
  locationAddress: "Street address",
  locationTown: "Suburb / town",
  contactMethods: "Contact methods",
  joinMethods: "How visitors join",
  meetingPoint: "Meeting point",
  pickupAreas: "Pickup areas",
  phone: "Phone",
  whatsapp: "WhatsApp",
  email: "Email",
  website: "Website",
  socialFacebook: "Facebook",
  socialInstagram: "Instagram",
  socialTwitter: "X / Twitter",
  socialTiktok: "TikTok",
  images: "Photos",
  videos: "Videos",
  eventType: "Event type",
  startDate: "Start date",
  endDate: "End date",
  priceZar: "Price",
  venueName: "Venue name",
  venueCapacity: "Venue capacity",
  ticketsUrl: "Tickets URL",
  bookingUrl: "Booking URL",
  starRating: "Star rating",
  numberOfRooms: "Number of rooms",
  termsAccepted: "Posting terms",
};

function normalizeTourismFieldErrors(errors: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, message] of Object.entries(errors)) {
    const normalizedKey = FIELD_KEY_ALIASES[key] ?? key;
    if (!normalized[normalizedKey]) {
      normalized[normalizedKey] = message;
    }
  }
  return normalized;
}

function getFieldId(key: string | undefined): string | undefined {
  if (!key) return undefined;
  const normalizedKey = FIELD_KEY_ALIASES[key] ?? key;
  return FIELD_IDS[normalizedKey];
}

function getStepForFieldKey(key: string): number {
  const normalizedKey = FIELD_KEY_ALIASES[key] ?? key;

  if (
    normalizedKey === "images" ||
    normalizedKey === "videos" ||
    normalizedKey === "termsAccepted"
  ) {
    return 3;
  }

  if (
    normalizedKey === "province" ||
    normalizedKey === "city" ||
    normalizedKey === "contactMethods" ||
    normalizedKey === "joinMethods" ||
    normalizedKey === "meetingPoint" ||
    normalizedKey === "pickupAreas" ||
    normalizedKey === "phone" ||
    normalizedKey === "whatsapp" ||
    normalizedKey === "email" ||
    normalizedKey === "website" ||
    normalizedKey === "socialFacebook" ||
    normalizedKey === "socialInstagram" ||
    normalizedKey === "socialTwitter" ||
    normalizedKey === "socialTiktok" ||
    normalizedKey === "locationAddress" ||
    normalizedKey === "locationTown"
  ) {
    return 2;
  }

  if (
    normalizedKey === "subcategory" ||
    normalizedKey === "eventType" ||
    normalizedKey === "starRating" ||
    normalizedKey === "numberOfRooms" ||
    normalizedKey === "bookingUrl" ||
    normalizedKey === "startDate" ||
    normalizedKey === "endDate" ||
    normalizedKey === "priceZar" ||
    normalizedKey === "venueCapacity" ||
    normalizedKey === "ticketsUrl"
  ) {
    return 1;
  }

  return 0;
}

function getStepForServerErrors(errors: Record<string, string>): number {
  const keys = Object.keys(errors);
  if (keys.length === 0) {
    return 0;
  }

  return keys.reduce((targetStep, key) => Math.min(targetStep, getStepForFieldKey(key)), 3);
}

export default function CreateTourismPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <TreePalm className="h-8 w-8 animate-pulse text-muted-foreground" />
        </div>
      }
    >
      <CreateTourismContent />
    </Suspense>
  );
}

function parseRequestedTourismListingType(value: string | null): TourismListingType | null {
  const normalized = value?.trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  if (normalized === "event" || normalized === "events") {
    return "event";
  }

  if (
    normalized === "tourism" ||
    normalized === "tourism_business" ||
    normalized === "tourism-business" ||
    normalized === "business"
  ) {
    return "tourism_business";
  }

  return null;
}

function CreateTourismContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedListingType = parseRequestedTourismListingType(searchParams.get("type"));
  const { toast } = useToast();
  const { user, profile, isLoading } = useAuth();

  /* ── Step & error state ──────────────────────────────────── */
  const [step, setStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submissionInFlightRef = useRef(false);
  const [submitProgress, setSubmitProgress] = useState<string | null>(null);
  const [uploadStatuses, setUploadStatuses] = useState<Record<string, UploadSlotStatus>>({
    logo: "idle",
    photos: "idle",
    videos: "idle",
    saving: "idle",
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitSucceeded, setSubmitSucceeded] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  /* ── Shared state ────────────────────────────────────────── */
  const [listingType, setListingType] = useState<TourismListingType>(
    requestedListingType ?? "tourism_business"
  );
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [province, setProvince] = useState("");
  const [city, setCity] = useState("");
  const [locationTown, setLocationTown] = useState("");
  const [locationAddress, setLocationAddress] = useState("");
  const [contactMethods, setContactMethods] = useState<string[]>(["call"]);
  const [phone, setPhone] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [socialFacebook, setSocialFacebook] = useState("");
  const [socialInstagram, setSocialInstagram] = useState("");
  const [socialTwitter, setSocialTwitter] = useState("");
  const [socialTiktok, setSocialTiktok] = useState("");
  const rawBusinessId = searchParams.get("business_id") || "";
  const [businessId, setBusinessId] = useState(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawBusinessId)
      ? rawBusinessId
      : ""
  );

  /* ── Tourism business state ──────────────────────────────── */
  const [subcategory, setSubcategory] = useState("");
  const [starRating, setStarRating] = useState("");
  const [numberOfRooms, setNumberOfRooms] = useState("");
  const [accommodationTypes, setAccommodationTypes] = useState<string[]>([]);
  const [checkInTime, setCheckInTime] = useState("");
  const [checkOutTime, setCheckOutTime] = useState("");
  const [priceRange, setPriceRange] = useState("");
  const [amenities, setAmenities] = useState<string[]>([]);
  const [mealOptions, setMealOptions] = useState<string[]>([]);
  const [languagesSpoken, setLanguagesSpoken] = useState("");
  const [cancellationPolicy, setCancellationPolicy] = useState("");
  const [bookingUrl, setBookingUrl] = useState("");
  const [joinMethods, setJoinMethods] = useState<string[]>([]);
  const [meetingPoint, setMeetingPoint] = useState("");
  const [pickupAreas, setPickupAreas] = useState("");
  const [petsAllowed, setPetsAllowed] = useState(false);
  const [smokingAllowed, setSmokingAllowed] = useState(false);
  /* ── Category-specific tourism state ─────────────────────── */
  const [treatmentTypes, setTreatmentTypes] = useState<string[]>([]);
  const [activityTypes, setActivityTypes] = useState<string[]>([]);
  const [tourDuration, setTourDuration] = useState("");
  const [maxGroupSize, setMaxGroupSize] = useState("");
  const [difficultyLevel, setDifficultyLevel] = useState("");
  const [equipmentProvided, setEquipmentProvided] = useState(false);
  const [whatsIncluded, setWhatsIncluded] = useState("");
  const [tourismAgeRestriction, setTourismAgeRestriction] = useState("");
  const [servicesOffered, setServicesOffered] = useState<string[]>([]);
  const [tourismSpecializations, setTourismSpecializations] = useState<string[]>([]);
  const [guidedTours, setGuidedTours] = useState(false);
  const [audioGuide, setAudioGuide] = useState(false);
  const [visitDuration, setVisitDuration] = useState("");
  const [vehicleTypes, setVehicleTypes] = useState<string[]>([]);
  const [deliveryCollection, setDeliveryCollection] = useState(false);
  const [minDriverAge, setMinDriverAge] = useState("");
  const [insuranceIncluded, setInsuranceIncluded] = useState(false);
  const [gpsAvailable, setGpsAvailable] = useState(false);
  /* SA tourism additions */
  const [tgcsaGrading, setTgcsaGrading] = useState("");
  const [minimumStayNights, setMinimumStayNights] = useState("");
  const [childPolicy, setChildPolicy] = useState("");
  const [seasonalPricing, setSeasonalPricing] = useState(false);
  const [nearbyAttractions, setNearbyAttractions] = useState("");
  const [hoursMonFri, setHoursMonFri] = useState("");
  const [hoursSat, setHoursSat] = useState("");
  const [hoursSun, setHoursSun] = useState("");

  /* ── Event state ─────────────────────────────────────────── */
  const [eventType, setEventType] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [priceZar, setPriceZar] = useState("");
  const [entryChoice, setEntryChoice] = useState<"free" | "paid" | "">("");
  const paidPriceRef = useRef("");
  const [negotiable, setNegotiable] = useState(false);
  const [venueName, setVenueName] = useState("");
  const [venueCapacity, setVenueCapacity] = useState("");
  const [ticketTiers, setTicketTiers] = useState<
    Array<{ name: string; price_cents: number | null }>
  >([]);
  const [ticketsUrl, setTicketsUrl] = useState("");
  const [ageRestriction, setAgeRestriction] = useState("");
  const [dressCode, setDressCode] = useState("");
  const [lineup, setLineup] = useState("");
  const [parkingAvailable, setParkingAvailable] = useState(false);
  const [eventAccessibility, setEventAccessibility] = useState<string[]>([]);
  const [foodDrinksAvailable, setFoodDrinksAvailable] = useState(false);
  const [bringYourOwn, setBringYourOwn] = useState("");
  /* SA event additions */
  const [recurring, setRecurring] = useState("");
  const [rainPolicy, setRainPolicy] = useState("");
  const [earlyBirdDeadline, setEarlyBirdDeadline] = useState("");
  const [groupDiscountAvailable, setGroupDiscountAvailable] = useState(false);

  /* ── Media state ─────────────────────────────────────────── */
  const [logoFiles, setLogoFiles] = useState<File[]>([]);
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [videoFiles, setVideoFiles] = useState<File[]>([]);
  const [videoThumbnailFile, setVideoThumbnailFile] = useState<File[]>([]);
  const [focalPoint, setFocalPoint] = useState<CropPosition>({ x: 0.5, y: 0.5 });
  const [trialDays, setTrialDays] = useState<7 | 30>(7);
  const [termsAccepted, setTermsAccepted] = useState(false);

  /* ── Derived ─────────────────────────────────────────────── */
  const {
    save: saveDraft,
    restore: restoreDraft,
    discard: discardDraft,
  } = usePostDraftAutosave<TourismDraftData>("tourism", user?.id, !isLoading);
  const lastAutosaveSignatureRef = useRef<string>("");

  const locationValue: LocationValue = {
    province,
    city,
    town: locationTown,
    address: locationAddress,
  };
  const maxPhotos = usePlanMaxPhotos("PROMOTIONS_EVENTS");
  const maxVideos = usePlanMaxVideos("PROMOTIONS_EVENTS");
  const videoAllowed = usePlanVideoAllowed("PROMOTIONS_EVENTS");

  /* ── Init effects ────────────────────────────────────────── */
  useEffect(() => {
    void ensureCsrfTokenReady();
  }, []);

  // Stable blob URLs
  const photoPreviewUrls = useMemo(
    () => photoFiles.map((file) => URL.createObjectURL(file)),
    [photoFiles]
  );
  const previewVideoUrls = useMemo(
    () => videoFiles.map((file) => URL.createObjectURL(file)),
    [videoFiles]
  );
  const videoThumbnailUrl = useMemo(
    () => (videoThumbnailFile.length > 0 ? URL.createObjectURL(videoThumbnailFile[0]) : null),
    [videoThumbnailFile]
  );
  useEffect(
    () => () => {
      photoPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
    },
    [photoPreviewUrls]
  );
  useEffect(
    () => () => {
      previewVideoUrls.forEach((url) => URL.revokeObjectURL(url));
    },
    [previewVideoUrls]
  );
  useEffect(
    () => () => {
      if (videoThumbnailUrl) URL.revokeObjectURL(videoThumbnailUrl);
    },
    [videoThumbnailUrl]
  );
  const logoPreviewUrl = useMemo(
    () => (logoFiles.length > 0 ? URL.createObjectURL(logoFiles[0]) : null),
    [logoFiles]
  );
  useEffect(
    () => () => {
      if (logoPreviewUrl) URL.revokeObjectURL(logoPreviewUrl);
    },
    [logoPreviewUrl]
  );

  // Pre-fill location from profile
  useEffect(() => {
    if (!profile) return;
    queueMicrotask(() => {
      if (!province && profile.location_province) setProvince(profile.location_province);
      if (!city && profile.location_city && (!province || province === profile.location_province)) {
        setCity(profile.location_city);
      }
    });
  }, [profile, province, city]);

  // Reset category-specific fields when subcategory changes
  // Keep compatible answers when temporarily changing activity; the payload builder
  // includes only fields belonging to the selected activity.

  // Restore draft
  useEffect(() => {
    if (!user?.id || isLoading) return;
    void Promise.resolve(restoreDraft()).then((draft) => {
      if (!draft) return;
      const d = draft.data;
      // An explicit route (for example ?type=event) never receives answers from a
      // draft of the other listing type.
      if (requestedListingType && d.listingType && d.listingType !== requestedListingType) {
        toast({
          title: "You have another unfinished draft",
          description:
            d.listingType === "event"
              ? "Your unfinished event draft will be replaced as you fill in this form."
              : "Your unfinished stay, experience or attraction draft will be replaced as you fill in this form.",
        });
        return;
      }
      queueMicrotask(() => {
        setStep(draft.step);
        if (d.listingType && !requestedListingType)
          setListingType(d.listingType as TourismListingType);
        if (d.title) setTitle(d.title);
        if (d.description) setDescription(d.description);
        if (d.subcategory) setSubcategory(d.subcategory);
        if (d.starRating) setStarRating(d.starRating);
        if (d.numberOfRooms) setNumberOfRooms(d.numberOfRooms);
        if (d.accommodationTypes?.length) setAccommodationTypes(d.accommodationTypes);
        if (d.checkInTime) setCheckInTime(d.checkInTime);
        if (d.checkOutTime) setCheckOutTime(d.checkOutTime);
        if (d.priceRange) setPriceRange(d.priceRange);
        if (d.amenities?.length) setAmenities(d.amenities);
        if (d.mealOptions?.length) setMealOptions(d.mealOptions);
        if (d.languagesSpoken) setLanguagesSpoken(d.languagesSpoken);
        if (d.cancellationPolicy) setCancellationPolicy(d.cancellationPolicy);
        if (d.bookingUrl) setBookingUrl(d.bookingUrl);
        if (d.petsAllowed) setPetsAllowed(d.petsAllowed);
        if (d.smokingAllowed) setSmokingAllowed(d.smokingAllowed);
        if (d.treatmentTypes?.length) setTreatmentTypes(d.treatmentTypes);
        if (d.activityTypes?.length) setActivityTypes(d.activityTypes);
        if (d.tourDuration) setTourDuration(d.tourDuration);
        if (d.maxGroupSize) setMaxGroupSize(d.maxGroupSize);
        if (d.difficultyLevel) setDifficultyLevel(d.difficultyLevel);
        if (d.equipmentProvided) setEquipmentProvided(d.equipmentProvided);
        if (d.whatsIncluded) setWhatsIncluded(d.whatsIncluded);
        if (d.tourismAgeRestriction) setTourismAgeRestriction(d.tourismAgeRestriction);
        if (d.servicesOffered?.length) setServicesOffered(d.servicesOffered);
        if (d.tourismSpecializations?.length) setTourismSpecializations(d.tourismSpecializations);
        if (d.guidedTours) setGuidedTours(d.guidedTours);
        if (d.audioGuide) setAudioGuide(d.audioGuide);
        if (d.visitDuration) setVisitDuration(d.visitDuration);
        if (d.vehicleTypes?.length) setVehicleTypes(d.vehicleTypes);
        if (d.deliveryCollection) setDeliveryCollection(d.deliveryCollection);
        if (d.minDriverAge) setMinDriverAge(d.minDriverAge);
        if (d.insuranceIncluded) setInsuranceIncluded(d.insuranceIncluded);
        if (d.gpsAvailable) setGpsAvailable(d.gpsAvailable);
        if (d.hoursMonFri) setHoursMonFri(d.hoursMonFri);
        if (d.hoursSat) setHoursSat(d.hoursSat);
        if (d.hoursSun) setHoursSun(d.hoursSun);
        if (d.eventType) setEventType(d.eventType);
        if (d.startDate) setStartDate(d.startDate);
        if (d.endDate) setEndDate(d.endDate);
        if (d.priceZar) setPriceZar(d.priceZar);
        if (d.negotiable) setNegotiable(d.negotiable);
        if (d.venueName) setVenueName(d.venueName);
        if (d.venueCapacity) setVenueCapacity(d.venueCapacity);
        if (d.ticketTiers?.length) setTicketTiers(d.ticketTiers);
        if (d.ticketsUrl) setTicketsUrl(d.ticketsUrl);
        if (d.ageRestriction) setAgeRestriction(d.ageRestriction);
        if (d.dressCode) setDressCode(d.dressCode);
        if (d.lineup) setLineup(d.lineup);
        if (d.parkingAvailable) setParkingAvailable(d.parkingAvailable);
        if (d.accessibility?.length) setEventAccessibility(d.accessibility);
        if (d.foodDrinksAvailable) setFoodDrinksAvailable(d.foodDrinksAvailable);
        if (d.bringYourOwn) setBringYourOwn(d.bringYourOwn);
        if (d.province) setProvince(d.province);
        if (d.city) setCity(d.city);
        if (d.locationTown) setLocationTown(d.locationTown);
        if (d.locationAddress) setLocationAddress(d.locationAddress);
        if (d.joinMethods?.length) setJoinMethods(d.joinMethods);
        if (d.meetingPoint) setMeetingPoint(d.meetingPoint);
        if (d.pickupAreas) setPickupAreas(d.pickupAreas);
        if (d.contactMethods?.length) setContactMethods(d.contactMethods);
        if (d.phone) setPhone(d.phone);
        if (d.whatsapp) setWhatsapp(d.whatsapp);
        if (d.email) setEmail(d.email);
        if (d.website) setWebsite(d.website);
        if (d.socialFacebook) setSocialFacebook(d.socialFacebook);
        if (d.socialInstagram) setSocialInstagram(d.socialInstagram);
        if (d.socialTwitter) setSocialTwitter(d.socialTwitter);
        if (d.socialTiktok) setSocialTiktok(d.socialTiktok);
        if (d.businessId) setBusinessId(d.businessId);
        toast({ title: "Draft restored", description: "Continuing where you left off." });
      });
    });
  }, [user?.id, isLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save draft
  useEffect(() => {
    if (!user?.id || isLoading || isSubmitting || submitSucceeded) return;
    const draftData: TourismDraftData = {
      listingType,
      title,
      description,
      subcategory,
      starRating,
      numberOfRooms,
      accommodationTypes,
      checkInTime,
      checkOutTime,
      priceRange,
      amenities,
      mealOptions,
      languagesSpoken,
      cancellationPolicy,
      bookingUrl,
      petsAllowed,
      smokingAllowed,
      treatmentTypes,
      activityTypes,
      tourDuration,
      maxGroupSize,
      difficultyLevel,
      equipmentProvided,
      whatsIncluded,
      tourismAgeRestriction,
      servicesOffered,
      tourismSpecializations,
      guidedTours,
      audioGuide,
      visitDuration,
      vehicleTypes,
      deliveryCollection,
      minDriverAge,
      insuranceIncluded,
      gpsAvailable,
      eventType,
      startDate,
      endDate,
      priceZar,
      negotiable,
      venueName,
      venueCapacity,
      ticketTiers,
      ticketsUrl,
      ageRestriction,
      dressCode,
      lineup,
      parkingAvailable,
      accessibility: eventAccessibility,
      foodDrinksAvailable,
      bringYourOwn,
      province,
      city,
      locationTown,
      locationAddress,
      joinMethods,
      meetingPoint,
      pickupAreas,
      contactMethods,
      phone,
      whatsapp,
      email,
      website,
      hoursMonFri,
      hoursSat,
      hoursSun,
      socialFacebook,
      socialInstagram,
      socialTwitter,
      socialTiktok,
      businessId,
    };

    const autosaveSignature = JSON.stringify({ step, draftData });
    if (autosaveSignature === lastAutosaveSignatureRef.current) return;

    lastAutosaveSignatureRef.current = autosaveSignature;
    saveDraft(step, draftData);
    setLastSavedAt(Date.now());
  }, [
    user?.id,
    isLoading,
    isSubmitting,
    submitSucceeded,
    saveDraft,
    step,
    listingType,
    title,
    description,
    subcategory,
    starRating,
    numberOfRooms,
    accommodationTypes,
    checkInTime,
    checkOutTime,
    priceRange,
    amenities,
    mealOptions,
    languagesSpoken,
    cancellationPolicy,
    bookingUrl,
    petsAllowed,
    smokingAllowed,
    treatmentTypes,
    activityTypes,
    tourDuration,
    maxGroupSize,
    difficultyLevel,
    equipmentProvided,
    whatsIncluded,
    tourismAgeRestriction,
    servicesOffered,
    tourismSpecializations,
    guidedTours,
    audioGuide,
    visitDuration,
    vehicleTypes,
    deliveryCollection,
    minDriverAge,
    insuranceIncluded,
    gpsAvailable,
    eventType,
    startDate,
    endDate,
    priceZar,
    negotiable,
    venueName,
    venueCapacity,
    ticketTiers,
    ticketsUrl,
    ageRestriction,
    dressCode,
    lineup,
    parkingAvailable,
    eventAccessibility,
    foodDrinksAvailable,
    bringYourOwn,
    province,
    city,
    locationTown,
    locationAddress,
    joinMethods,
    meetingPoint,
    pickupAreas,
    contactMethods,
    phone,
    whatsapp,
    email,
    website,
    hoursMonFri,
    hoursSat,
    hoursSun,
    socialFacebook,
    socialInstagram,
    socialTwitter,
    socialTiktok,
    businessId,
  ]);

  /* ── Helpers ─────────────────────────────────────────────── */

  function clearErrors(...keys: string[]) {
    setFormError(null);
    if (keys.length === 0) {
      setFieldErrors({});
      return;
    }
    setFieldErrors((current) => {
      const next = { ...current };
      for (const key of keys) delete next[key];
      return next;
    });
  }

  function focusFirstError(errors: Record<string, string>, targetStep = step) {
    const orderByStep = [
      ["listingType", "title", "description", "subcategory", "eventType"],
      [
        "subcategory",
        "eventType",
        "starRating",
        "numberOfRooms",
        "bookingUrl",
        "startDate",
        "endDate",
        "priceZar",
        "venueCapacity",
        "ticketsUrl",
      ],
      [
        "province",
        "city",
        "contactMethods",
        "phone",
        "whatsapp",
        "email",
        "website",
        "socialFacebook",
        "socialInstagram",
        "socialTwitter",
        "socialTiktok",
      ],
      ["images", "videos", "termsAccepted"],
    ][targetStep];
    const firstKey = orderByStep?.find((key) => errors[key]) ?? Object.keys(errors)[0];
    const targetId = getFieldId(firstKey);
    if (!targetId) return;
    requestAnimationFrame(() => {
      const el = document.getElementById(targetId);
      el?.focus();
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  function toggleArrayItem(setter: React.Dispatch<React.SetStateAction<string[]>>, item: string) {
    setter((current) =>
      current.includes(item) ? current.filter((v) => v !== item) : [...current, item]
    );
  }

  /** Visitor access for the selected tourism activity; inactive answers are left out. */
  function buildTourismAccess() {
    const hasAddress = Boolean(locationAddress.trim());
    if (fieldGroup === "D" || fieldGroup === "F") {
      return hasAddress
        ? {
            version: 2,
            methods: ["visit", "online"],
            premises: "standalone_shop",
            publishAddress: true,
          }
        : { version: 2, methods: ["online"], publishAddress: false };
    }
    if (fieldGroup === "C") {
      const methods: string[] = [];
      if (joinMethods.includes("meeting_point") || hasAddress) methods.push("visit");
      if (joinMethods.includes("pickup")) methods.push("travel");
      return {
        version: 2,
        methods: methods.length ? methods : ["online"],
        ...(methods.includes("visit") ? { premises: "standalone_shop" } : {}),
        ...(methods.includes("travel") ? { serviceAreas: pickupAreas.trim() } : {}),
        publishAddress: hasAddress,
      };
    }
    return {
      version: 2,
      methods: ["visit"],
      premises: "standalone_shop",
      publishAddress: hasAddress,
    };
  }

  function validateStep(targetStep: number) {
    const errors = validateTourismStep(
      targetStep,
      {
        listingType,
        title,
        description,
        province,
        city,
        contactMethods,
        subcategory,
        starRating,
        numberOfRooms,
        bookingUrl,
        languagesSpoken,
        treatmentTypes,
        activityTypes,
        tourDuration,
        maxGroupSize,
        difficultyLevel,
        equipmentProvided,
        whatsIncluded,
        tourismAgeRestriction,
        servicesOffered,
        tourismSpecializations,
        guidedTours,
        audioGuide,
        visitDuration,
        vehicleTypes,
        deliveryCollection,
        minDriverAge,
        insuranceIncluded,
        gpsAvailable,
        phone,
        whatsapp,
        email,
        website,
        socialFacebook,
        socialInstagram,
        socialTwitter,
        socialTiktok,
        eventType,
        startDate,
        endDate,
        priceZar,
        venueName,
        venueCapacity,
        ticketsUrl,
        locationAddress,
        locationTown,
        joinMethods,
        meetingPoint,
        pickupAreas,
      },
      photoFiles.length,
      videoFiles.length
    );

    // Plan-based media limits
    if (targetStep === 3) {
      if (photoFiles.length > maxPhotos) {
        errors.images = `You can upload up to ${maxPhotos} photos on this plan.`;
      }
      if (!videoAllowed && videoFiles.length > 0) {
        errors.videos = "Video upload is not available on your current plan.";
      } else if (videoFiles.length > maxVideos) {
        errors.videos = `You can upload up to ${maxVideos} videos on this plan.`;
      }
      if (!termsAccepted) errors.termsAccepted = "Accept the posting terms before submitting.";
    }

    return errors;
  }

  /* ── Category details builder (shared by submit + preview) ── */

  function buildTourismCategoryDetails(): Record<string, unknown> {
    const group = TOURISM_SUBCATEGORY_FIELD_GROUPS[subcategory] ?? "";
    const categoryDetails: Record<string, unknown> = {};
    if (subcategory) categoryDetails.subcategory = subcategory;

    // Group A/B: Accommodation & Spa
    if (group === "A" || group === "B") {
      if (starRating) categoryDetails.star_rating = Number(starRating);
      if (numberOfRooms) categoryDetails.number_of_rooms = Number(numberOfRooms);
      if (accommodationTypes.length) categoryDetails.accommodation_types = accommodationTypes;
      if (checkInTime) categoryDetails.check_in_time = checkInTime;
      if (checkOutTime) categoryDetails.check_out_time = checkOutTime;
      if (mealOptions.length) categoryDetails.meal_options = mealOptions;
      categoryDetails.pets_allowed = petsAllowed || undefined;
      categoryDetails.smoking_allowed = smokingAllowed || undefined;
    }
    // Group B extra: Spa
    if (group === "B") {
      if (treatmentTypes.length) categoryDetails.treatment_types = treatmentTypes;
    }
    // Group C: Tours & Safaris
    if (group === "C") {
      if (activityTypes.length) categoryDetails.activity_types = activityTypes;
      if (tourDuration) categoryDetails.tour_duration = tourDuration;
      if (maxGroupSize) categoryDetails.max_group_size = Number(maxGroupSize);
      if (difficultyLevel) categoryDetails.difficulty_level = difficultyLevel;
      categoryDetails.equipment_provided = equipmentProvided || undefined;
      if (whatsIncluded) categoryDetails.whats_included = whatsIncluded;
      if (tourismAgeRestriction) categoryDetails.age_restriction = tourismAgeRestriction;
    }
    // Group D: Travel Agency
    if (group === "D") {
      if (servicesOffered.length) categoryDetails.services_offered = servicesOffered;
      if (tourismSpecializations.length) categoryDetails.specializations = tourismSpecializations;
    }
    // Group E: Attractions
    if (group === "E") {
      categoryDetails.guided_tours = guidedTours || undefined;
      categoryDetails.audio_guide = audioGuide || undefined;
      if (visitDuration) categoryDetails.visit_duration = visitDuration;
      if (tourismAgeRestriction) categoryDetails.age_restriction = tourismAgeRestriction;
    }
    // Group F: Car Rental
    if (group === "F") {
      if (vehicleTypes.length) categoryDetails.vehicle_types = vehicleTypes;
      categoryDetails.delivery_collection = deliveryCollection || undefined;
      if (minDriverAge) categoryDetails.min_driver_age = Number(minDriverAge);
      categoryDetails.insurance_included = insuranceIncluded || undefined;
      categoryDetails.gps_available = gpsAvailable || undefined;
    }
    // Shared fields
    if (priceRange) categoryDetails.price_range = priceRange;
    if (amenities.length && group !== "D" && group !== "F") {
      categoryDetails.amenities = amenities;
    }
    if (languagesSpoken) categoryDetails.languages_spoken = languagesSpoken;
    if (cancellationPolicy) categoryDetails.cancellation_policy = cancellationPolicy;
    if (bookingUrl) categoryDetails.booking_url = normalizeUserEnteredUrl(bookingUrl);

    // SA tourism additions
    if ((group === "A" || group === "B") && tgcsaGrading)
      categoryDetails.tgcsa_grading = tgcsaGrading;
    if ((group === "A" || group === "B") && minimumStayNights)
      categoryDetails.minimum_stay_nights = Number(minimumStayNights);
    if ((group === "A" || group === "B") && childPolicy) categoryDetails.child_policy = childPolicy;
    if ((group === "A" || group === "B") && seasonalPricing)
      categoryDetails.seasonal_pricing = seasonalPricing;
    if (nearbyAttractions) categoryDetails.nearby_attractions = nearbyAttractions;

    return categoryDetails;
  }

  /* ── Submit ──────────────────────────────────────────────── */

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submissionInFlightRef.current) return;
    const stepErrors = [0, 1, 2, 3].map((index) => validateStep(index));
    const firstInvalidStep = stepErrors.findIndex((e) => Object.keys(e).length > 0);
    if (firstInvalidStep !== -1) {
      setStep(firstInvalidStep);
      setFieldErrors(stepErrors[firstInvalidStep]);
      const count = Object.keys(stepErrors[firstInvalidStep]).length;
      setFormError(
        `Please fix ${count} field${count > 1 ? "s" : ""} on Step ${firstInvalidStep + 1} \u2014 ${STEPS[firstInvalidStep].label}.`
      );
      focusFirstError(stepErrors[firstInvalidStep], firstInvalidStep);
      return;
    }

    clearErrors();
    submissionInFlightRef.current = true;
    setIsSubmitting(true);
    setSubmitProgress("Checking upload service...");
    setUploadStatuses({
      logo: logoFiles.length > 0 ? "uploading" : "skipped",
      photos: photoFiles.length > 0 ? "uploading" : "skipped",
      videos: videoFiles.length > 0 ? "uploading" : "skipped",
      saving: "idle",
    });

    try {
      const csrfToken = await ensureCsrfTokenReady();
      if (!csrfToken) {
        setFormError("Security check failed. Please refresh the page and try again.");
        return;
      }
      // Best-effort preflight only; do not make submit wait through slow-network
      // retries before the real upload starts.
      void checkUploadServiceReachable().catch(() => undefined);

      setSubmitProgress("Uploading media...");

      const uploadArea = listingType === "tourism_business" ? "business" : "promotion";
      const primaryMediaFile = videoFiles[0] ?? photoFiles[0] ?? null;
      const mediaDimensionsPromise = primaryMediaFile
        ? readMediaDimensions(primaryMediaFile)
        : Promise.resolve(null);

      const [imageUrls, videoUrls, uploadedVideoThumbnailUrl, uploadedLogoUrl] =
        await settleMediaUploads([
          uploadRequiredPromotionMedia({
            files: photoFiles,
            area: uploadArea,
            field: "images",
          }).then((urls) => {
            if (photoFiles.length > 0) {
              setUploadStatuses((current) => ({ ...current, photos: "done" }));
            }
            return urls;
          }),
          uploadPromotionVideoFiles({
            files: videoFiles,
            area: uploadArea,
          }).then((urls) => {
            if (videoFiles.length > 0) {
              setUploadStatuses((current) => ({ ...current, videos: "done" }));
            }
            return urls;
          }),
          uploadRequiredPromotionMedia({
            files: videoThumbnailFile,
            area: uploadArea,
            field: "video_thumbnail",
          }).then((urls) => urls[0]),
          uploadRequiredPromotionMedia({
            files: logoFiles,
            area: listingType === "tourism_business" ? "business_logo" : "promotion",
            field: "logo_url",
          }).then((urls) => {
            if (logoFiles.length > 0) {
              setUploadStatuses((current) => ({ ...current, logo: "done" }));
            }
            return urls[0];
          }),
        ]);

      const mediaDimensions = await mediaDimensionsPromise;

      if (listingType === "tourism_business") {
        setSubmitProgress("Saving tourism business...");
        setUploadStatuses((c) => ({ ...c, saving: "uploading" }));

        const categoryDetails = buildTourismCategoryDetails();

        const operatingHours: Record<string, string> = {};
        // Display components read the Mon_Fri/Sat/Sun keys (same as the
        // business form) — do not use the legacy weekday/saturday/sunday keys.
        if (hoursMonFri) operatingHours.Mon_Fri = hoursMonFri;
        if (hoursSat) operatingHours.Sat = hoursSat;
        if (hoursSun) operatingHours.Sun = hoursSun;

        // Tourism businesses use the business API with category "tourism_hospitality"
        const slug =
          title
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")
            .slice(0, 48) +
          "-" +
          Date.now().toString(36);

        const socialLinks = Object.fromEntries(
          Object.entries({
            facebook: socialFacebook,
            instagram: socialInstagram,
            twitter: socialTwitter,
            tiktok: socialTiktok,
          })
            .map(([key, value]) => [key, normalizeUserEnteredUrl(value)] as const)
            .filter(([, value]) => value.length > 0)
        );

        const body = {
          business_type: "standalone_shop" as const,
          business_name: title.trim(),
          slug,
          description: description.trim(),
          category: "tourism_hospitality",
          subcategory: subcategory || undefined,
          logo_url: uploadedLogoUrl || undefined,
          cover_photo: imageUrls[0] || undefined,
          cover_video: videoUrls[0] || undefined,
          video_thumbnail: uploadedVideoThumbnailUrl,
          gallery_photos: imageUrls,
          media_width: mediaDimensions?.width,
          media_height: mediaDimensions?.height,
          focal_x: focalPoint.x,
          focal_y: focalPoint.y,
          location_province: province,
          location_city: city,
          location_town: locationTown || undefined,
          location_address: locationAddress || undefined,
          phone: phone || undefined,
          whatsapp: whatsapp || undefined,
          email: email || undefined,
          website: website || undefined,
          social_links: Object.keys(socialLinks).length > 0 ? socialLinks : undefined,
          operating_hours: Object.keys(operatingHours).length > 0 ? operatingHours : undefined,
          category_details: {
            ...categoryDetails,
            ...(fieldGroup === "C" && joinMethods.includes("meeting_point")
              ? { meeting_point: meetingPoint.trim() }
              : {}),
            customer_access: buildTourismAccess(),
          },
          contact_methods: contactMethods,
          termsAccepted,

          trialDays,
        };

        const res = await fetch("/api/businesses", {
          method: "POST",
          headers: withCsrfHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify(body),
        });
        const payload = await res.json().catch(() => null);

        if (!res.ok) {
          // Phone-gate: server returns redirectUrl for phone verification
          if (
            res.status === 403 &&
            payload &&
            typeof payload === "object" &&
            typeof (payload as Record<string, unknown>).redirectUrl === "string"
          ) {
            router.push((payload as Record<string, unknown>).redirectUrl as string);
            return;
          }

          // Plan-limit: show a descriptive upgrade message
          if (
            res.status === 403 &&
            payload &&
            typeof payload === "object" &&
            typeof (payload as Record<string, unknown>).reason === "string"
          ) {
            setFormError((payload as Record<string, unknown>).reason as string);
            return;
          }

          if (
            res.status === 422 &&
            payload &&
            typeof payload === "object" &&
            typeof (payload as Record<string, unknown>).error === "string"
          ) {
            const message = ((payload as Record<string, unknown>).error as string).trim();
            const lower = message.toLowerCase();
            if (lower.includes("photo")) {
              const errors = { images: message };
              setStep(3);
              setFieldErrors(errors);
              setFormError(`Please fix 1 field on Step 4 — ${STEPS[3].label}.`);
              focusFirstError(errors, 3);
              return;
            }
            if (lower.includes("video")) {
              const errors = { videos: message };
              setStep(3);
              setFieldErrors(errors);
              setFormError(`Please fix 1 field on Step 4 — ${STEPS[3].label}.`);
              focusFirstError(errors, 3);
              return;
            }
          }

          const normalized = normalizeCreatePostError(payload, "Failed to create tourism listing.");
          const normalizedFieldErrors = normalizeTourismFieldErrors(normalized.fieldErrors);
          const targetStep = getStepForServerErrors(normalizedFieldErrors);
          const count = Object.keys(normalizedFieldErrors).length;
          if (count > 0) {
            setStep(targetStep);
          }
          setFieldErrors(normalizedFieldErrors);
          setFormError(
            count > 0
              ? `Please fix ${count} field${count > 1 ? "s" : ""} on Step ${targetStep + 1} \u2014 ${STEPS[targetStep].label}.`
              : normalized.formError
          );
          if (count > 0) {
            focusFirstError(normalizedFieldErrors, targetStep);
          }
          return;
        }

        toast({ title: "Tourism listing submitted for review.", variant: "success" });
      } else {
        /* ── Event submission ── */
        setSubmitProgress("Saving event...");
        setUploadStatuses((c) => ({ ...c, saving: "uploading" }));

        const eventDetails: Record<string, unknown> = {};
        if (eventType) eventDetails.event_type = eventType;
        if (venueName) eventDetails.venue_name = venueName;
        if (venueCapacity) eventDetails.venue_capacity = Number(venueCapacity);
        if (Number(priceZar) > 0 && ticketTiers.length) eventDetails.ticket_tiers = ticketTiers;
        if (Number(priceZar) > 0 && ticketsUrl) eventDetails.tickets_url = ticketsUrl;
        if (ageRestriction) eventDetails.age_restriction = ageRestriction;
        if (dressCode) eventDetails.dress_code = dressCode;
        if (lineup) eventDetails.lineup = lineup;
        eventDetails.parking_available = parkingAvailable || undefined;
        if (eventAccessibility.length) eventDetails.accessibility = eventAccessibility;
        eventDetails.food_drinks_available = foodDrinksAvailable || undefined;
        if (bringYourOwn) eventDetails.bring_your_own = bringYourOwn;

        // SA event additions
        if (recurring) eventDetails.recurring = recurring;
        if (rainPolicy) eventDetails.rain_policy = rainPolicy;
        if (earlyBirdDeadline) eventDetails.early_bird_deadline = earlyBirdDeadline;
        if (groupDiscountAvailable) eventDetails.group_discount_available = groupDiscountAvailable;

        const body = {
          title: title.trim(),
          description: description.trim(),
          form_version: 2,
          promotion_type: "event" as const,
          category_key: "tourism_hospitality" as const,
          price_zar: priceZar ? parseFloat(priceZar) : undefined,
          negotiable,
          province,
          city,
          location_town: locationTown || undefined,
          location_address: locationAddress || undefined,
          contact_methods: contactMethods,
          images: imageUrls,
          videos: videoUrls,
          video_thumbnail: uploadedVideoThumbnailUrl,
          logo_url: uploadedLogoUrl || undefined,
          media_width: mediaDimensions?.width,
          media_height: mediaDimensions?.height,
          focal_x: focalPoint.x,
          focal_y: focalPoint.y,
          start_date: startDate ? eventTimeToIso(startDate) : undefined,
          end_date: endDate ? eventTimeToIso(endDate, true) : undefined,
          business_id: businessId || undefined,
          event_details: Object.keys(eventDetails).length > 0 ? eventDetails : undefined,
          termsAccepted,

          trialDays,
        };

        const res = await fetch("/api/promotions", {
          method: "POST",
          headers: withCsrfHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify(body),
        });
        const payload = await res.json().catch(() => null);

        if (!res.ok) {
          // Phone-gate: server returns redirectUrl for phone verification
          if (
            res.status === 403 &&
            payload &&
            typeof payload === "object" &&
            typeof (payload as Record<string, unknown>).redirectUrl === "string"
          ) {
            router.push((payload as Record<string, unknown>).redirectUrl as string);
            return;
          }

          // Plan-limit: show a descriptive upgrade message
          if (
            res.status === 403 &&
            payload &&
            typeof payload === "object" &&
            typeof (payload as Record<string, unknown>).reason === "string"
          ) {
            setFormError((payload as Record<string, unknown>).reason as string);
            return;
          }

          if (
            res.status === 422 &&
            payload &&
            typeof payload === "object" &&
            typeof (payload as Record<string, unknown>).error === "string"
          ) {
            const message = ((payload as Record<string, unknown>).error as string).trim();
            const lower = message.toLowerCase();
            if (lower.includes("photo")) {
              const errors = { images: message };
              setStep(3);
              setFieldErrors(errors);
              setFormError(`Please fix 1 field on Step 4 — ${STEPS[3].label}.`);
              focusFirstError(errors, 3);
              return;
            }
            if (lower.includes("video")) {
              const errors = { videos: message };
              setStep(3);
              setFieldErrors(errors);
              setFormError(`Please fix 1 field on Step 4 — ${STEPS[3].label}.`);
              focusFirstError(errors, 3);
              return;
            }
          }

          const normalized = normalizeCreatePostError(payload, "Failed to create event.");
          const normalizedFieldErrors = normalizeTourismFieldErrors(normalized.fieldErrors);
          const targetStep = getStepForServerErrors(normalizedFieldErrors);
          const count = Object.keys(normalizedFieldErrors).length;
          if (count > 0) {
            setStep(targetStep);
          }
          setFieldErrors(normalizedFieldErrors);
          setFormError(
            count > 0
              ? `Please fix ${count} field${count > 1 ? "s" : ""} on Step ${targetStep + 1} \u2014 ${STEPS[targetStep].label}.`
              : normalized.formError
          );
          if (count > 0) {
            focusFirstError(normalizedFieldErrors, targetStep);
          }
          return;
        }

        toast({ title: "Event submitted for review.", variant: "success" });
      }

      setSubmitSucceeded(true);
      setUploadStatuses((c) => ({ ...c, saving: "done" }));
      discardDraft();
      router.push("/dashboard/listings?area=PROMOTIONS_EVENTS&created=tourism");
    } catch (error: unknown) {
      const uploadFailure = getPromotionMediaUploadErrorState(error);
      if (uploadFailure) {
        const normalizedFieldErrors = normalizeTourismFieldErrors(uploadFailure.fieldErrors);
        setStep(3);
        setFieldErrors((current) => ({ ...current, ...normalizedFieldErrors }));
        setFormError(uploadFailure.formError);
        focusFirstError(normalizedFieldErrors, 3);
        return;
      }

      setFormError(normalizeCreatePostRuntimeError(error, "Something went wrong."));
    } finally {
      submissionInFlightRef.current = false;
      setIsSubmitting(false);
      setSubmitProgress(null);
      setUploadStatuses({ logo: "idle", photos: "idle", videos: "idle", saving: "idle" });
    }
  }

  function handleDiscardDraft() {
    discardDraft();
    setStep(0);
    // Discarding keeps the route the owner chose (for example ?type=event).
    setListingType(requestedListingType ?? "tourism_business");
    setTitle("");
    setDescription("");
    setSubcategory("");
    setStarRating("");
    setNumberOfRooms("");
    setAccommodationTypes([]);
    setCheckInTime("");
    setCheckOutTime("");
    setPriceRange("");
    setAmenities([]);
    setMealOptions([]);
    setLanguagesSpoken("");
    setCancellationPolicy("");
    setBookingUrl("");
    setPetsAllowed(false);
    setSmokingAllowed(false);
    setHoursMonFri("");
    setHoursSat("");
    setHoursSun("");
    setEventType("");
    setStartDate("");
    setEndDate("");
    setPriceZar("");
    setNegotiable(false);
    setVenueName("");
    setVenueCapacity("");
    setTicketTiers([]);
    setTicketsUrl("");
    setAgeRestriction("");
    setDressCode("");
    setLineup("");
    setParkingAvailable(false);
    setEventAccessibility([]);
    setFoodDrinksAvailable(false);
    setBringYourOwn("");
    setProvince(profile?.location_province ?? "");
    setCity(profile?.location_city ?? "");
    setLocationTown("");
    setLocationAddress("");
    setContactMethods(["call"]);
    setPhone("");
    setWhatsapp("");
    setEmail("");
    setWebsite("");
    setSocialFacebook("");
    setSocialInstagram("");
    setSocialTwitter("");
    setSocialTiktok("");
    setBusinessId("");
    setPhotoFiles([]);
    setVideoFiles([]);
    setVideoThumbnailFile([]);
    setLogoFiles([]);
    setFocalPoint({ x: 0.5, y: 0.5 });
    setFieldErrors({});
    setFormError(null);
    setLastSavedAt(null);
    toast({ title: "Draft discarded", description: "You can start fresh.", variant: "success" });
  }

  function resetTourismSpecificFields() {
    setSubcategory("");
    setStarRating("");
    setNumberOfRooms("");
    setAccommodationTypes([]);
    setCheckInTime("");
    setCheckOutTime("");
    setPriceRange("");
    setAmenities([]);
    setMealOptions([]);
    setLanguagesSpoken("");
    setCancellationPolicy("");
    setBookingUrl("");
    setPetsAllowed(false);
    setSmokingAllowed(false);
    setHoursMonFri("");
    setHoursSat("");
    setHoursSun("");
    setLogoFiles([]);
  }

  function renderPreview() {
    if (listingType === "tourism_business") {
      if (photoFiles.length === 0 && videoFiles.length === 0 && logoFiles.length === 0) {
        return null;
      }
    } else if (photoFiles.length === 0 && videoFiles.length === 0) {
      return null;
    }

    if (listingType === "tourism_business") {
      const socialLinks = Object.fromEntries(
        Object.entries({
          facebook: socialFacebook,
          instagram: socialInstagram,
          twitter: socialTwitter,
          tiktok: socialTiktok,
        }).filter(([, v]) => v.trim().length > 0)
      );
      const operatingHours: Record<string, string> = {};
      if (hoursMonFri) operatingHours.Mon_Fri = hoursMonFri;
      if (hoursSat) operatingHours.Sat = hoursSat;
      if (hoursSun) operatingHours.Sun = hoursSun;

      // Mirror what the submit body stores so the preview shows the
      // category-specific details exactly as the live listing will.
      const categoryDetails = buildTourismCategoryDetails();

      const previewBusiness: BusinessDetailRecord = {
        id: "preview-tourism",
        owner_id: "preview-owner",
        business_name: title || "Your tourism listing",
        description: description || "Your description will appear here.",
        status: "preview",
        business_type: "standalone_shop",
        category: "tourism_hospitality",
        subcategory: subcategory || null,
        category_details: Object.keys(categoryDetails).length > 0 ? categoryDetails : null,
        cover_photo: photoPreviewUrls[0] || null,
        logo_url: logoPreviewUrl,
        cover_video: previewVideoUrls[0] || null,
        video_thumbnail: videoThumbnailUrl,
        gallery_photos: photoPreviewUrls,
        social_links: Object.keys(socialLinks).length > 0 ? socialLinks : null,
        operating_hours: Object.keys(operatingHours).length > 0 ? operatingHours : null,
        services_offered: null,
        payment_methods_accepted: null,
        delivery_options: null,
        service_areas: null,
        location_city: city || null,
        location_province: province || null,
        location_town: locationTown || null,
        location_address: locationAddress || null,
        phone: phone || null,
        whatsapp: whatsapp || null,
        email: email || null,
        website: website || null,
        store_number: null,
        map_directions: null,
        business_details: {
          type: "standalone_shop" as const,
          street_address: locationAddress || "",
          suburb: locationTown || "",
        },
        layout_template: null,
      };

      return (
        <div className="rounded-xl border border-dashed border-brand-green/30 bg-brand-green/5 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Eye className="h-4 w-4" />
            Listing preview
          </div>
          <BusinessLayoutRouter
            business={previewBusiness}
            trustLevel={null}
            ownerProfile={{ display_name: "You" }}
            promotions={[]}
            showPromotions={false}
            showPublicActions={false}
            layoutMode="review"
          />
        </div>
      );
    }

    // Event preview
    const numericPrice = priceZar ? parseFloat(priceZar) : NaN;
    const priceCents =
      !Number.isNaN(numericPrice) && numericPrice > 0 ? Math.round(numericPrice * 100) : null;
    const cardMediaUrl = previewVideoUrls[0] || photoPreviewUrls[0];
    const cardPosterUrl = videoThumbnailUrl || photoPreviewUrls[0] || undefined;

    // Mirror the submit body so the preview shows event details exactly as
    // the live listing will.
    const previewEventDetails: Record<string, unknown> = {};
    if (eventType) previewEventDetails.event_type = eventType;
    if (venueName) previewEventDetails.venue_name = venueName;
    if (venueCapacity) previewEventDetails.venue_capacity = Number(venueCapacity);
    if (Number(priceZar) > 0 && ticketTiers.length) previewEventDetails.ticket_tiers = ticketTiers;
    if (Number(priceZar) > 0 && ticketsUrl) previewEventDetails.tickets_url = ticketsUrl;
    if (ageRestriction) previewEventDetails.age_restriction = ageRestriction;
    if (dressCode) previewEventDetails.dress_code = dressCode;
    if (lineup) previewEventDetails.lineup = lineup;
    previewEventDetails.parking_available = parkingAvailable;
    if (eventAccessibility.length) previewEventDetails.accessibility = eventAccessibility;
    previewEventDetails.food_drinks_available = foodDrinksAvailable;
    if (bringYourOwn) previewEventDetails.bring_your_own = bringYourOwn;
    if (recurring) previewEventDetails.recurring = recurring;
    if (rainPolicy) previewEventDetails.rain_policy = rainPolicy;
    if (earlyBirdDeadline) previewEventDetails.early_bird_deadline = earlyBirdDeadline;
    if (groupDiscountAvailable)
      previewEventDetails.group_discount_available = groupDiscountAvailable;

    const previewPromotion: PromotionDetailRecord = {
      id: "preview-event",
      owner_id: "preview-owner",
      business_id: businessId || null,
      title: title || "Your event title",
      description: description || "Your event description will appear here.",
      promotion_type: "event",
      category: null,
      category_key: "tourism_hospitality",
      photos: photoPreviewUrls,
      videos: previewVideoUrls.length > 0 ? previewVideoUrls : null,
      video_thumbnail: videoThumbnailUrl,
      logo_url: logoPreviewUrl || null,
      price_cents: priceCents,
      price_negotiable: negotiable,
      location_province: province || "Province",
      location_city: city || "City",
      location_town: locationTown || null,
      location_address: locationAddress || null,
      contact_methods: contactMethods,
      start_date: startDate ? eventTimeToIso(startDate) : null,
      end_date: endDate ? eventTimeToIso(endDate, true) : null,
      boost_until: null,
      featured_until: null,
      view_count: null,
      created_at: new Date().toISOString(),
      event_details:
        Object.keys(previewEventDetails).length > 0
          ? (previewEventDetails as PromotionDetailRecord["event_details"])
          : null,
    };

    const previewAdvertiser: PromotionAdvertiserRecord = {
      display_name: "You",
      phone: null,
      masked_phone_public: null,
    };

    return (
      <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-4">
        <h3 className="mb-3 flex items-center gap-2 text-base font-semibold text-foreground">
          <Eye className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Event preview
        </h3>

        <div className="mb-4 max-w-[264px]">
          <PromotionCard
            id="preview-event"
            title={title || "Your event title"}
            price={priceCents}
            negotiable={negotiable}
            imageUrl={cardMediaUrl || undefined}
            posterUrl={cardPosterUrl}
            isVideo={previewVideoUrls.length > 0}
            logoUrl={logoPreviewUrl || undefined}
            province={province || "Province"}
            city={city || "City"}
            promotionType="event"
            createdAt={new Date().toISOString()}
            startDate={startDate || null}
            endDate={endDate || null}
            focalX={focalPoint.x}
            focalY={focalPoint.y}
          />
        </div>

        <PromotionDetailContent
          promotion={previewPromotion}
          advertiserProfile={previewAdvertiser}
          linkedBusiness={null}
          showContactActions={false}
          showContactSummary={false}
          trackView={false}
          layoutMode="review"
        />
      </div>
    );
  }

  /* ── Render ──────────────────────────────────────────────── */

  const fieldGroup = TOURISM_SUBCATEGORY_FIELD_GROUPS[subcategory] ?? "";

  return (
    <div className="flex min-h-screen flex-col">
      <Header isAuthenticated />
      <main id="main-content" className="flex-1">
        <div className="container-page py-6">
          <PlanGate
            area="PROMOTIONS_EVENTS"
            onTrialSelected={setTrialDays}
            freePosting={listingType === "event"}
            onChooseFreeEvent={() => {
              resetTourismSpecificFields();
              setListingType("event");
              clearErrors("listingType");
            }}
          >
            <form noValidate onSubmit={handleSubmit}>
              <PostFormScaffold
                title={
                  listingType === "tourism_business"
                    ? "List a stay or experience"
                    : "Create an event"
                }
                description={
                  listingType === "tourism_business"
                    ? "Stays, tours, attractions and experiences."
                    : "Festivals, gigs, markets and community events."
                }
                breadcrumbs={[
                  { label: "Dashboard", href: "/dashboard" },
                  { label: "Create Post", href: "/post/create" },
                  { label: "Tourism & Events" },
                ]}
                badgeLabel="Tourism & Events"
                area="tourism"
                guideDescription="Describe what visitors can expect. Use the question-mark help to understand a choice."
                steps={STEPS.map((s, i) =>
                  listingType === "event"
                    ? {
                        ...s,
                        label: [
                          "About your event",
                          "When, where & entry",
                          "Contact & visitor information",
                          "Photos & review",
                        ][i],
                      }
                    : s
                )}
                onStepChange={setStep}
                onFieldError={(key) => focusFirstError({ [key]: fieldErrors[key] })}
                currentStep={step}
                error={formError}
                fieldErrors={fieldErrors}
                fieldLabels={FIELD_LABELS}
                errorStepLabel={
                  formError ? `Step ${step + 1} \u2014 ${STEPS[step].label}` : undefined
                }
                stepHasErrors={STEPS.map((_, i) =>
                  // Only flag steps after a validation attempt has surfaced
                  // errors — never show red on a pristine form.
                  Object.keys(fieldErrors).some((key) => getStepForFieldKey(key) === i)
                )}
                onRetry={
                  formError && !isSubmitting
                    ? () => handleSubmit(new Event("submit") as unknown as React.FormEvent)
                    : undefined
                }
                footer={
                  <>
                    {user?.id && !isSubmitting && (
                      <PostDraftStatus lastSavedAt={lastSavedAt} onDiscard={handleDiscardDraft} />
                    )}
                    <UploadProgressPanel
                      visible={isSubmitting}
                      slots={[
                        {
                          key: "logo",
                          label: "Uploading logo...",
                          doneLabel: "Logo uploaded",
                          status: logoFiles.length > 0 ? uploadStatuses.logo : "skipped",
                        },
                        {
                          key: "photos",
                          label: "Uploading photos...",
                          doneLabel: "Photos uploaded",
                          status: photoFiles.length > 0 ? uploadStatuses.photos : "skipped",
                        },
                        {
                          key: "videos",
                          label: "Preparing and verifying video...",
                          doneLabel: "Video verified",
                          status: videoFiles.length > 0 ? uploadStatuses.videos : "skipped",
                        },
                        {
                          key: "saving",
                          label: "Saving listing...",
                          doneLabel: "Listing saved",
                          status: uploadStatuses.saving,
                        },
                      ]}
                    />

                    <PostFormFooter
                      currentStep={step}
                      totalSteps={STEPS.length}
                      onBack={() => {
                        clearErrors();
                        setStep((s) => Math.max(s - 1, 0));
                        requestAnimationFrame(() => {
                          document
                            .getElementById("post-form-top")
                            ?.scrollIntoView({ behavior: "smooth", block: "start" });
                        });
                      }}
                      onNext={() => {
                        for (let i = 0; i <= step; i++) {
                          const errors = validateStep(i);
                          if (Object.keys(errors).length > 0) {
                            if (i !== step) {
                              setStep(i);
                            }
                            setFieldErrors((c) => ({ ...c, ...errors }));
                            const count = Object.keys(errors).length;
                            setFormError(
                              `Please fix ${count} field${count > 1 ? "s" : ""} on Step ${i + 1} \u2014 ${STEPS[i].label}.`
                            );
                            focusFirstError(errors, i);
                            return;
                          }
                        }
                        clearErrors();
                        setStep((s) => Math.min(s + 1, STEPS.length - 1));
                        requestAnimationFrame(() => {
                          document
                            .getElementById("post-form-top")
                            ?.scrollIntoView({ behavior: "smooth", block: "start" });
                        });
                      }}
                      submitDisabled={isSubmitting}
                      isSubmitting={isSubmitting}
                      submittingLabel={submitProgress || "Submitting..."}
                    />
                  </>
                }
              >
                {/* ── Step 0: Type & Basics ── */}
                {step === 0 && (
                  <div className="space-y-6">
                    {/* Title */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="title">
                          {listingType === "event" ? "Event name" : "Business Name"} *
                        </Label>
                        <span className="text-xs text-muted-foreground">{title.length}/120</span>
                      </div>
                      <Input
                        id="title"
                        value={title}
                        onChange={(e) => {
                          setTitle(e.target.value.slice(0, 120));
                          clearErrors("title");
                        }}
                        placeholder={
                          listingType === "event"
                            ? "e.g. Cape Town Jazz Festival 2026"
                            : "e.g. Kruger Sunset Lodge"
                        }
                        aria-invalid={!!fieldErrors.title}
                      />
                      {fieldErrors.title && (
                        <p className="inline-form-error">{fieldErrors.title}</p>
                      )}
                    </div>

                    {/* Description */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="description">Description *</Label>
                        <span className="text-xs text-muted-foreground">
                          {description.length}/5000
                        </span>
                      </div>
                      <Textarea
                        id="description"
                        value={description}
                        onChange={(e) => {
                          setDescription(e.target.value.slice(0, 5000));
                          clearErrors("description");
                        }}
                        rows={5}
                        placeholder={
                          listingType === "event"
                            ? "Tell people about the event — what to expect, who should attend, highlights..."
                            : "Describe your accommodation, services, what makes it special..."
                        }
                        aria-invalid={!!fieldErrors.description}
                      />
                      {fieldErrors.description && (
                        <p className="inline-form-error">{fieldErrors.description}</p>
                      )}
                    </div>

                    {/* Subcategory (tourism business) */}
                    {listingType === "tourism_business" && (
                      <div className="space-y-2">
                        <Label htmlFor="subcategory">Tourism category *</Label>
                        <PostSelect
                          id="subcategory"
                          value={subcategory}
                          onChange={(e) => {
                            setSubcategory(e.target.value);
                            clearErrors("subcategory");
                          }}
                          className={SELECT_CLASS}
                          aria-label="Tourism category"
                        >
                          <option value="">Select a category...</option>
                          {[
                            [
                              "Accommodation",
                              [
                                "hotel_resort",
                                "guest_house_bnb",
                                "lodge_game_lodge",
                                "backpackers_hostel",
                                "self_catering",
                                "campground_caravan",
                              ],
                            ],
                            [
                              "Tours & Experiences",
                              ["tour_operator", "safari_wildlife", "adventure_activities"],
                            ],
                            ["Attractions", ["cultural_heritage", "tourist_attraction"]],
                            ["Travel Services", ["travel_agency", "car_rental_tourism"]],
                            ["Wellness Retreats", ["spa_wellness_retreat"]],
                          ].map(([label, values]) => (
                            <optgroup key={label as string} label={label as string}>
                              {TOURISM_SUBCATEGORIES.filter((s) =>
                                (values as string[]).includes(s.value)
                              ).map((s) => (
                                <option key={s.value} value={s.value}>
                                  {s.label}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </PostSelect>
                        {fieldErrors.subcategory && (
                          <p className="inline-form-error">{fieldErrors.subcategory}</p>
                        )}
                      </div>
                    )}

                    {/* Event type (event) */}
                    {listingType === "event" && (
                      <div className="space-y-2">
                        <Label htmlFor="eventType">Event category *</Label>
                        <PostSelect
                          id="eventType"
                          value={eventType}
                          onChange={(e) => {
                            setEventType(e.target.value);
                            clearErrors("eventType");
                          }}
                          className={SELECT_CLASS}
                          aria-label="Event category"
                        >
                          <option value="">Select an event type...</option>
                          {EVENT_TYPES.map((t) => (
                            <option key={t.value} value={t.value}>
                              {t.label}
                            </option>
                          ))}
                        </PostSelect>
                        {fieldErrors.eventType && (
                          <p className="inline-form-error">{fieldErrors.eventType}</p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* ── Step 1: Details ── */}
                {step === 1 && (
                  <div className="space-y-6">
                    {listingType === "tourism_business" ? (
                      <>
                        {!fieldGroup && (
                          <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                            Go back to Step 1 to choose a tourism category — the matching detail
                            fields will appear here.
                          </p>
                        )}

                        {/* ── Group A / B: Accommodation & Spa ── */}
                        {(fieldGroup === "A" || fieldGroup === "B") && (
                          <>
                            {/* Star rating */}
                            <div className="space-y-2">
                              <Label htmlFor="starRating">Official star grading</Label>
                              <p className="text-xs text-muted-foreground">
                                Official grading (1–5 stars), if applicable.
                              </p>
                              <PostSelect
                                id="starRating"
                                value={starRating}
                                onChange={(e) => setStarRating(e.target.value)}
                                className={SELECT_CLASS}
                                aria-label="Official star grading"
                              >
                                <option value="">Not rated</option>
                                {[1, 2, 3, 4, 5].map((n) => (
                                  <option key={n} value={String(n)}>
                                    {"★".repeat(n)} {n} Star{n > 1 ? "s" : ""}
                                  </option>
                                ))}
                              </PostSelect>
                              {fieldErrors.starRating && (
                                <p className="inline-form-error">{fieldErrors.starRating}</p>
                              )}
                            </div>

                            {/* Number of rooms */}
                            <div className="space-y-2">
                              <Label htmlFor="numberOfRooms">Number of Rooms / Units</Label>
                              <p className="text-xs text-muted-foreground">
                                Total available rooms or self-catering units.
                              </p>
                              <Input
                                id="numberOfRooms"
                                type="number"
                                min={0}
                                value={numberOfRooms}
                                onChange={(e) => setNumberOfRooms(e.target.value)}
                                placeholder="e.g. 24"
                              />
                              {fieldErrors.numberOfRooms && (
                                <p className="inline-form-error">{fieldErrors.numberOfRooms}</p>
                              )}
                            </div>

                            {/* Accommodation types */}
                            <fieldset className="space-y-2">
                              <legend className="text-sm font-medium">Accommodation Types</legend>
                              <p className="text-xs text-muted-foreground">
                                Select all accommodation styles you offer.
                              </p>
                              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                                {TOURISM_ACCOMMODATION_TYPES.map((type) => (
                                  <label key={type} className="flex items-center gap-2 text-sm">
                                    <input
                                      type="checkbox"
                                      checked={accommodationTypes.includes(type)}
                                      onChange={() => toggleArrayItem(setAccommodationTypes, type)}
                                      className="rounded border-gray-300"
                                    />
                                    {type}
                                  </label>
                                ))}
                              </div>
                            </fieldset>

                            {/* Check-in / Check-out */}
                            <div className="grid grid-cols-2 gap-4">
                              <div className="space-y-2">
                                <Label htmlFor="checkInTime">Check-in Time</Label>
                                <p className="text-xs text-muted-foreground">
                                  Standard guest check-in time.
                                </p>
                                <Input
                                  id="checkInTime"
                                  type="time"
                                  value={checkInTime}
                                  onChange={(e) => setCheckInTime(e.target.value)}
                                />
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor="checkOutTime">Check-out Time</Label>
                                <p className="text-xs text-muted-foreground">
                                  Standard guest check-out time.
                                </p>
                                <Input
                                  id="checkOutTime"
                                  type="time"
                                  value={checkOutTime}
                                  onChange={(e) => setCheckOutTime(e.target.value)}
                                />
                              </div>
                            </div>

                            {/* Meal options */}
                            <fieldset className="space-y-2">
                              <legend className="text-sm font-medium">Meal Options</legend>
                              <p className="text-xs text-muted-foreground">
                                Tick all meal plans or dining options available to guests.
                              </p>
                              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                                {TOURISM_MEAL_OPTIONS.map((m) => (
                                  <label key={m} className="flex items-center gap-2 text-sm">
                                    <input
                                      type="checkbox"
                                      checked={mealOptions.includes(m)}
                                      onChange={() => toggleArrayItem(setMealOptions, m)}
                                      className="rounded border-gray-300"
                                    />
                                    {m}
                                  </label>
                                ))}
                              </div>
                            </fieldset>

                            {/* Smoking / Pet-friendly */}
                            <div className="flex flex-wrap gap-6">
                              <label className="flex items-center gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={petsAllowed}
                                  onChange={(e) => setPetsAllowed(e.target.checked)}
                                  className="rounded border-gray-300"
                                />
                                Pet-friendly
                              </label>
                              <label className="flex items-center gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={smokingAllowed}
                                  onChange={(e) => setSmokingAllowed(e.target.checked)}
                                  className="rounded border-gray-300"
                                />
                                Smoking allowed
                              </label>
                            </div>
                          </>
                        )}

                        {/* ── Group B extra: Spa treatment types ── */}
                        {fieldGroup === "B" && (
                          <fieldset className="space-y-2">
                            <legend className="text-sm font-medium">Treatment Types</legend>
                            <p className="text-xs text-muted-foreground">
                              Select the treatments your spa offers.
                            </p>
                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                              {TOURISM_TREATMENT_TYPES.map((t) => (
                                <label key={t} className="flex items-center gap-2 text-sm">
                                  <input
                                    type="checkbox"
                                    checked={treatmentTypes.includes(t)}
                                    onChange={() => toggleArrayItem(setTreatmentTypes, t)}
                                    className="rounded border-gray-300"
                                  />
                                  {t}
                                </label>
                              ))}
                            </div>
                          </fieldset>
                        )}

                        {/* ── Group C: Tours & Safaris ── */}
                        {fieldGroup === "C" && (
                          <>
                            {/* Activity types */}
                            {TOURISM_ACTIVITY_TYPES[subcategory] && (
                              <fieldset className="space-y-2">
                                <legend className="text-sm font-medium">Activity Types</legend>
                                <p className="text-xs text-muted-foreground">
                                  Select the activities included in your offering.
                                </p>
                                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                                  {TOURISM_ACTIVITY_TYPES[subcategory].map((a) => (
                                    <label key={a} className="flex items-center gap-2 text-sm">
                                      <input
                                        type="checkbox"
                                        checked={activityTypes.includes(a)}
                                        onChange={() => toggleArrayItem(setActivityTypes, a)}
                                        className="rounded border-gray-300"
                                      />
                                      {a}
                                    </label>
                                  ))}
                                </div>
                              </fieldset>
                            )}

                            {/* Tour duration */}
                            <div className="space-y-2">
                              <Label htmlFor="tourDuration">Tour Duration</Label>
                              <p className="text-xs text-muted-foreground">
                                Typical length of the tour or experience.
                              </p>
                              <PostSelect
                                id="tourDuration"
                                value={tourDuration}
                                onChange={(e) => setTourDuration(e.target.value)}
                                className={SELECT_CLASS}
                                aria-label="Tour Duration"
                              >
                                <option value="">Select...</option>
                                {TOURISM_TOUR_DURATIONS.map((d) => (
                                  <option key={d.value} value={d.value}>
                                    {d.label}
                                  </option>
                                ))}
                              </PostSelect>
                            </div>

                            {/* Max group size */}
                            <div className="space-y-2">
                              <Label htmlFor="maxGroupSize">Max Group Size</Label>
                              <p className="text-xs text-muted-foreground">
                                Maximum participants per group or booking.
                              </p>
                              <Input
                                id="maxGroupSize"
                                type="number"
                                min={1}
                                value={maxGroupSize}
                                onChange={(e) => setMaxGroupSize(e.target.value)}
                                placeholder="e.g. 12"
                              />
                            </div>

                            {/* Difficulty (adventure only) */}
                            {subcategory === "adventure_activities" && (
                              <div className="space-y-2">
                                <Label htmlFor="difficultyLevel">Difficulty Level</Label>
                                <p className="text-xs text-muted-foreground">
                                  Physical effort required for this activity.
                                </p>
                                <PostSelect
                                  id="difficultyLevel"
                                  value={difficultyLevel}
                                  onChange={(e) => setDifficultyLevel(e.target.value)}
                                  className={SELECT_CLASS}
                                  aria-label="Difficulty Level"
                                >
                                  <option value="">Select...</option>
                                  {TOURISM_DIFFICULTY_LEVELS.map((d) => (
                                    <option key={d.value} value={d.value}>
                                      {d.label}
                                    </option>
                                  ))}
                                </PostSelect>
                              </div>
                            )}

                            {/* Equipment provided (adventure only) */}
                            {subcategory === "adventure_activities" && (
                              <label className="flex items-center gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={equipmentProvided}
                                  onChange={(e) => setEquipmentProvided(e.target.checked)}
                                  className="rounded border-gray-300"
                                />
                                Equipment Provided
                              </label>
                            )}

                            {/* What's included */}
                            <div className="space-y-2">
                              <Label htmlFor="whatsIncluded">What&apos;s Included</Label>
                              <p className="text-xs text-muted-foreground">
                                List everything guests receive with the booking.
                              </p>
                              <Textarea
                                id="whatsIncluded"
                                value={whatsIncluded}
                                onChange={(e) => setWhatsIncluded(e.target.value)}
                                placeholder="e.g. Transport, lunch, park fees..."
                                rows={3}
                              />
                            </div>

                            {/* Age restriction */}
                            <div className="space-y-2">
                              <Label htmlFor="tourismAgeRestriction">Age Restriction</Label>
                              <p className="text-xs text-muted-foreground">
                                Minimum age requirement, if any.
                              </p>
                              <PostSelect
                                id="tourismAgeRestriction"
                                value={tourismAgeRestriction}
                                onChange={(e) => setTourismAgeRestriction(e.target.value)}
                                className={SELECT_CLASS}
                                aria-label="Age Restriction"
                              >
                                <option value="">No restriction</option>
                                {TOURISM_AGE_RESTRICTIONS.map((a) => (
                                  <option key={a.value} value={a.value}>
                                    {a.label}
                                  </option>
                                ))}
                              </PostSelect>
                            </div>
                          </>
                        )}

                        {/* ── Group D: Travel Agency ── */}
                        {fieldGroup === "D" && (
                          <>
                            {/* Services offered */}
                            <fieldset className="space-y-2">
                              <legend className="text-sm font-medium">Services Offered</legend>
                              <p className="text-xs text-muted-foreground">
                                Select all travel services your agency provides.
                              </p>
                              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                                {TOURISM_TRAVEL_SERVICES.map((s) => (
                                  <label key={s} className="flex items-center gap-2 text-sm">
                                    <input
                                      type="checkbox"
                                      checked={servicesOffered.includes(s)}
                                      onChange={() => toggleArrayItem(setServicesOffered, s)}
                                      className="rounded border-gray-300"
                                    />
                                    {s}
                                  </label>
                                ))}
                              </div>
                            </fieldset>

                            {/* Specializations */}
                            <fieldset className="space-y-2">
                              <legend className="text-sm font-medium">Specializations</legend>
                              <p className="text-xs text-muted-foreground">
                                Select your areas of travel expertise.
                              </p>
                              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                                {TOURISM_TRAVEL_SPECIALIZATIONS.map((s) => (
                                  <label key={s} className="flex items-center gap-2 text-sm">
                                    <input
                                      type="checkbox"
                                      checked={tourismSpecializations.includes(s)}
                                      onChange={() => toggleArrayItem(setTourismSpecializations, s)}
                                      className="rounded border-gray-300"
                                    />
                                    {s}
                                  </label>
                                ))}
                              </div>
                            </fieldset>
                          </>
                        )}

                        {/* ── Group E: Attractions ── */}
                        {fieldGroup === "E" && (
                          <>
                            <div className="flex flex-wrap gap-6">
                              <label className="flex items-center gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={guidedTours}
                                  onChange={(e) => setGuidedTours(e.target.checked)}
                                  className="rounded border-gray-300"
                                />
                                Guided Tours Available
                              </label>
                              <label className="flex items-center gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={audioGuide}
                                  onChange={(e) => setAudioGuide(e.target.checked)}
                                  className="rounded border-gray-300"
                                />
                                Audio Guide Available
                              </label>
                            </div>

                            {/* Visit duration */}
                            <div className="space-y-2">
                              <Label htmlFor="visitDuration">Typical Visit Duration</Label>
                              <p className="text-xs text-muted-foreground">
                                How long a typical visit takes.
                              </p>
                              <PostSelect
                                id="visitDuration"
                                value={visitDuration}
                                onChange={(e) => setVisitDuration(e.target.value)}
                                className={SELECT_CLASS}
                                aria-label="Typical Visit Duration"
                              >
                                <option value="">Select...</option>
                                {TOURISM_VISIT_DURATIONS.map((d) => (
                                  <option key={d.value} value={d.value}>
                                    {d.label}
                                  </option>
                                ))}
                              </PostSelect>
                            </div>

                            {/* Age restriction */}
                            <div className="space-y-2">
                              <Label htmlFor="tourismAgeRestrictionAttr">Age Restriction</Label>
                              <p className="text-xs text-muted-foreground">
                                Minimum age requirement, if any.
                              </p>
                              <PostSelect
                                id="tourismAgeRestrictionAttr"
                                value={tourismAgeRestriction}
                                onChange={(e) => setTourismAgeRestriction(e.target.value)}
                                className={SELECT_CLASS}
                                aria-label="Age Restriction"
                              >
                                <option value="">No restriction</option>
                                {TOURISM_AGE_RESTRICTIONS.map((a) => (
                                  <option key={a.value} value={a.value}>
                                    {a.label}
                                  </option>
                                ))}
                              </PostSelect>
                            </div>
                          </>
                        )}

                        {/* ── Group F: Car Rental ── */}
                        {fieldGroup === "F" && (
                          <>
                            {/* Vehicle types */}
                            <fieldset className="space-y-2">
                              <legend className="text-sm font-medium">Vehicle Types</legend>
                              <p className="text-xs text-muted-foreground">
                                Select all vehicle categories available for hire.
                              </p>
                              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                                {TOURISM_VEHICLE_TYPES.map((v) => (
                                  <label key={v} className="flex items-center gap-2 text-sm">
                                    <input
                                      type="checkbox"
                                      checked={vehicleTypes.includes(v)}
                                      onChange={() => toggleArrayItem(setVehicleTypes, v)}
                                      className="rounded border-gray-300"
                                    />
                                    {v}
                                  </label>
                                ))}
                              </div>
                            </fieldset>

                            {/* Min driver age */}
                            <div className="space-y-2">
                              <Label htmlFor="minDriverAge">Minimum Driver Age</Label>
                              <p className="text-xs text-muted-foreground">
                                Minimum age to rent a vehicle.
                              </p>
                              <Input
                                id="minDriverAge"
                                type="number"
                                min={16}
                                max={99}
                                value={minDriverAge}
                                onChange={(e) => setMinDriverAge(e.target.value)}
                                placeholder="e.g. 21"
                              />
                            </div>

                            {/* Toggles */}
                            <div className="flex flex-wrap gap-6">
                              <label className="flex items-center gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={deliveryCollection}
                                  onChange={(e) => setDeliveryCollection(e.target.checked)}
                                  className="rounded border-gray-300"
                                />
                                Delivery &amp; Collection
                              </label>
                              <label className="flex items-center gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={insuranceIncluded}
                                  onChange={(e) => setInsuranceIncluded(e.target.checked)}
                                  className="rounded border-gray-300"
                                />
                                Insurance Included
                              </label>
                              <label className="flex items-center gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={gpsAvailable}
                                  onChange={(e) => setGpsAvailable(e.target.checked)}
                                  className="rounded border-gray-300"
                                />
                                GPS Available
                              </label>
                            </div>
                          </>
                        )}

                        {/* ── Shared fields (shown when a category is selected) ── */}
                        {fieldGroup && (
                          <>
                            {/* Price range */}
                            <div className="space-y-2">
                              <Label htmlFor="priceRange">Price Range</Label>
                              <p className="text-xs text-muted-foreground">
                                Gives visitors a quick idea of your pricing.
                              </p>
                              <PostSelect
                                id="priceRange"
                                value={priceRange}
                                onChange={(e) => setPriceRange(e.target.value)}
                                className={SELECT_CLASS}
                                aria-label="Price Range"
                              >
                                <option value="">Select...</option>
                                {TOURISM_PRICE_RANGES.map((r) => (
                                  <option key={r.value} value={r.value}>
                                    {r.label}
                                  </option>
                                ))}
                              </PostSelect>
                            </div>

                            {/* Amenities (not for D/F) */}
                            {fieldGroup !== "D" && fieldGroup !== "F" && (
                              <fieldset className="space-y-2">
                                <legend className="text-sm font-medium">Amenities</legend>
                                <p className="text-xs text-muted-foreground">
                                  Select all facilities and amenities available on site.
                                </p>
                                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                                  {TOURISM_AMENITIES.map((a) => (
                                    <label key={a} className="flex items-center gap-2 text-sm">
                                      <input
                                        type="checkbox"
                                        checked={amenities.includes(a)}
                                        onChange={() => toggleArrayItem(setAmenities, a)}
                                        className="rounded border-gray-300"
                                      />
                                      {a}
                                    </label>
                                  ))}
                                </div>
                              </fieldset>
                            )}

                            {/* Languages */}
                            <div className="space-y-2">
                              <Label htmlFor="languagesSpoken">Languages Spoken</Label>
                              <p className="text-xs text-muted-foreground">
                                Comma-separated list of languages your staff speaks.
                              </p>
                              <Input
                                id="languagesSpoken"
                                value={languagesSpoken}
                                onChange={(e) => setLanguagesSpoken(e.target.value)}
                                placeholder="e.g. English, Zulu, Afrikaans"
                              />
                            </div>

                            {/* Cancellation policy */}
                            <div className="space-y-2">
                              <Label htmlFor="cancellationPolicy">Cancellation Policy</Label>
                              <p className="text-xs text-muted-foreground">
                                Your standard terms for cancellations and refunds.
                              </p>
                              <PostSelect
                                id="cancellationPolicy"
                                value={cancellationPolicy}
                                onChange={(e) => setCancellationPolicy(e.target.value)}
                                className={SELECT_CLASS}
                                aria-label="Cancellation Policy"
                              >
                                <option value="">Select...</option>
                                {TOURISM_CANCELLATION_POLICIES.map((c) => (
                                  <option key={c.value} value={c.value}>
                                    {c.label}
                                  </option>
                                ))}
                              </PostSelect>
                            </div>

                            {/* Booking URL */}
                            <div className="space-y-2">
                              <Label htmlFor="bookingUrl">Booking URL</Label>
                              <p className="text-xs text-muted-foreground">
                                Direct link where customers can make bookings online.
                              </p>
                              <Input
                                id="bookingUrl"
                                type="url"
                                value={bookingUrl}
                                onChange={(e) => {
                                  setBookingUrl(e.target.value);
                                  clearErrors("bookingUrl");
                                }}
                                placeholder="https://www.booking.com/..."
                                aria-invalid={!!fieldErrors.bookingUrl}
                              />
                              {fieldErrors.bookingUrl && (
                                <p className="inline-form-error">{fieldErrors.bookingUrl}</p>
                              )}
                            </div>

                            {/* SA Tourism additions */}
                            <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
                              <p className="text-sm font-medium">South African Tourism Details</p>
                              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <div className="space-y-1">
                                  <Label htmlFor="tgcsaGrading">TGCSA Grading</Label>
                                  <PostSelect
                                    id="tgcsaGrading"
                                    aria-label="TGCSA Grading"
                                    className="w-full rounded-md border px-3 py-2 text-sm"
                                    value={tgcsaGrading}
                                    onChange={(e) => setTgcsaGrading(e.target.value)}
                                  >
                                    <option value="">Select…</option>
                                    <option value="1_star">1 Star</option>
                                    <option value="2_star">2 Stars</option>
                                    <option value="3_star">3 Stars</option>
                                    <option value="4_star">4 Stars</option>
                                    <option value="5_star">5 Stars</option>
                                  </PostSelect>
                                  <p className="text-xs text-muted-foreground">
                                    Tourism Grading Council SA rating.
                                  </p>
                                </div>

                                <div className="space-y-1">
                                  <Label htmlFor="minimumStayNights">Minimum Stay</Label>
                                  <Input
                                    id="minimumStayNights"
                                    type="number"
                                    min={1}
                                    value={minimumStayNights}
                                    onChange={(e) => setMinimumStayNights(e.target.value)}
                                    placeholder="e.g. 2"
                                  />
                                  <p className="text-xs text-muted-foreground">Nights</p>
                                </div>
                              </div>

                              <div className="space-y-1">
                                <Label htmlFor="childPolicy">Child Policy</Label>
                                <PostSelect
                                  id="childPolicy"
                                  aria-label="Child policy"
                                  className="w-full rounded-md border px-3 py-2 text-sm"
                                  value={childPolicy}
                                  onChange={(e) => setChildPolicy(e.target.value)}
                                >
                                  <option value="">Select…</option>
                                  <option value="children_welcome">Children Welcome</option>
                                  <option value="children_over_6">Children Over 6</option>
                                  <option value="children_over_12">Children Over 12</option>
                                  <option value="adults_only">Adults Only</option>
                                </PostSelect>
                              </div>

                              <div className="space-y-1">
                                <Label htmlFor="nearbyAttractions">Nearby Attractions</Label>
                                <Input
                                  id="nearbyAttractions"
                                  value={nearbyAttractions}
                                  onChange={(e) => setNearbyAttractions(e.target.value)}
                                  placeholder="e.g. Kruger National Park, Table Mountain"
                                  maxLength={500}
                                />
                              </div>

                              <label className="flex items-center gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={seasonalPricing}
                                  onChange={(e) => setSeasonalPricing(e.target.checked)}
                                  className="rounded border-gray-300"
                                />
                                Has peak / off-peak seasonal pricing
                              </label>
                            </div>
                          </>
                        )}
                      </>
                    ) : (
                      /* ── Event details ── */
                      <>
                        <EventDateFields
                          start={startDate}
                          end={endDate}
                          onStart={setStartDate}
                          onEnd={setEndDate}
                        />
                        {fieldErrors.startDate && (
                          <p className="inline-form-error">{fieldErrors.startDate}</p>
                        )}
                        {fieldErrors.endDate && (
                          <p className="inline-form-error">{fieldErrors.endDate}</p>
                        )}
                        {/* Venue */}
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="venueName">Venue Name</Label>
                            <p className="text-xs text-muted-foreground">
                              Name of the venue or location hosting the event.
                            </p>
                            <Input
                              id="venueName"
                              value={venueName}
                              onChange={(e) => setVenueName(e.target.value)}
                              placeholder="e.g. Cape Town Stadium"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="venueCapacity">Venue Capacity</Label>
                            <p className="text-xs text-muted-foreground">
                              Maximum number of attendees the venue can hold.
                            </p>
                            <Input
                              id="venueCapacity"
                              type="number"
                              min={0}
                              value={venueCapacity}
                              onChange={(e) => setVenueCapacity(e.target.value)}
                              placeholder="e.g. 5000"
                            />
                            {fieldErrors.venueCapacity && (
                              <p className="inline-form-error">{fieldErrors.venueCapacity}</p>
                            )}
                          </div>
                        </div>

                        <fieldset className="space-y-2">
                          <legend>Entry (Required)</legend>
                          <p className="text-sm text-muted-foreground">
                            Free to post describes the listing fee. Free entry means visitors do not
                            pay to attend.
                          </p>
                          <label className="mr-4 inline-flex min-h-11 items-center gap-2">
                            <input
                              type="radio"
                              name="entry"
                              checked={priceZar === "0"}
                              onChange={() => {
                                if (Number(priceZar) > 0) paidPriceRef.current = priceZar;
                                setEntryChoice("free");
                                setPriceZar("0");
                                setNegotiable(false);
                              }}
                            />
                            Free entry
                          </label>
                          <label className="inline-flex min-h-11 items-center gap-2">
                            <input
                              type="radio"
                              name="entry"
                              checked={
                                (entryChoice === "paid" && priceZar !== "0") || Number(priceZar) > 0
                              }
                              onChange={() => {
                                setEntryChoice("paid");
                                setPriceZar(paidPriceRef.current);
                                setNegotiable(false);
                              }}
                            />
                            Paid entry
                          </label>
                        </fieldset>
                        {(entryChoice === "paid" || Number(priceZar) > 0) && priceZar !== "0" && (
                          <>
                            {/* Price */}
                            <div className="grid grid-cols-2 gap-4">
                              <div className="space-y-2">
                                <Label htmlFor="priceZar" required={priceZar !== "0"}>
                                  Starting entry price (ZAR)
                                </Label>
                                <p className="text-xs text-muted-foreground">
                                  Enter the lowest standard price for paid entry.
                                </p>
                                <Input
                                  id="priceZar"
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  disabled={priceZar === "0"}
                                  value={priceZar}
                                  onChange={(e) => {
                                    setPriceZar(e.target.value);
                                    clearErrors("priceZar");
                                  }}
                                  placeholder="0.00 = Free"
                                  aria-invalid={!!fieldErrors.priceZar}
                                />
                                {fieldErrors.priceZar && (
                                  <p className="inline-form-error">{fieldErrors.priceZar}</p>
                                )}
                              </div>
                            </div>
                            {/* Ticket tiers */}
                            <fieldset className="space-y-3">
                              <legend className="text-sm font-medium">Ticket Tiers</legend>
                              <p className="text-xs text-muted-foreground">
                                Add pricing tiers (e.g. General, VIP, Early Bird). Up to 10.
                              </p>
                              {ticketTiers.map((tier, i) => (
                                <div key={i} className="flex items-center gap-2">
                                  <Input
                                    value={tier.name}
                                    onChange={(e) => {
                                      const next = [...ticketTiers];
                                      next[i] = { ...next[i], name: e.target.value };
                                      setTicketTiers(next);
                                    }}
                                    placeholder="Tier name (e.g. VIP)"
                                    className="flex-1"
                                  />
                                  <Input
                                    type="number"
                                    min={0}
                                    step={1}
                                    value={
                                      tier.price_cents !== null
                                        ? String(tier.price_cents / 100)
                                        : ""
                                    }
                                    onChange={(e) => {
                                      const next = [...ticketTiers];
                                      const v = e.target.value;
                                      next[i] = {
                                        ...next[i],
                                        price_cents: v ? Math.round(parseFloat(v) * 100) : null,
                                      };
                                      setTicketTiers(next);
                                    }}
                                    placeholder="Price (ZAR)"
                                    className="w-28"
                                  />
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() =>
                                      setTicketTiers((t) => t.filter((_, j) => j !== i))
                                    }
                                  >
                                    ✕
                                  </Button>
                                </div>
                              ))}
                              {ticketTiers.length < 10 && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() =>
                                    setTicketTiers((t) => [...t, { name: "", price_cents: null }])
                                  }
                                >
                                  + Add tier
                                </Button>
                              )}
                            </fieldset>

                            {/* Tickets URL */}
                            <div className="space-y-2">
                              <Label htmlFor="ticketsUrl">Tickets URL</Label>
                              <p className="text-xs text-muted-foreground">
                                Link where attendees can purchase tickets online.
                              </p>
                              <Input
                                id="ticketsUrl"
                                type="url"
                                value={ticketsUrl}
                                onChange={(e) => {
                                  setTicketsUrl(e.target.value);
                                  clearErrors("ticketsUrl");
                                }}
                                placeholder="https://www.webtickets.co.za/..."
                                aria-invalid={!!fieldErrors.ticketsUrl}
                              />
                              {fieldErrors.ticketsUrl && (
                                <p className="inline-form-error">{fieldErrors.ticketsUrl}</p>
                              )}
                            </div>
                          </>
                        )}
                        {/* Age restriction */}
                        <div className="space-y-2">
                          <Label htmlFor="ageRestriction">Age Restriction</Label>
                          <p className="text-xs text-muted-foreground">
                            Minimum age for attendees, if any.
                          </p>
                          <PostSelect
                            id="ageRestriction"
                            value={ageRestriction}
                            onChange={(e) => setAgeRestriction(e.target.value)}
                            className={SELECT_CLASS}
                            aria-label="Age Restriction"
                          >
                            <option value="">No restriction</option>
                            {EVENT_AGE_RESTRICTIONS.map((a) => (
                              <option key={a.value} value={a.value}>
                                {a.label}
                              </option>
                            ))}
                          </PostSelect>
                        </div>

                        {/* Dress code */}
                        <div className="space-y-2">
                          <Label htmlFor="dressCode">Dress Code</Label>
                          <p className="text-xs text-muted-foreground">
                            Suggested attire for the event.
                          </p>
                          <Input
                            id="dressCode"
                            value={dressCode}
                            onChange={(e) => setDressCode(e.target.value)}
                            placeholder="e.g. Smart casual"
                          />
                        </div>

                        {/* Lineup */}
                        <div className="space-y-2">
                          <Label htmlFor="lineup">Lineup / Performers / Speakers</Label>
                          <p className="text-xs text-muted-foreground">
                            Key performers, speakers, or programme highlights.
                          </p>
                          <Textarea
                            id="lineup"
                            value={lineup}
                            onChange={(e) => setLineup(e.target.value.slice(0, 2000))}
                            rows={3}
                            placeholder="List performers, speakers, or program highlights..."
                          />
                        </div>

                        {/* Toggles  */}
                        <div className="flex flex-wrap gap-6">
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={parkingAvailable}
                              onChange={(e) => setParkingAvailable(e.target.checked)}
                              className="rounded border-gray-300"
                            />
                            Parking available
                          </label>
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={foodDrinksAvailable}
                              onChange={(e) => setFoodDrinksAvailable(e.target.checked)}
                              className="rounded border-gray-300"
                            />
                            Food &amp; drinks available
                          </label>
                        </div>

                        {/* What to bring */}
                        <div className="space-y-2">
                          <Label htmlFor="bringYourOwn">What to Bring</Label>
                          <p className="text-xs text-muted-foreground">
                            Items attendees should bring along.
                          </p>
                          <Input
                            id="bringYourOwn"
                            value={bringYourOwn}
                            onChange={(e) => setBringYourOwn(e.target.value.slice(0, 500))}
                            placeholder="e.g. Blankets, lawn chairs, sunscreen"
                          />
                        </div>

                        {/* Accessibility */}
                        <fieldset className="space-y-2">
                          <legend className="text-sm font-medium">Accessibility</legend>
                          <p className="text-xs text-muted-foreground">
                            Select all accessibility features available at the venue.
                          </p>
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                            {EVENT_ACCESSIBILITY_OPTIONS.map((a) => (
                              <label key={a} className="flex items-center gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={eventAccessibility.includes(a)}
                                  onChange={() => toggleArrayItem(setEventAccessibility, a)}
                                  className="rounded border-gray-300"
                                />
                                {a}
                              </label>
                            ))}
                          </div>
                        </fieldset>

                        {/* SA Event additions */}
                        <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
                          <p className="text-sm font-medium">Event Details (SA)</p>
                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div className="space-y-1">
                              <Label htmlFor="recurring">Recurring</Label>
                              <PostSelect
                                id="recurring"
                                aria-label="Recurring"
                                className="w-full rounded-md border px-3 py-2 text-sm"
                                value={recurring}
                                onChange={(e) => setRecurring(e.target.value)}
                              >
                                <option value="">Select…</option>
                                <option value="one_off">One-off</option>
                                <option value="weekly">Weekly</option>
                                <option value="monthly">Monthly</option>
                                <option value="annual">Annual</option>
                              </PostSelect>
                            </div>

                            <div className="space-y-1">
                              <Label htmlFor="rainPolicy">Rain Policy</Label>
                              <PostSelect
                                id="rainPolicy"
                                aria-label="Rain policy"
                                className="w-full rounded-md border px-3 py-2 text-sm"
                                value={rainPolicy}
                                onChange={(e) => setRainPolicy(e.target.value)}
                              >
                                <option value="">Select…</option>
                                <option value="outdoor_rain_or_shine">
                                  Outdoor — Rain or Shine
                                </option>
                                <option value="moved_indoors">Moved Indoors</option>
                                <option value="postponed">Postponed</option>
                                <option value="refunded">Refunded</option>
                              </PostSelect>
                            </div>
                          </div>

                          <div className="space-y-1">
                            <Label htmlFor="earlyBirdDeadline">Early Bird Deadline</Label>
                            <Input
                              id="earlyBirdDeadline"
                              value={earlyBirdDeadline}
                              onChange={(e) => setEarlyBirdDeadline(e.target.value)}
                              placeholder="e.g. 15 April 2026"
                              maxLength={30}
                            />
                          </div>

                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={groupDiscountAvailable}
                              onChange={(e) => setGroupDiscountAvailable(e.target.checked)}
                              className="rounded border-gray-300"
                            />
                            Group discounts available
                          </label>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* ── Step 2: Location & Contact ── */}
                {step === 2 && (
                  <div className="space-y-6">
                    <LocationSelector
                      value={locationValue}
                      onChange={(v: LocationValue) => {
                        setProvince(v.province);
                        setCity(v.city);
                        setLocationTown(v.town ?? "");
                        setLocationAddress(v.address ?? "");
                        clearErrors("province", "city");
                      }}
                      showTown
                      showAddress
                      townRequired={
                        listingType === "tourism_business" &&
                        ["A", "B", "E"].includes(TOURISM_SUBCATEGORY_FIELD_GROUPS[subcategory])
                      }
                      addressRequired={
                        listingType === "tourism_business" &&
                        ["A", "B", "E"].includes(TOURISM_SUBCATEGORY_FIELD_GROUPS[subcategory])
                      }
                      errors={{
                        province: fieldErrors.province,
                        city: fieldErrors.city,
                      }}
                    />

                    {listingType === "tourism_business" && fieldGroup === "C" && (
                      <fieldset id="tourism-join-methods" className="space-y-3">
                        <legend className="text-sm font-medium">
                          How do visitors join your tour or experience? (Required)
                        </legend>
                        <p className="text-sm text-muted-foreground">
                          Choose all that apply. You do not need to publish an office address.
                        </p>
                        {(
                          [
                            [
                              "meeting_point",
                              "At a meeting point",
                              "For example, outside a museum or at a car park where the tour starts.",
                            ],
                            [
                              "pickup",
                              "I collect visitors",
                              "For example, from hotels or guest houses in the areas you list.",
                            ],
                          ] as const
                        ).map(([value, label, hint]) => (
                          <label
                            key={value}
                            className="flex min-h-11 items-start gap-2 rounded-xl border p-3 text-sm"
                          >
                            <input
                              type="checkbox"
                              aria-label={label}
                              checked={joinMethods.includes(value)}
                              onChange={() => {
                                toggleArrayItem(setJoinMethods, value);
                                clearErrors("joinMethods", "meetingPoint", "pickupAreas");
                              }}
                              className="mt-1 rounded border-gray-300"
                            />
                            <span>
                              <span className="block font-medium">{label}</span>
                              <span className="text-muted-foreground">{hint}</span>
                            </span>
                          </label>
                        ))}
                        {fieldErrors.joinMethods && (
                          <p className="inline-form-error">{fieldErrors.joinMethods}</p>
                        )}
                        {joinMethods.includes("meeting_point") && (
                          <div className="space-y-2">
                            <Label htmlFor="meetingPoint" required>
                              Meeting point
                            </Label>
                            <p className="text-xs text-muted-foreground">
                              This is shown publicly so visitors can find you.
                            </p>
                            <Input
                              id="meetingPoint"
                              value={meetingPoint}
                              onChange={(e) => {
                                setMeetingPoint(e.target.value);
                                clearErrors("meetingPoint");
                              }}
                              maxLength={200}
                              placeholder="e.g. Outside the Hector Pieterson Museum, Soweto"
                              aria-invalid={!!fieldErrors.meetingPoint}
                            />
                            {fieldErrors.meetingPoint && (
                              <p className="inline-form-error">{fieldErrors.meetingPoint}</p>
                            )}
                          </div>
                        )}
                        {joinMethods.includes("pickup") && (
                          <div className="space-y-2">
                            <Label htmlFor="pickupAreas" required>
                              Pickup areas
                            </Label>
                            <p className="text-xs text-muted-foreground">
                              Separate places with commas, such as Sandton, Rosebank.
                            </p>
                            <Input
                              id="pickupAreas"
                              value={pickupAreas}
                              onChange={(e) => {
                                setPickupAreas(e.target.value);
                                clearErrors("pickupAreas");
                              }}
                              maxLength={2000}
                              aria-invalid={!!fieldErrors.pickupAreas}
                            />
                            {fieldErrors.pickupAreas && (
                              <p className="inline-form-error">{fieldErrors.pickupAreas}</p>
                            )}
                          </div>
                        )}
                      </fieldset>
                    )}

                    {/* Contact methods */}
                    <fieldset id="tourism-contact-methods" className="space-y-2">
                      <legend className="text-sm font-medium">
                        How should people contact you? (Required)
                      </legend>
                      <p className="text-sm text-muted-foreground">
                        {listingType === "event"
                          ? "Choose all that apply."
                          : "Choose all that apply. Phone and WhatsApp show the number you enter. The contact form sends enquiries to your VerifyMzansi inbox."}
                      </p>
                      <div className="flex flex-wrap gap-3">
                        {(["call", "whatsapp", "form"] as const).map((method) => (
                          <label key={method} className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={contactMethods.includes(method)}
                              onChange={() => {
                                setContactMethods((c) =>
                                  c.includes(method)
                                    ? c.filter((m) => m !== method)
                                    : [...c, method]
                                );
                                clearErrors("contactMethods");
                              }}
                              className="rounded border-gray-300"
                            />
                            {method === "call"
                              ? "Phone Call"
                              : method === "whatsapp"
                                ? "WhatsApp"
                                : "Contact Form"}
                          </label>
                        ))}
                      </div>
                      {fieldErrors.contactMethods && (
                        <p className="inline-form-error">{fieldErrors.contactMethods}</p>
                      )}
                    </fieldset>

                    {listingType === "event" ? (
                      <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
                        Phone and WhatsApp use the number on your VerifyMzansi account. Contact form
                        enquiries go to your VerifyMzansi inbox. You can change your account number
                        in your profile.
                      </p>
                    ) : (
                      <>
                        {/* Phone & WhatsApp */}
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                          <div className="space-y-2">
                            <Label htmlFor="phone" required={contactMethods.includes("call")}>
                              Phone Number
                            </Label>
                            <Input
                              id="phone"
                              type="tel"
                              value={phone}
                              onChange={(e) => {
                                setPhone(e.target.value);
                                clearErrors("phone");
                              }}
                              placeholder="071 234 5678"
                              aria-invalid={!!fieldErrors.phone}
                            />
                            {fieldErrors.phone && (
                              <p className="inline-form-error">{fieldErrors.phone}</p>
                            )}
                          </div>
                          <div className="space-y-2">
                            <Label
                              htmlFor="whatsapp"
                              required={contactMethods.includes("whatsapp")}
                            >
                              WhatsApp Number
                            </Label>
                            <Input
                              id="whatsapp"
                              type="tel"
                              value={whatsapp}
                              onChange={(e) => {
                                setWhatsapp(e.target.value);
                                clearErrors("whatsapp");
                              }}
                              placeholder="071 234 5678"
                              aria-invalid={!!fieldErrors.whatsapp}
                            />
                            {fieldErrors.whatsapp && (
                              <p className="inline-form-error">{fieldErrors.whatsapp}</p>
                            )}
                          </div>
                        </div>

                        {/* Email & Website */}
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                          <div className="space-y-2">
                            <Label htmlFor="email">Email</Label>
                            <Input
                              id="email"
                              type="email"
                              value={email}
                              onChange={(e) => {
                                setEmail(e.target.value);
                                clearErrors("email");
                              }}
                              placeholder="info@business.co.za"
                              aria-invalid={!!fieldErrors.email}
                            />
                            {fieldErrors.email && (
                              <p className="inline-form-error">{fieldErrors.email}</p>
                            )}
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="website">Website</Label>
                            <Input
                              id="website"
                              type="url"
                              value={website}
                              onChange={(e) => {
                                setWebsite(e.target.value);
                                clearErrors("website");
                              }}
                              placeholder="https://www.yoursite.co.za"
                              aria-invalid={!!fieldErrors.website}
                            />
                            {fieldErrors.website && (
                              <p className="inline-form-error">{fieldErrors.website}</p>
                            )}
                          </div>
                        </div>

                        {/* Social links */}
                        <div className="space-y-3">
                          <p className="text-sm font-medium">Social Media (optional)</p>
                          {[
                            [
                              "socialFacebook",
                              "Facebook URL",
                              socialFacebook,
                              setSocialFacebook,
                            ] as const,
                            [
                              "socialInstagram",
                              "Instagram URL",
                              socialInstagram,
                              setSocialInstagram,
                            ] as const,
                            [
                              "socialTwitter",
                              "X / Twitter URL",
                              socialTwitter,
                              setSocialTwitter,
                            ] as const,
                            ["socialTiktok", "TikTok URL", socialTiktok, setSocialTiktok] as const,
                          ].map(([key, label, value, setter]) => (
                            <div key={key} className="space-y-1">
                              <Input
                                id={key}
                                value={value}
                                onChange={(e) => {
                                  setter(e.target.value);
                                  clearErrors(key);
                                }}
                                placeholder={label}
                                aria-invalid={!!fieldErrors[key]}
                              />
                              {fieldErrors[key] && (
                                <p className="inline-form-error">{fieldErrors[key]}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      </>
                    )}

                    {/* Operating hours (tourism business only) */}
                    {listingType === "tourism_business" && (
                      <div className="space-y-3">
                        <p className="text-sm font-medium">Operating Hours</p>
                        {(
                          [
                            {
                              id: "hours-weekday",
                              label: "Mon – Fri",
                              value: hoursMonFri,
                              setter: setHoursMonFri,
                            },
                            {
                              id: "hours-sat",
                              label: "Saturday",
                              value: hoursSat,
                              setter: setHoursSat,
                            },
                            {
                              id: "hours-sun",
                              label: "Sunday",
                              value: hoursSun,
                              setter: setHoursSun,
                            },
                          ] as const
                        ).map(({ id, label, value, setter }) => {
                          const parsed = parseHoursValue(value);
                          return (
                            <OperatingHoursInput
                              key={id}
                              id={id}
                              label={label}
                              open={parsed.open}
                              close={parsed.close}
                              closed={parsed.closed}
                              onOpenChange={(v) =>
                                setter(formatHoursValue(v, parsed.close, parsed.closed))
                              }
                              onCloseChange={(v) =>
                                setter(formatHoursValue(parsed.open, v, parsed.closed))
                              }
                              onClosedChange={(v) =>
                                setter(formatHoursValue(parsed.open, parsed.close, v))
                              }
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* ── Step 3: Media & Review ── */}
                {step === 3 && (
                  <div className="space-y-6">
                    <PostFormSection
                      title="Photos and video"
                      description="The first photo is the cover."
                    >
                      {/* Photos */}
                      <div className="space-y-2">
                        <p className="text-sm font-medium">
                          {listingType === "event" ? "Photos or video *" : "Photos *"}
                        </p>
                        <MediaUpload
                          id="tourism-images-input"
                          label="Upload photos"
                          description={`Up to ${maxPhotos}. Portrait 9:16 works best.`}
                          error={fieldErrors.images}
                          maxFiles={maxPhotos}
                          files={photoFiles}
                          onChange={(files) => {
                            setPhotoFiles(files);
                            clearErrors("images");
                          }}
                          accept="image/*"
                        />
                        <PhotoOrderList files={photoFiles} onReorder={setPhotoFiles} />
                      </div>

                      {/* Focal point */}
                      {photoFiles.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-sm font-medium">Cover crop</p>
                          <MediaCropPreview
                            file={photoFiles[0]}
                            aspectRatio={4 / 1}
                            value={focalPoint}
                            onChange={setFocalPoint}
                          />
                        </div>
                      )}

                      {/* Video */}
                      <div className="space-y-2">
                        <p className="text-sm font-medium">
                          Video (optional)
                          {!videoAllowed ? " — Upgrade to unlock" : ""}
                        </p>
                        <MediaUpload
                          id="tourism-videos-input"
                          label="Upload video"
                          description={`Up to ${maxVideos}. One portrait 9:16 clip works best.`}
                          error={fieldErrors.videos}
                          maxFiles={maxVideos}
                          files={videoFiles}
                          onChange={(files) => {
                            setVideoFiles(files);
                            prewarmVideosForFastUpload(files);
                            setVideoThumbnailFile([]);
                            clearErrors("videos");
                          }}
                          accept="video/*"
                          disabled={!videoAllowed}
                        />
                        {!videoAllowed && (
                          <p className="text-xs">
                            <Link
                              href="/billing"
                              className="font-semibold text-sunset-700 underline underline-offset-2 dark:text-sunset-300"
                            >
                              Upgrade your plan
                            </Link>{" "}
                            <span className="text-muted-foreground">to add a video.</span>
                          </p>
                        )}
                      </div>

                      {/* Video thumbnail */}
                      {videoFiles.length > 0 && (
                        <div
                          id="tourism-video-thumbnail"
                          tabIndex={-1}
                          className="space-y-2 rounded-lg"
                        >
                          <p className="text-sm font-medium">Video thumbnail</p>
                          <VideoFrameSelector
                            file={videoFiles[0]}
                            onFrameSelect={(f) => {
                              setVideoThumbnailFile(f ? [f] : []);
                              clearErrors("video_thumbnail");
                            }}
                          />
                          {fieldErrors.video_thumbnail && (
                            <p className="inline-form-error">{fieldErrors.video_thumbnail}</p>
                          )}
                        </div>
                      )}
                    </PostFormSection>
                    <PostFormSection title="Logo" optional>
                      {/* Logo */}
                      <div className="space-y-2">
                        <MediaUpload
                          id="tourism-logo-input"
                          label="Upload logo"
                          description="Square image shown beside your name."
                          error={fieldErrors.logo_url}
                          maxFiles={1}
                          files={logoFiles}
                          onChange={(files) => {
                            setLogoFiles(files);
                            clearErrors("logo_url");
                          }}
                          accept="image/*"
                          recommendedAspect="Recommended: square image, at least 96 x 96."
                        />
                      </div>

                      {/* Visual placement preview */}
                      {(photoPreviewUrls.length > 0 || logoPreviewUrl) && (
                        <div className="space-y-2 rounded-2xl border border-dashed border-border bg-muted/30 p-4">
                          <p className="text-xs font-medium text-muted-foreground">
                            How they appear together
                          </p>
                          <div className="relative overflow-hidden rounded-xl border border-border bg-muted">
                            <div className="flex aspect-[4/1] items-center justify-center bg-gradient-to-r from-sunset-200/70 to-sunset-50 dark:from-sunset-900/60 dark:to-sunset-950/40">
                              {photoPreviewUrls[0] ? (
                                /* eslint-disable-next-line @next/next/no-img-element */
                                <img
                                  src={photoPreviewUrls[0]}
                                  alt="Cover preview"
                                  className="w-full h-full bg-muted object-contain"
                                  width={600}
                                  height={150}
                                />
                              ) : (
                                <span className="text-xs text-muted-foreground">Cover</span>
                              )}
                            </div>
                            <div className="absolute bottom-2 left-4 h-12 w-12 overflow-hidden rounded-xl border border-border bg-card p-1 shadow-md">
                              {logoPreviewUrl ? (
                                /* eslint-disable-next-line @next/next/no-img-element */
                                <img
                                  src={logoPreviewUrl}
                                  alt="Logo preview"
                                  className="w-full h-full object-contain rounded-md"
                                  width={48}
                                  height={48}
                                />
                              ) : (
                                <div className="w-full h-full rounded-md bg-muted flex items-center justify-center">
                                  <TreePalm className="h-5 w-5 text-muted-foreground" />
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </PostFormSection>
                    <PostFormSection title="Final check">
                      <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-border bg-muted/30 p-4 text-sm leading-6">
                        <input
                          id="tourism-terms-checkbox"
                          type="checkbox"
                          checked={termsAccepted}
                          onChange={(event) => {
                            setTermsAccepted(event.target.checked);
                            clearErrors("termsAccepted");
                          }}
                          className="mt-1 h-4 w-4 shrink-0 rounded accent-sunset-600"
                          aria-invalid={!!fieldErrors.termsAccepted}
                        />
                        <span>
                          I accept the VerifyMzansi posting terms, including the free-post
                          visibility period and my responsibility for the accuracy and legality of
                          this tourism or event post.{" "}
                          <a
                            className="font-semibold text-sunset-700 underline underline-offset-2 dark:text-sunset-300"
                            href="/terms"
                          >
                            View terms
                          </a>
                          .
                          {fieldErrors.termsAccepted && (
                            <span className="mt-1 block text-destructive">
                              {fieldErrors.termsAccepted}
                            </span>
                          )}
                        </span>
                      </label>
                    </PostFormSection>
                    {renderPreview()}
                  </div>
                )}
              </PostFormScaffold>
            </form>
          </PlanGate>
        </div>
      </main>
      <Footer />
    </div>
  );
}
