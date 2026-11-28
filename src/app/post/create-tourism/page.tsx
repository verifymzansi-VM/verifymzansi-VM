"use client";
import { PostingTermsConsent } from "@/components/post/posting-terms-consent";
import { PostSelect } from "@/components/post/post-select";
import { EventDateFields } from "@/components/post/event-date-fields";
import { eventTimeToIso } from "@/lib/forms/event-time";

import { settleMediaUploads } from "@/app/post/_lib/settle-media-uploads";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePostTransport } from "@/hooks/use-post-transport";
import Link from "next/link";
import { Camera, ClipboardList, Eye, MapPin, TreePalm } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PostLabel as Label } from "@/components/post/post-label";
import { Textarea } from "@/components/ui/textarea";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { MediaUpload } from "@/components/ui/media-upload";
import { OnlinePresenceFields } from "@/components/post/online-presence-fields";
import { ContactSwitches, type ContactSwitchOption } from "@/components/post/contact-switches";
import { MediaLimitsLine } from "@/components/post/media-limits-line";
import { PostSubmittedScreen, createdPostId } from "@/components/post/post-submitted-screen";
import {
  TOURISM_BACKUP_UTILITIES,
  TOURISM_CANCELLATION_CHOICES,
  TOURISM_PRICE_UNITS,
} from "@/lib/forms/business-category-details";
import {
  EVENT_GATE_PAYMENTS,
  EVENT_ID_CHECK_LINE,
  EVENT_REFUND_POLICIES,
  EVENT_TICKET_SALES,
  eventChecksId,
  eventSellsAtDoor,
} from "@/lib/forms/event-entry-details";
import {
  UploadProgressPanel,
  useUploadProgress,
  type UploadSlotStatus,
} from "@/components/ui/upload-progress-panel";
import { VideoFrameSelector } from "@/components/ui/video-frame-selector";
import { PHOTO_OR_VIDEO_RULE, photosWithVideoCover } from "@/lib/forms/video-cover-photo";
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
  POST_SESSION_EXPIRED_MESSAGE,
  resolveServerRedirect,
} from "@/app/post/_lib/post-submit-navigation";
import { PostSignInAction } from "@/components/post/post-sign-in-action";
import {
  getPromotionMediaUploadErrorState,
  uploadPromotionVideoFiles,
  uploadRequiredPromotionMedia,
} from "@/app/post/_lib/promotion-media-upload";
import {
  isVideoPreparing,
  prepareVideoForCover,
  prewarmVideosForFastUpload,
  videoCoverForSubmit,
  VideoCoverMissingError,
} from "@/app/post/_lib/video-fast-upload";
import { videoLimitSeconds, VIDEO_SOUND_OFF_TIP } from "@/lib/media/video-length";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { usePostDraftAutosave } from "@/hooks/use-post-draft-autosave";
import { validateTourismStep } from "@/lib/forms/tourism-form";
import { BUSINESS_TEXT_LIMITS } from "@/lib/validations/business-limits";
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
import {
  TOURISM_FIELD_STEPS,
  stepForField,
  stepForFieldErrors,
} from "@/app/post/_lib/post-field-steps";

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

/** Call and WhatsApp use the account's verified number: nothing to type. */
const CONTACT_OPTIONS: ContactSwitchOption[] = [
  { id: "call", label: "Call", usesVerifiedNumber: true },
  { id: "whatsapp", label: "WhatsApp", usesVerifiedNumber: true },
  { id: "form", label: "Contact form", hint: "Enquiries arrive in your VerifyMzansi inbox" },
];

/** The usual "From R___" unit for each tourism field group. */
function defaultPriceUnit(group: string): string {
  if (group === "A") return "night";
  if (group === "E") return "entry";
  if (group === "F") return "unit";
  return "person";
}

/** This form's draft: the shared tourism draft plus the newer answers. */
type CreateTourismDraft = TourismDraftData & {
  socialYoutube?: string;
  priceFrom?: string;
  priceUnit?: string;
  sleeps?: string;
  bedrooms?: string;
  beds?: string;
  bathrooms?: string;
  backupUtilities?: string[];
  cancellationFreeDays?: string;
  openingHours?: string;
  tgcsaGrading?: string;
  minimumStayNights?: string;
  childPolicy?: string;
  seasonalPricing?: boolean;
  nearbyAttractions?: string;
  doorsOpen?: string;
  refundPolicy?: string;
  refundDays?: string;
  ticketSales?: string;
  gatePayment?: string[];
  rainPolicy?: string;
  earlyBirdDeadline?: string;
};

const FIELD_IDS: Record<string, string> = {
  listingType: "listing-type-group",
  title: "title",
  description: "description",
  subcategory: "subcategory",
  eventType: "eventType",
  numberOfRooms: "numberOfRooms",
  priceFrom: "priceFrom",
  sleeps: "sleeps",
  bedrooms: "bedrooms",
  beds: "beds",
  bathrooms: "bathrooms",
  cancellationFreeDays: "cancellationFreeDays",
  openingHours: "openingHours",
  doorsOpen: "doorsOpen",
  refundDays: "refundDays",
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
  website: "website",
  mapDirections: "mapDirections",
  socialFacebook: "socialFacebook",
  socialInstagram: "socialInstagram",
  socialTwitter: "socialTwitter",
  socialTiktok: "socialTiktok",
  socialYoutube: "socialYoutube",
  locationAddress: "locationAddress",
  locationTown: "locationTown",
  logo_url: "tourism-logo",
  images: "tourism-images",
  videos: "tourism-videos",
  video_thumbnail: "tourism-video-thumbnail",
  termsAccepted: "tourism-terms-checkbox",
};

const FIELD_KEY_ALIASES: Record<string, string> = {
  business_name: "title",
  listing_type: "listingType",
  "event_details.event_type": "eventType",
  "event_details.venue_name": "venueName",
  "event_details.venue_capacity": "venueCapacity",
  event_type: "eventType",
  venue_capacity: "venueCapacity",
  booking_url: "bookingUrl",
  tickets_url: "ticketsUrl",
  price_zar: "priceZar",
  start_date: "startDate",
  end_date: "endDate",
  contact_methods: "contactMethods",
  // Call and WhatsApp use the verified account number, set on the contact switches.
  phone: "contactMethods",
  whatsapp: "contactMethods",
  location_province: "province",
  location_city: "city",
  location_town: "locationTown",
  location_address: "locationAddress",
  social_facebook: "socialFacebook",
  social_instagram: "socialInstagram",
  social_twitter: "socialTwitter",
  social_tiktok: "socialTiktok",
  social_youtube: "socialYoutube",
  map_directions: "mapDirections",
  "social_links.facebook": "socialFacebook",
  "social_links.instagram": "socialInstagram",
  "social_links.twitter": "socialTwitter",
  "social_links.tiktok": "socialTiktok",
  "social_links.youtube": "socialYoutube",
  "event_details.website": "website",
  "event_details.map_directions": "mapDirections",
  "event_details.social_links.facebook": "socialFacebook",
  "event_details.social_links.instagram": "socialInstagram",
  "event_details.social_links.twitter": "socialTwitter",
  "event_details.social_links.tiktok": "socialTiktok",
  "event_details.social_links.youtube": "socialYoutube",
  "event_details.doors_open": "doorsOpen",
  "event_details.refund_days": "refundDays",
  "category_details.price_from_cents": "priceFrom",
  "category_details.cancellation_free_days": "cancellationFreeDays",
  "category_details.opening_hours": "openingHours",
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
  locationAddress: "Detailed address",
  locationTown: "Suburb / town",
  contactMethods: "Contact methods",
  joinMethods: "How visitors join",
  meetingPoint: "Meeting point",
  pickupAreas: "Pickup areas",
  website: "Website",
  mapDirections: "Location pin",
  socialFacebook: "Facebook",
  socialInstagram: "Instagram",
  socialTwitter: "X / Twitter",
  socialTiktok: "TikTok",
  socialYoutube: "YouTube",
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
  numberOfRooms: "Number of rooms",
  priceFrom: "Price from",
  sleeps: "Sleeps",
  bedrooms: "Bedrooms",
  beds: "Beds",
  bathrooms: "Bathrooms",
  cancellationFreeDays: "Free cancellation days",
  openingHours: "Opening hours",
  doorsOpen: "Doors open",
  refundDays: "Refund days",
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
  return stepForField(FIELD_KEY_ALIASES[key] ?? key, TOURISM_FIELD_STEPS);
}

function getStepForServerErrors(errors: Record<string, string>): number {
  return stepForFieldErrors(errors, TOURISM_FIELD_STEPS, 3);
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
  const { fields: postFields } = usePostTransport();
  const searchParams = useSearchParams();
  const requestedListingType = parseRequestedTourismListingType(searchParams.get("type"));
  const { toast } = useToast();
  const { user, profile, isLoading } = useAuth();

  /* ── Step & error state ──────────────────────────────────── */
  const [step, setStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submissionInFlightRef = useRef(false);
  const [submitProgress, setSubmitProgress] = useState<string | null>(null);
  const uploadProgress = useUploadProgress();
  const [uploadStatuses, setUploadStatuses] = useState<Record<string, UploadSlotStatus>>({
    logo: "idle",
    photos: "idle",
    videos: "idle",
    saving: "idle",
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [submitSucceeded, setSubmitSucceeded] = useState(false);
  const [submittedId, setSubmittedId] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  /* ── Shared state ────────────────────────────────────────── */
  const [listingType, setListingType] = useState<TourismListingType>(
    requestedListingType ?? "tourism_business"
  );
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const maxTitleLength = listingType === "event" ? 120 : BUSINESS_TEXT_LIMITS.name;
  const maxDescriptionLength = listingType === "event" ? 5000 : BUSINESS_TEXT_LIMITS.description;
  const [province, setProvince] = useState("");
  const [city, setCity] = useState("");
  const [locationTown, setLocationTown] = useState("");
  const [locationAddress, setLocationAddress] = useState("");
  const [contactMethods, setContactMethods] = useState<string[]>(["call"]);
  const [publishAddress, setPublishAddress] = useState(false);
  const [website, setWebsite] = useState("");
  const [socialFacebook, setSocialFacebook] = useState("");
  const [socialInstagram, setSocialInstagram] = useState("");
  const [socialTwitter, setSocialTwitter] = useState("");
  const [socialTiktok, setSocialTiktok] = useState("");
  const [socialYoutube, setSocialYoutube] = useState("");
  const [mapDirections, setMapDirections] = useState("");
  const rawBusinessId = searchParams.get("business_id") || "";
  const [businessId, setBusinessId] = useState(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawBusinessId)
      ? rawBusinessId
      : ""
  );

  /* ── Tourism business state ──────────────────────────────── */
  const [subcategory, setSubcategory] = useState("");
  const [numberOfRooms, setNumberOfRooms] = useState("");
  const [accommodationTypes, setAccommodationTypes] = useState<string[]>([]);
  const [checkInTime, setCheckInTime] = useState("");
  const [checkOutTime, setCheckOutTime] = useState("");
  const [priceFrom, setPriceFrom] = useState("");
  const [priceUnit, setPriceUnit] = useState("");
  const [sleeps, setSleeps] = useState("");
  const [bedrooms, setBedrooms] = useState("");
  const [beds, setBeds] = useState("");
  const [bathrooms, setBathrooms] = useState("");
  const [backupUtilities, setBackupUtilities] = useState<string[]>([]);
  const [cancellationFreeDays, setCancellationFreeDays] = useState("");
  const [openingHours, setOpeningHours] = useState("");
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
  const [doorsOpen, setDoorsOpen] = useState("");
  const [refundPolicy, setRefundPolicy] = useState("");
  const [refundDays, setRefundDays] = useState("");
  const [ticketSales, setTicketSales] = useState("");
  const [gatePayment, setGatePayment] = useState<string[]>([]);
  const [lineup, setLineup] = useState("");
  const [parkingAvailable, setParkingAvailable] = useState(false);
  const [eventAccessibility, setEventAccessibility] = useState<string[]>([]);
  const [foodDrinksAvailable, setFoodDrinksAvailable] = useState(false);
  const [bringYourOwn, setBringYourOwn] = useState("");
  /* SA event additions */
  const [rainPolicy, setRainPolicy] = useState("");
  const [earlyBirdDeadline, setEarlyBirdDeadline] = useState("");

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
  } = usePostDraftAutosave<CreateTourismDraft>("tourism", user?.id, !isLoading);
  const lastAutosaveSignatureRef = useRef<string>("");
  // The draft is applied once; a later re-run of the restore effect does not repeat it.
  const draftAppliedRef = useRef(false);

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

  // Call and WhatsApp use the account's verified number; without one they stay off.
  const verifiedPhone = profile?.phone?.trim() ?? "";
  const activeContactMethods = contactMethods.filter(
    (method) => verifiedPhone || (method !== "call" && method !== "whatsapp")
  );
  const phone = activeContactMethods.includes("call") ? verifiedPhone : "";
  const whatsapp = activeContactMethods.includes("whatsapp") ? verifiedPhone : "";

  // Reset category-specific fields when subcategory changes
  // Keep compatible answers when temporarily changing activity; the payload builder
  // includes only fields belonging to the selected activity.

  // Restore draft
  useEffect(() => {
    if (!user?.id || isLoading) return;
    void Promise.resolve(restoreDraft()).then((draft) => {
      if (!draft || draftAppliedRef.current) return;
      draftAppliedRef.current = true;
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
      // A late restore fills only what is still empty: never text already typed.
      const keep = (saved: string) => (current: string) => current || saved;
      queueMicrotask(() => {
        setStep(draft.step);
        if (d.listingType && !requestedListingType)
          setListingType(d.listingType as TourismListingType);
        if (d.title) setTitle(keep(d.title));
        if (d.description) setDescription(keep(d.description));
        if (d.subcategory) setSubcategory(keep(d.subcategory));
        if (d.numberOfRooms) setNumberOfRooms(keep(d.numberOfRooms));
        if (d.accommodationTypes?.length) setAccommodationTypes(d.accommodationTypes);
        if (d.checkInTime) setCheckInTime(keep(d.checkInTime));
        if (d.checkOutTime) setCheckOutTime(keep(d.checkOutTime));
        if (d.priceFrom) setPriceFrom(keep(d.priceFrom));
        if (d.priceUnit) setPriceUnit(keep(d.priceUnit));
        if (d.sleeps) setSleeps(keep(d.sleeps));
        if (d.bedrooms) setBedrooms(keep(d.bedrooms));
        if (d.beds) setBeds(keep(d.beds));
        if (d.bathrooms) setBathrooms(keep(d.bathrooms));
        if (d.backupUtilities?.length) setBackupUtilities(d.backupUtilities);
        if (d.cancellationFreeDays) setCancellationFreeDays(keep(d.cancellationFreeDays));
        if (d.openingHours) setOpeningHours(keep(d.openingHours));
        if (d.tgcsaGrading) setTgcsaGrading(keep(d.tgcsaGrading));
        if (d.minimumStayNights) setMinimumStayNights(keep(d.minimumStayNights));
        if (d.childPolicy) setChildPolicy(keep(d.childPolicy));
        if (d.seasonalPricing) setSeasonalPricing(keep(d.seasonalPricing));
        if (d.nearbyAttractions) setNearbyAttractions(keep(d.nearbyAttractions));
        if (d.amenities?.length) setAmenities(d.amenities);
        if (d.mealOptions?.length) setMealOptions(d.mealOptions);
        if (d.languagesSpoken) setLanguagesSpoken(keep(d.languagesSpoken));
        if (d.cancellationPolicy) setCancellationPolicy(keep(d.cancellationPolicy));
        if (d.bookingUrl) setBookingUrl(keep(d.bookingUrl));
        if (d.petsAllowed) setPetsAllowed(keep(d.petsAllowed));
        if (d.smokingAllowed) setSmokingAllowed(keep(d.smokingAllowed));
        if (d.treatmentTypes?.length) setTreatmentTypes(d.treatmentTypes);
        if (d.activityTypes?.length) setActivityTypes(d.activityTypes);
        if (d.tourDuration) setTourDuration(keep(d.tourDuration));
        if (d.maxGroupSize) setMaxGroupSize(keep(d.maxGroupSize));
        if (d.difficultyLevel) setDifficultyLevel(keep(d.difficultyLevel));
        if (d.equipmentProvided) setEquipmentProvided(keep(d.equipmentProvided));
        if (d.whatsIncluded) setWhatsIncluded(keep(d.whatsIncluded));
        if (d.tourismAgeRestriction) setTourismAgeRestriction(keep(d.tourismAgeRestriction));
        if (d.servicesOffered?.length) setServicesOffered(d.servicesOffered);
        if (d.tourismSpecializations?.length) setTourismSpecializations(d.tourismSpecializations);
        if (d.guidedTours) setGuidedTours(keep(d.guidedTours));
        if (d.audioGuide) setAudioGuide(keep(d.audioGuide));
        if (d.visitDuration) setVisitDuration(keep(d.visitDuration));
        if (d.vehicleTypes?.length) setVehicleTypes(d.vehicleTypes);
        if (d.deliveryCollection) setDeliveryCollection(keep(d.deliveryCollection));
        if (d.minDriverAge) setMinDriverAge(keep(d.minDriverAge));
        if (d.insuranceIncluded) setInsuranceIncluded(keep(d.insuranceIncluded));
        if (d.gpsAvailable) setGpsAvailable(keep(d.gpsAvailable));
        if (d.hoursMonFri) setHoursMonFri(keep(d.hoursMonFri));
        if (d.hoursSat) setHoursSat(keep(d.hoursSat));
        if (d.hoursSun) setHoursSun(keep(d.hoursSun));
        if (d.eventType) setEventType(keep(d.eventType));
        if (d.startDate) setStartDate(keep(d.startDate));
        if (d.endDate) setEndDate(keep(d.endDate));
        if (d.priceZar) setPriceZar(keep(d.priceZar));
        if (d.negotiable) setNegotiable(keep(d.negotiable));
        if (d.venueName) setVenueName(keep(d.venueName));
        if (d.venueCapacity) setVenueCapacity(keep(d.venueCapacity));
        if (d.ticketTiers?.length) setTicketTiers(d.ticketTiers);
        if (d.ticketsUrl) setTicketsUrl(keep(d.ticketsUrl));
        if (d.ageRestriction) setAgeRestriction(keep(d.ageRestriction));
        if (d.doorsOpen) setDoorsOpen(keep(d.doorsOpen));
        if (d.refundPolicy) setRefundPolicy(keep(d.refundPolicy));
        if (d.refundDays) setRefundDays(keep(d.refundDays));
        if (d.ticketSales) setTicketSales(keep(d.ticketSales));
        if (d.gatePayment?.length) setGatePayment(d.gatePayment);
        if (d.rainPolicy) setRainPolicy(keep(d.rainPolicy));
        if (d.earlyBirdDeadline) setEarlyBirdDeadline(keep(d.earlyBirdDeadline));
        if (d.lineup) setLineup(keep(d.lineup));
        if (d.parkingAvailable) setParkingAvailable(keep(d.parkingAvailable));
        if (d.accessibility?.length) setEventAccessibility(d.accessibility);
        if (d.foodDrinksAvailable) setFoodDrinksAvailable(keep(d.foodDrinksAvailable));
        if (d.bringYourOwn) setBringYourOwn(keep(d.bringYourOwn));
        // The profile may have filled the area already; the draft's area wins, as before.
        if (d.province) setProvince(d.province);
        if (d.city) setCity(d.city);
        if (d.locationTown) setLocationTown(keep(d.locationTown));
        if (d.locationAddress) setLocationAddress(keep(d.locationAddress));
        if (d.publishAddress) setPublishAddress(true);
        if (d.joinMethods?.length) setJoinMethods(d.joinMethods);
        if (d.meetingPoint) setMeetingPoint(keep(d.meetingPoint));
        if (d.pickupAreas) setPickupAreas(keep(d.pickupAreas));
        if (d.contactMethods?.length) setContactMethods(d.contactMethods);
        if (d.website) setWebsite(keep(d.website));
        if (d.socialFacebook) setSocialFacebook(keep(d.socialFacebook));
        if (d.socialInstagram) setSocialInstagram(keep(d.socialInstagram));
        if (d.socialTwitter) setSocialTwitter(keep(d.socialTwitter));
        if (d.socialTiktok) setSocialTiktok(keep(d.socialTiktok));
        if (d.socialYoutube) setSocialYoutube(keep(d.socialYoutube));
        if (d.mapDirections) setMapDirections(keep(d.mapDirections));
        if (d.businessId) setBusinessId(keep(d.businessId));
        toast({ title: "Draft restored", description: "Continuing where you left off." });
      });
    });
  }, [user?.id, isLoading, restoreDraft, requestedListingType, toast]);

  // Auto-save draft
  useEffect(() => {
    if (!user?.id || isLoading || isSubmitting || submitSucceeded) return;
    const draftData: CreateTourismDraft = {
      listingType,
      title,
      description,
      subcategory,
      starRating: "",
      numberOfRooms,
      accommodationTypes,
      checkInTime,
      checkOutTime,
      priceRange: "",
      priceFrom,
      priceUnit,
      sleeps,
      bedrooms,
      beds,
      bathrooms,
      backupUtilities,
      cancellationFreeDays,
      openingHours,
      tgcsaGrading,
      minimumStayNights,
      childPolicy,
      seasonalPricing,
      nearbyAttractions,
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
      dressCode: "",
      doorsOpen,
      refundPolicy,
      refundDays,
      ticketSales,
      gatePayment,
      rainPolicy,
      earlyBirdDeadline,
      lineup,
      parkingAvailable,
      accessibility: eventAccessibility,
      foodDrinksAvailable,
      bringYourOwn,
      province,
      city,
      locationTown,
      locationAddress,
      publishAddress,
      joinMethods,
      meetingPoint,
      pickupAreas,
      contactMethods,
      // Call and WhatsApp use the verified account number; nothing typed to keep.
      phone: "",
      whatsapp: "",
      website,
      hoursMonFri,
      hoursSat,
      hoursSun,
      socialFacebook,
      socialInstagram,
      socialTwitter,
      socialTiktok,
      socialYoutube,
      mapDirections,
      businessId,
    };

    // Deferred to a microtask, as Business and Market do (it still runs
    // before the next paint).
    queueMicrotask(() => {
      const autosaveSignature = JSON.stringify({ step, draftData });
      if (autosaveSignature === lastAutosaveSignatureRef.current) return;

      lastAutosaveSignatureRef.current = autosaveSignature;
      saveDraft(step, draftData);
      setLastSavedAt(Date.now());
    });
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
    numberOfRooms,
    accommodationTypes,
    checkInTime,
    checkOutTime,
    priceFrom,
    priceUnit,
    sleeps,
    bedrooms,
    beds,
    bathrooms,
    backupUtilities,
    cancellationFreeDays,
    openingHours,
    tgcsaGrading,
    minimumStayNights,
    childPolicy,
    seasonalPricing,
    nearbyAttractions,
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
    doorsOpen,
    refundPolicy,
    refundDays,
    ticketSales,
    gatePayment,
    rainPolicy,
    earlyBirdDeadline,
    lineup,
    parkingAvailable,
    eventAccessibility,
    foodDrinksAvailable,
    bringYourOwn,
    province,
    city,
    locationTown,
    locationAddress,
    publishAddress,
    joinMethods,
    meetingPoint,
    pickupAreas,
    contactMethods,
    website,
    hoursMonFri,
    hoursSat,
    hoursSun,
    socialFacebook,
    socialInstagram,
    socialTwitter,
    socialTiktok,
    socialYoutube,
    mapDirections,
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
        "priceFrom",
        "sleeps",
        "bedrooms",
        "beds",
        "bathrooms",
        "openingHours",
        "numberOfRooms",
        "cancellationFreeDays",
        "bookingUrl",
        "startDate",
        "endDate",
        "doorsOpen",
        "priceZar",
        "venueCapacity",
        "ticketsUrl",
        "refundDays",
      ],
      [
        "province",
        "city",
        "contactMethods",
        "website",
        "mapDirections",
        "socialFacebook",
        "socialInstagram",
        "socialTwitter",
        "socialTiktok",
        "socialYoutube",
      ],
      ["images", "videos", "termsAccepted"],
    ][targetStep];
    const firstKey = orderByStep?.find((key) => errors[key]) ?? Object.keys(errors)[0];
    const targetId = getFieldId(firstKey);
    if (!targetId) return;
    requestAnimationFrame(() => {
      const el = document.getElementById(targetId);
      // A field folded under "More details (optional)" is opened first.
      el?.closest("details")?.setAttribute("open", "");
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
    const showAddress = hasAddress && publishAddress;
    if (fieldGroup === "D" || fieldGroup === "F") {
      return hasAddress
        ? {
            version: 2,
            methods: ["visit", "online"],
            premises: "standalone_shop",
            publishAddress: showAddress,
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
        publishAddress: showAddress,
      };
    }
    return {
      version: 2,
      methods: ["visit"],
      premises: "standalone_shop",
      publishAddress: showAddress,
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
        contactMethods: activeContactMethods,
        subcategory,
        starRating: "",
        numberOfRooms,
        bookingUrl,
        languagesSpoken,
        priceFrom,
        sleeps,
        bedrooms,
        beds,
        bathrooms,
        cancellationPolicy,
        cancellationFreeDays,
        openingHours,
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
        phone: verifiedPhone,
        whatsapp: verifiedPhone,
        website,
        socialFacebook,
        socialInstagram,
        socialTwitter,
        socialTiktok,
        socialYoutube,
        mapDirections,
        eventType,
        startDate,
        endDate,
        priceZar,
        venueName,
        venueCapacity,
        ticketsUrl,
        doorsOpen,
        refundPolicy,
        refundDays,
        locationAddress,
        locationTown,
        joinMethods,
        meetingPoint,
        pickupAreas,
      },
      photoFiles.length,
      videoFiles.length,
      // A video still being prepared gets its thumbnail at submit at the latest.
      videoThumbnailFile.length || (isVideoPreparing(videoFiles[0]) ? 1 : 0)
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

  /** Paid events only: where tickets are sold, door payment and refunds. */
  function buildPaidEntryDetails(): Record<string, unknown> {
    const details: Record<string, unknown> = {};
    if (ticketSales) details.ticket_sales = ticketSales;
    if (eventSellsAtDoor(ticketSales) && gatePayment.length) details.gate_payment = gatePayment;
    if (refundPolicy) details.refund_policy = refundPolicy;
    if (refundPolicy === "full_until_days" && refundDays.trim()) {
      details.refund_days = Number(refundDays);
    }
    return details;
  }

  /* ── Category details builder (shared by submit + preview) ── */

  function buildTourismCategoryDetails(): Record<string, unknown> {
    const group = TOURISM_SUBCATEGORY_FIELD_GROUPS[subcategory] ?? "";
    const categoryDetails: Record<string, unknown> = {};
    if (subcategory) categoryDetails.subcategory = subcategory;

    // Group A/B: Accommodation & Spa
    if (group === "A" || group === "B") {
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
    // Stays: guests and rooms
    if (group === "A") {
      for (const [key, value] of [
        ["sleeps", sleeps],
        ["bedrooms", bedrooms],
        ["beds", beds],
        ["bathrooms", bathrooms],
      ] as const) {
        if (value.trim()) categoryDetails[key] = Number(value);
      }
    }
    // Attractions: opening hours as one line
    if (group === "E" && openingHours.trim()) categoryDetails.opening_hours = openingHours.trim();
    // Shared fields: "From R___ per night / person / unit / entry fee"
    if (Number(priceFrom) > 0) {
      categoryDetails.price_from_cents = Math.round(Number(priceFrom) * 100);
      categoryDetails.price_unit = priceUnit || defaultPriceUnit(group);
    }
    if (backupUtilities.length) categoryDetails.backup_utilities = backupUtilities;
    if (amenities.length && group !== "D" && group !== "F") {
      categoryDetails.amenities = amenities;
    }
    if (languagesSpoken) categoryDetails.languages_spoken = languagesSpoken;
    if (cancellationPolicy) categoryDetails.cancellation_policy = cancellationPolicy;
    if (cancellationPolicy === "free_until_days" && cancellationFreeDays.trim()) {
      categoryDetails.cancellation_free_days = Number(cancellationFreeDays);
    }
    if (bookingUrl) categoryDetails.booking_url = normalizeUserEnteredUrl(bookingUrl);

    // SA tourism additions
    if (tgcsaGrading) categoryDetails.tgcsa_grading = tgcsaGrading;
    if (minimumStayNights) categoryDetails.minimum_stay_nights = Number(minimumStayNights);
    if (childPolicy) categoryDetails.child_policy = childPolicy;
    if (seasonalPricing) categoryDetails.seasonal_pricing = seasonalPricing;
    if (nearbyAttractions) categoryDetails.nearby_attractions = nearbyAttractions;

    return categoryDetails;
  }

  /* ── Submit ──────────────────────────────────────────────── */

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submissionInFlightRef.current) return;
    setSessionExpired(false);
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
    uploadProgress.reset();
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
            onProgress: uploadProgress.track("photos", photoFiles),
          }).then((urls) => {
            if (photoFiles.length > 0) {
              setUploadStatuses((current) => ({ ...current, photos: "done" }));
            }
            return urls;
          }),
          uploadPromotionVideoFiles({
            files: videoFiles,
            area: uploadArea,
            maxSeconds: videoLimitSeconds(listingType === "event" ? "event" : "other"),
            onProgress: uploadProgress.trackVideo("videos", videoFiles),
          }).then((urls) => {
            if (videoFiles.length > 0) {
              setUploadStatuses((current) => ({ ...current, videos: "done" }));
            }
            return urls;
          }),
          videoCoverForSubmit(videoFiles[0], videoThumbnailFile, photoFiles.length === 0)
            .then((files) =>
              uploadRequiredPromotionMedia({ files, area: uploadArea, field: "video_thumbnail" })
            )
            .then((urls) => urls[0]),
          uploadRequiredPromotionMedia({
            files: logoFiles,
            area: listingType === "tourism_business" ? "business_logo" : "promotion",
            field: "logo_url",
            onProgress: uploadProgress.track("logo", logoFiles),
          }).then((urls) => {
            if (logoFiles.length > 0) {
              setUploadStatuses((current) => ({ ...current, logo: "done" }));
            }
            return urls[0];
          }),
        ]);

      const mediaDimensions = await mediaDimensionsPromise;
      const photoUrls = photosWithVideoCover(
        imageUrls,
        videoUrls.length > 0,
        uploadedVideoThumbnailUrl
      );

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
            youtube: socialYoutube,
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
          cover_photo: photoUrls[0] || undefined,
          cover_video: videoUrls[0] || undefined,
          video_thumbnail: uploadedVideoThumbnailUrl,
          gallery_photos: photoUrls,
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
          website: website || undefined,
          map_directions:
            locationAddress.trim() && publishAddress && mapDirections.trim()
              ? normalizeUserEnteredUrl(mapDirections)
              : undefined,
          social_links: Object.keys(socialLinks).length > 0 ? socialLinks : undefined,
          // Attractions give one opening-hours line on step 2 instead.
          operating_hours:
            fieldGroup !== "E" && Object.keys(operatingHours).length > 0
              ? operatingHours
              : undefined,
          category_details: {
            ...categoryDetails,
            ...(fieldGroup === "C" && joinMethods.includes("meeting_point")
              ? { meeting_point: meetingPoint.trim() }
              : {}),
            customer_access: buildTourismAccess(),
          },
          contact_methods: activeContactMethods,
          termsAccepted,

          trialDays,
        };

        const res = await fetch("/api/businesses", {
          method: "POST",
          headers: withCsrfHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ ...body, ...postFields() }),
        });
        // The new post's id, for the Submitted screen's link (read from a copy of the answer).
        if (res.ok) setSubmittedId(await createdPostId(res));
        const payload = await res.json().catch(() => null);

        if (!res.ok) {
          if (res.status === 401) {
            setSessionExpired(true);
            setFormError(POST_SESSION_EXPIRED_MESSAGE);
            return;
          }

          // Phone-gate: server returns redirectUrl for phone verification
          if (
            res.status === 403 &&
            payload &&
            typeof payload === "object" &&
            typeof (payload as Record<string, unknown>).redirectUrl === "string"
          ) {
            router.push(resolveServerRedirect((payload as Record<string, unknown>).redirectUrl));
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
        if (doorsOpen) eventDetails.doors_open = doorsOpen;
        if (Number(priceZar) > 0) Object.assign(eventDetails, buildPaidEntryDetails());
        if (lineup) eventDetails.lineup = lineup;
        eventDetails.parking_available = parkingAvailable || undefined;
        if (eventAccessibility.length) eventDetails.accessibility = eventAccessibility;
        eventDetails.food_drinks_available = foodDrinksAvailable || undefined;
        if (bringYourOwn) eventDetails.bring_your_own = bringYourOwn;

        // SA event additions
        if (rainPolicy) eventDetails.rain_policy = rainPolicy;
        if (earlyBirdDeadline) eventDetails.early_bird_deadline = earlyBirdDeadline;

        // Links shown on the event page
        if (website.trim()) eventDetails.website = normalizeUserEnteredUrl(website);
        if (mapDirections.trim())
          eventDetails.map_directions = normalizeUserEnteredUrl(mapDirections);
        const eventSocialLinks = Object.fromEntries(
          Object.entries({
            facebook: socialFacebook,
            instagram: socialInstagram,
            twitter: socialTwitter,
            tiktok: socialTiktok,
            youtube: socialYoutube,
          })
            .map(([key, value]) => [key, normalizeUserEnteredUrl(value)] as const)
            .filter(([, value]) => value.length > 0)
        );
        if (Object.keys(eventSocialLinks).length > 0) eventDetails.social_links = eventSocialLinks;

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
          contact_methods: activeContactMethods,
          images: photoUrls,
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
          body: JSON.stringify({ ...body, ...postFields() }),
        });
        // The new post's id, for the Submitted screen's link (read from a copy of the answer).
        if (res.ok) setSubmittedId(await createdPostId(res));
        const payload = await res.json().catch(() => null);

        if (!res.ok) {
          if (res.status === 401) {
            setSessionExpired(true);
            setFormError(POST_SESSION_EXPIRED_MESSAGE);
            return;
          }

          // Phone-gate: server returns redirectUrl for phone verification
          if (
            res.status === 403 &&
            payload &&
            typeof payload === "object" &&
            typeof (payload as Record<string, unknown>).redirectUrl === "string"
          ) {
            router.push(resolveServerRedirect((payload as Record<string, unknown>).redirectUrl));
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
      }

      // The "Submitted" screen replaces the form (see the render below).
      setSubmitSucceeded(true);
      setUploadStatuses((c) => ({ ...c, saving: "done" }));
      discardDraft();
    } catch (error: unknown) {
      // No cover frame could be taken for a post with only a video: the poster picks one.
      if (error instanceof VideoCoverMissingError) {
        const errors = { video_thumbnail: error.message };
        setStep(3);
        setFieldErrors((current) => ({ ...current, ...errors }));
        setFormError(`Please fix 1 field on Step 4 — ${STEPS[3].label}.`);
        focusFirstError(errors, 3);
        return;
      }
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
    resetTourismSpecificFields();
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
    setDoorsOpen("");
    setRefundPolicy("");
    setRefundDays("");
    setTicketSales("");
    setGatePayment([]);
    setRainPolicy("");
    setEarlyBirdDeadline("");
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
    setPublishAddress(false);
    setWebsite("");
    setSocialFacebook("");
    setSocialInstagram("");
    setSocialTwitter("");
    setSocialTiktok("");
    setSocialYoutube("");
    setMapDirections("");
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
    setNumberOfRooms("");
    setAccommodationTypes([]);
    setCheckInTime("");
    setCheckOutTime("");
    setPriceFrom("");
    setPriceUnit("");
    setSleeps("");
    setBedrooms("");
    setBeds("");
    setBathrooms("");
    setBackupUtilities([]);
    setCancellationFreeDays("");
    setOpeningHours("");
    setTgcsaGrading("");
    setMinimumStayNights("");
    setChildPolicy("");
    setSeasonalPricing(false);
    setNearbyAttractions("");
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
          youtube: socialYoutube,
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
        operating_hours:
          fieldGroup !== "E" && Object.keys(operatingHours).length > 0 ? operatingHours : null,
        services_offered: null,
        payment_methods_accepted: null,
        delivery_options: null,
        service_areas: null,
        location_city: city || null,
        location_province: province || null,
        location_town: locationTown || null,
        location_address: publishAddress ? locationAddress || null : null,
        phone: phone || null,
        whatsapp: whatsapp || null,
        website: website || null,
        store_number: null,
        map_directions:
          locationAddress.trim() && publishAddress ? mapDirections.trim() || null : null,
        business_details: {
          type: "standalone_shop" as const,
          street_address: publishAddress ? locationAddress || "" : "",
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
    if (doorsOpen) previewEventDetails.doors_open = doorsOpen;
    if (Number(priceZar) > 0) Object.assign(previewEventDetails, buildPaidEntryDetails());
    if (lineup) previewEventDetails.lineup = lineup;
    previewEventDetails.parking_available = parkingAvailable;
    if (eventAccessibility.length) previewEventDetails.accessibility = eventAccessibility;
    previewEventDetails.food_drinks_available = foodDrinksAvailable;
    if (bringYourOwn) previewEventDetails.bring_your_own = bringYourOwn;
    if (rainPolicy) previewEventDetails.rain_policy = rainPolicy;
    if (earlyBirdDeadline) previewEventDetails.early_bird_deadline = earlyBirdDeadline;
    const previewSocialLinks = Object.fromEntries(
      Object.entries({
        facebook: socialFacebook,
        instagram: socialInstagram,
        twitter: socialTwitter,
        tiktok: socialTiktok,
        youtube: socialYoutube,
      }).filter(([, v]) => v.trim().length > 0)
    );
    if (website.trim()) previewEventDetails.website = website.trim();
    if (mapDirections.trim()) previewEventDetails.map_directions = mapDirections.trim();
    if (Object.keys(previewSocialLinks).length > 0)
      previewEventDetails.social_links = previewSocialLinks;

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
      contact_methods: activeContactMethods,
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

  if (submitSucceeded) {
    return (
      <div className="flex min-h-screen flex-col">
        <Header isAuthenticated />
        <main id="main-content" className="flex-1">
          <div className="container-page py-10">
            <PostSubmittedScreen
              postTitle={title.trim()}
              area="PROMOTIONS_EVENTS"
              postId={submittedId}
            />
          </div>
        </main>
        <Footer showPostBand={false} />
      </div>
    );
  }

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
                description="Required fields are marked."
                breadcrumbs={[
                  { label: "Dashboard", href: "/dashboard" },
                  { label: "Create Post", href: "/post/create" },
                  { label: "Tourism & Events" },
                ]}
                badgeLabel="Tourism & Events"
                area="tourism"
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
                errorAction={sessionExpired && formError ? <PostSignInAction /> : undefined}
                onRetry={
                  formError && !isSubmitting && !sessionExpired
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
                      progress={uploadProgress.values}
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
                          {listingType === "event" ? "Event name" : "Name of your stay or activity"}{" "}
                          *
                        </Label>
                        <span className="text-xs text-muted-foreground" aria-hidden="true">
                          {title.length}/{maxTitleLength}
                        </span>
                      </div>
                      <p id="title-length" className="sr-only">
                        {title.length} of {maxTitleLength} characters
                      </p>
                      <Input
                        id="title"
                        value={title}
                        maxLength={maxTitleLength}
                        onChange={(e) => {
                          setTitle(e.target.value.slice(0, maxTitleLength));
                          clearErrors("title");
                        }}
                        placeholder={
                          listingType === "event"
                            ? "e.g. Cape Town Jazz Festival 2026"
                            : "e.g. Kruger Sunset Lodge"
                        }
                        aria-invalid={!!fieldErrors.title}
                        aria-describedby={`title-length${fieldErrors.title ? " title-error" : ""}`}
                      />
                      {fieldErrors.title && (
                        <p id="title-error" className="inline-form-error">
                          {fieldErrors.title}
                        </p>
                      )}
                    </div>

                    {/* Description */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="description">Description *</Label>
                        <span className="text-xs text-muted-foreground" aria-hidden="true">
                          {description.length}/{maxDescriptionLength}
                        </span>
                      </div>
                      <p id="description-length" className="sr-only">
                        {description.length} of {maxDescriptionLength} characters
                      </p>
                      <Textarea
                        id="description"
                        value={description}
                        maxLength={maxDescriptionLength}
                        onChange={(e) => {
                          setDescription(e.target.value.slice(0, maxDescriptionLength));
                          clearErrors("description");
                        }}
                        rows={5}
                        placeholder={
                          listingType === "event"
                            ? "Tell people about the event — what to expect, who should attend, highlights..."
                            : "Describe your accommodation, services, what makes it special..."
                        }
                        aria-invalid={!!fieldErrors.description}
                        aria-describedby={`description-length${fieldErrors.description ? " description-error" : ""}`}
                      />
                      {fieldErrors.description && (
                        <p id="description-error" className="inline-form-error">
                          {fieldErrors.description}
                        </p>
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

                        {/* ── Always visible: price, stay size, attraction hours ── */}
                        {fieldGroup && (
                          <div className="space-y-4">
                            <div className="space-y-2">
                              <Label htmlFor="priceFrom">Price</Label>
                              <div className="flex flex-wrap items-center gap-2 text-sm">
                                <span aria-hidden="true">From R</span>
                                <Input
                                  id="priceFrom"
                                  type="number"
                                  inputMode="decimal"
                                  min={0}
                                  step="0.01"
                                  className="w-32"
                                  value={priceFrom}
                                  onChange={(e) => {
                                    setPriceFrom(e.target.value);
                                    clearErrors("priceFrom");
                                  }}
                                  placeholder="450"
                                  aria-invalid={!!fieldErrors.priceFrom}
                                />
                                <select
                                  id="priceUnit"
                                  aria-label="Price is"
                                  className={`${SELECT_CLASS} w-auto`}
                                  value={priceUnit || defaultPriceUnit(fieldGroup)}
                                  onChange={(e) => setPriceUnit(e.target.value)}
                                >
                                  {TOURISM_PRICE_UNITS.map((unit) => (
                                    <option key={unit.value} value={unit.value}>
                                      {unit.label}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              {fieldErrors.priceFrom && (
                                <p className="inline-form-error">{fieldErrors.priceFrom}</p>
                              )}
                            </div>

                            {fieldGroup === "A" && (
                              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                                {(
                                  [
                                    ["sleeps", "Sleeps", sleeps, setSleeps, 1],
                                    ["bedrooms", "Bedrooms", bedrooms, setBedrooms, 0],
                                    ["beds", "Beds", beds, setBeds, 0],
                                    ["bathrooms", "Bathrooms", bathrooms, setBathrooms, 0],
                                  ] as const
                                ).map(([id, label, value, setter, min]) => (
                                  <div key={id} className="space-y-2">
                                    <Label htmlFor={id}>{label}</Label>
                                    <Input
                                      id={id}
                                      type="number"
                                      inputMode="numeric"
                                      min={min}
                                      step={1}
                                      value={value}
                                      onChange={(e) => {
                                        setter(e.target.value);
                                        clearErrors(id);
                                      }}
                                      aria-invalid={!!fieldErrors[id]}
                                    />
                                    {fieldErrors[id] && (
                                      <p className="inline-form-error">{fieldErrors[id]}</p>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}

                            {fieldGroup === "E" && (
                              <div className="space-y-2">
                                <Label htmlFor="openingHours">Opening hours</Label>
                                <Input
                                  id="openingHours"
                                  value={openingHours}
                                  maxLength={120}
                                  onChange={(e) => {
                                    setOpeningHours(e.target.value.slice(0, 120));
                                    clearErrors("openingHours");
                                  }}
                                  placeholder="e.g. Daily 08:00 to 17:00"
                                  aria-invalid={!!fieldErrors.openingHours}
                                />
                                {fieldErrors.openingHours && (
                                  <p className="inline-form-error">{fieldErrors.openingHours}</p>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {fieldGroup && (
                          <details className="rounded-xl border border-border p-4">
                            <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold">
                              More details (optional)
                            </summary>
                            <div className="mt-4 space-y-6">
                              {/* ── Group A / B: Accommodation & Spa ── */}
                              {(fieldGroup === "A" || fieldGroup === "B") && (
                                <>
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
                                      <p className="inline-form-error">
                                        {fieldErrors.numberOfRooms}
                                      </p>
                                    )}
                                  </div>

                                  {/* Accommodation types */}
                                  <fieldset className="space-y-2">
                                    <legend className="text-sm font-medium">
                                      Accommodation Types
                                    </legend>
                                    <p className="text-xs text-muted-foreground">
                                      Select all accommodation styles you offer.
                                    </p>
                                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                                      {TOURISM_ACCOMMODATION_TYPES.map((type) => (
                                        <label
                                          key={type}
                                          className="flex items-center gap-2 text-sm"
                                        >
                                          <input
                                            type="checkbox"
                                            checked={accommodationTypes.includes(type)}
                                            onChange={() =>
                                              toggleArrayItem(setAccommodationTypes, type)
                                            }
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
                                    <legend className="text-sm font-medium">Meal options</legend>
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
                                      <legend className="text-sm font-medium">
                                        Activity Types
                                      </legend>
                                      <p className="text-xs text-muted-foreground">
                                        Select the activities included in your offering.
                                      </p>
                                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                                        {TOURISM_ACTIVITY_TYPES[subcategory].map((a) => (
                                          <label
                                            key={a}
                                            className="flex items-center gap-2 text-sm"
                                          >
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
                                    <Label htmlFor="tourDuration">Tour duration</Label>
                                    <p className="text-xs text-muted-foreground">
                                      Typical length of the tour or experience.
                                    </p>
                                    <select
                                      id="tourDuration"
                                      value={tourDuration}
                                      onChange={(e) => setTourDuration(e.target.value)}
                                      className={SELECT_CLASS}
                                      aria-label="Tour duration"
                                    >
                                      <option value="">Select...</option>
                                      {TOURISM_TOUR_DURATIONS.map((d) => (
                                        <option key={d.value} value={d.value}>
                                          {d.label}
                                        </option>
                                      ))}
                                    </select>
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
                                      <Label htmlFor="difficultyLevel">Difficulty level</Label>
                                      <p className="text-xs text-muted-foreground">
                                        Physical effort required for this activity.
                                      </p>
                                      <select
                                        id="difficultyLevel"
                                        value={difficultyLevel}
                                        onChange={(e) => setDifficultyLevel(e.target.value)}
                                        className={SELECT_CLASS}
                                        aria-label="Difficulty level"
                                      >
                                        <option value="">Select...</option>
                                        {TOURISM_DIFFICULTY_LEVELS.map((d) => (
                                          <option key={d.value} value={d.value}>
                                            {d.label}
                                          </option>
                                        ))}
                                      </select>
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
                                      Equipment provided
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
                                    <Label htmlFor="tourismAgeRestriction">Age restriction</Label>
                                    <p className="text-xs text-muted-foreground">
                                      Minimum age requirement, if any.
                                    </p>
                                    <select
                                      id="tourismAgeRestriction"
                                      value={tourismAgeRestriction}
                                      onChange={(e) => setTourismAgeRestriction(e.target.value)}
                                      className={SELECT_CLASS}
                                      aria-label="Age restriction"
                                    >
                                      <option value="">No restriction</option>
                                      {TOURISM_AGE_RESTRICTIONS.map((a) => (
                                        <option key={a.value} value={a.value}>
                                          {a.label}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                </>
                              )}

                              {/* ── Group D: Travel Agency ── */}
                              {fieldGroup === "D" && (
                                <>
                                  {/* Services offered */}
                                  <fieldset className="space-y-2">
                                    <legend className="text-sm font-medium">
                                      Services Offered
                                    </legend>
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
                                            onChange={() =>
                                              toggleArrayItem(setTourismSpecializations, s)
                                            }
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
                                      Guided tours available
                                    </label>
                                    <label className="flex items-center gap-2 text-sm">
                                      <input
                                        type="checkbox"
                                        checked={audioGuide}
                                        onChange={(e) => setAudioGuide(e.target.checked)}
                                        className="rounded border-gray-300"
                                      />
                                      Audio guide available
                                    </label>
                                  </div>

                                  {/* Visit duration */}
                                  <div className="space-y-2">
                                    <Label htmlFor="visitDuration">Typical visit duration</Label>
                                    <p className="text-xs text-muted-foreground">
                                      How long a typical visit takes.
                                    </p>
                                    <select
                                      id="visitDuration"
                                      value={visitDuration}
                                      onChange={(e) => setVisitDuration(e.target.value)}
                                      className={SELECT_CLASS}
                                      aria-label="Typical visit duration"
                                    >
                                      <option value="">Select...</option>
                                      {TOURISM_VISIT_DURATIONS.map((d) => (
                                        <option key={d.value} value={d.value}>
                                          {d.label}
                                        </option>
                                      ))}
                                    </select>
                                  </div>

                                  {/* Age restriction */}
                                  <div className="space-y-2">
                                    <Label htmlFor="tourismAgeRestrictionAttr">
                                      Age restriction
                                    </Label>
                                    <p className="text-xs text-muted-foreground">
                                      Minimum age requirement, if any.
                                    </p>
                                    <select
                                      id="tourismAgeRestrictionAttr"
                                      value={tourismAgeRestriction}
                                      onChange={(e) => setTourismAgeRestriction(e.target.value)}
                                      className={SELECT_CLASS}
                                      aria-label="Age restriction"
                                    >
                                      <option value="">No restriction</option>
                                      {TOURISM_AGE_RESTRICTIONS.map((a) => (
                                        <option key={a.value} value={a.value}>
                                          {a.label}
                                        </option>
                                      ))}
                                    </select>
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
                                      Insurance included
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
                                  {/* Amenities (not for D/F) */}
                                  {fieldGroup !== "D" && fieldGroup !== "F" && (
                                    <fieldset className="space-y-2">
                                      <legend className="text-sm font-medium">Amenities</legend>
                                      <p className="text-xs text-muted-foreground">
                                        Select all facilities and amenities available on site.
                                      </p>
                                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                                        {TOURISM_AMENITIES.map((a) => (
                                          <label
                                            key={a}
                                            className="flex items-center gap-2 text-sm"
                                          >
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
                                    <Label htmlFor="cancellationPolicy">Cancellation policy</Label>
                                    <p className="text-xs text-muted-foreground">
                                      Your standard terms for cancellations and refunds.
                                    </p>
                                    <select
                                      id="cancellationPolicy"
                                      value={cancellationPolicy}
                                      onChange={(e) => setCancellationPolicy(e.target.value)}
                                      className={SELECT_CLASS}
                                      aria-label="Cancellation policy"
                                    >
                                      <option value="">Select...</option>
                                      {TOURISM_CANCELLATION_CHOICES.map((c) => (
                                        <option key={c.value} value={c.value}>
                                          {c.label}
                                        </option>
                                      ))}
                                    </select>
                                    {cancellationPolicy === "free_until_days" && (
                                      <div className="flex flex-wrap items-center gap-2 text-sm">
                                        <Label htmlFor="cancellationFreeDays" required>
                                          Free cancellation until
                                        </Label>
                                        <Input
                                          id="cancellationFreeDays"
                                          type="number"
                                          inputMode="numeric"
                                          min={1}
                                          max={365}
                                          step={1}
                                          className="w-24"
                                          value={cancellationFreeDays}
                                          onChange={(e) => {
                                            setCancellationFreeDays(e.target.value);
                                            clearErrors("cancellationFreeDays");
                                          }}
                                          aria-invalid={!!fieldErrors.cancellationFreeDays}
                                        />
                                        <span>days before</span>
                                      </div>
                                    )}
                                    {fieldErrors.cancellationFreeDays && (
                                      <p className="inline-form-error">
                                        {fieldErrors.cancellationFreeDays}
                                      </p>
                                    )}
                                  </div>

                                  {/* Backup power and water */}
                                  <fieldset className="space-y-2">
                                    <legend className="text-sm font-medium">
                                      Backup power and water
                                    </legend>
                                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                                      {TOURISM_BACKUP_UTILITIES.map((item) => (
                                        <label
                                          key={item.value}
                                          className="flex min-h-11 items-center gap-2 text-sm"
                                        >
                                          <input
                                            type="checkbox"
                                            checked={backupUtilities.includes(item.value)}
                                            onChange={() =>
                                              toggleArrayItem(setBackupUtilities, item.value)
                                            }
                                            className="rounded border-gray-300"
                                          />
                                          {item.label}
                                        </label>
                                      ))}
                                    </div>
                                  </fieldset>

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
                                    <p className="text-sm font-medium">
                                      South African Tourism Details
                                    </p>
                                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                      <div className="space-y-1">
                                        <Label htmlFor="tgcsaGrading">TGCSA Grading</Label>
                                        <select
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
                                        </select>
                                        <p className="text-xs text-muted-foreground">
                                          Tourism Grading Council SA rating.
                                        </p>
                                      </div>

                                      <div className="space-y-1">
                                        <Label htmlFor="minimumStayNights">Minimum stay</Label>
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
                                      <Label htmlFor="childPolicy">Child policy</Label>
                                      <select
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
                                      </select>
                                    </div>

                                    <div className="space-y-1">
                                      <Label htmlFor="nearbyAttractions">Nearby attractions</Label>
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
                            </div>
                          </details>
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
                        <div className="space-y-2">
                          <Label htmlFor="doorsOpen">Doors open</Label>
                          <Input
                            id="doorsOpen"
                            type="time"
                            className="w-40"
                            value={doorsOpen}
                            onChange={(e) => {
                              setDoorsOpen(e.target.value);
                              clearErrors("doorsOpen");
                            }}
                            aria-invalid={!!fieldErrors.doorsOpen}
                          />
                          {fieldErrors.doorsOpen && (
                            <p className="inline-form-error">{fieldErrors.doorsOpen}</p>
                          )}
                        </div>
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
                          <legend className="text-sm font-medium">Entry (Required)</legend>
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                            <label className="inline-flex min-h-11 items-center gap-2">
                              <input
                                type="radio"
                                name="entry"
                                aria-label="Free entry"
                                checked={priceZar === "0"}
                                onChange={() => {
                                  if (Number(priceZar) > 0) paidPriceRef.current = priceZar;
                                  setEntryChoice("free");
                                  setPriceZar("0");
                                  setNegotiable(false);
                                  clearErrors("priceZar");
                                }}
                              />
                              Free
                            </label>
                            <label className="inline-flex min-h-11 items-center gap-2">
                              <input
                                type="radio"
                                name="entry"
                                aria-label="Paid entry"
                                checked={
                                  (entryChoice === "paid" && priceZar !== "0") ||
                                  Number(priceZar) > 0
                                }
                                onChange={() => {
                                  setEntryChoice("paid");
                                  setPriceZar(paidPriceRef.current);
                                  setNegotiable(false);
                                }}
                              />
                              Paid
                            </label>
                            {(entryChoice === "paid" || Number(priceZar) > 0) &&
                              priceZar !== "0" && (
                                <span className="inline-flex items-center gap-2">
                                  <span aria-hidden="true">from R</span>
                                  <Input
                                    id="priceZar"
                                    type="number"
                                    inputMode="decimal"
                                    min={0}
                                    step="0.01"
                                    className="w-32"
                                    aria-label="Entry price from (R)"
                                    value={priceZar}
                                    onChange={(e) => {
                                      setPriceZar(e.target.value);
                                      clearErrors("priceZar");
                                    }}
                                    aria-invalid={!!fieldErrors.priceZar}
                                  />
                                </span>
                              )}
                          </div>
                          {fieldErrors.priceZar && (
                            <p className="inline-form-error">{fieldErrors.priceZar}</p>
                          )}
                        </fieldset>
                        {(entryChoice === "paid" || Number(priceZar) > 0) && priceZar !== "0" && (
                          <>
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

                            {/* Where to buy tickets */}
                            <fieldset className="space-y-2">
                              <legend className="text-sm font-medium">
                                Where to buy tickets (Optional)
                              </legend>
                              <div className="flex flex-wrap gap-x-4">
                                {EVENT_TICKET_SALES.map((option) => (
                                  <label
                                    key={option.value}
                                    className="inline-flex min-h-11 items-center gap-2 text-sm"
                                  >
                                    <input
                                      type="radio"
                                      name="ticketSales"
                                      checked={ticketSales === option.value}
                                      onChange={() => setTicketSales(option.value)}
                                    />
                                    {option.label}
                                  </label>
                                ))}
                              </div>
                              {eventSellsAtDoor(ticketSales) && (
                                <div className="flex flex-wrap items-center gap-x-4">
                                  <span className="text-sm text-muted-foreground">
                                    Pay at the door:
                                  </span>
                                  {EVENT_GATE_PAYMENTS.map((option) => (
                                    <label
                                      key={option.value}
                                      className="inline-flex min-h-11 items-center gap-2 text-sm"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={gatePayment.includes(option.value)}
                                        onChange={() =>
                                          toggleArrayItem(setGatePayment, option.value)
                                        }
                                        className="rounded border-gray-300"
                                      />
                                      {option.label}
                                    </label>
                                  ))}
                                </div>
                              )}
                            </fieldset>

                            {/* Refunds */}
                            <div className="space-y-2">
                              <Label htmlFor="refundPolicy">Refunds</Label>
                              <select
                                id="refundPolicy"
                                className={SELECT_CLASS}
                                value={refundPolicy}
                                onChange={(e) => {
                                  setRefundPolicy(e.target.value);
                                  clearErrors("refundDays");
                                }}
                              >
                                <option value="">Select...</option>
                                {EVENT_REFUND_POLICIES.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                              {refundPolicy === "full_until_days" && (
                                <div className="flex flex-wrap items-center gap-2 text-sm">
                                  <Label htmlFor="refundDays" required>
                                    Full refund until
                                  </Label>
                                  <Input
                                    id="refundDays"
                                    type="number"
                                    inputMode="numeric"
                                    min={1}
                                    max={365}
                                    step={1}
                                    className="w-24"
                                    value={refundDays}
                                    onChange={(e) => {
                                      setRefundDays(e.target.value);
                                      clearErrors("refundDays");
                                    }}
                                    aria-invalid={!!fieldErrors.refundDays}
                                  />
                                  <span>days before</span>
                                </div>
                              )}
                              {fieldErrors.refundDays && (
                                <p className="inline-form-error">{fieldErrors.refundDays}</p>
                              )}
                            </div>
                          </>
                        )}
                        {/* Age restriction */}
                        <div className="space-y-2">
                          <Label htmlFor="ageRestriction">Age restriction</Label>
                          <p className="text-xs text-muted-foreground">
                            Minimum age for attendees, if any.
                          </p>
                          <select
                            id="ageRestriction"
                            value={ageRestriction}
                            onChange={(e) => setAgeRestriction(e.target.value)}
                            className={SELECT_CLASS}
                            aria-label="Age restriction"
                          >
                            <option value="">No restriction</option>
                            {EVENT_AGE_RESTRICTIONS.map((a) => (
                              <option key={a.value} value={a.value}>
                                {a.label}
                              </option>
                            ))}
                          </select>
                          {eventChecksId(ageRestriction) && (
                            <p className="text-sm font-medium">{EVENT_ID_CHECK_LINE}</p>
                          )}
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
                              <Label htmlFor="rainPolicy">Rain Policy</Label>
                              <select
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
                              </select>
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
                        clearErrors("province", "city", "locationAddress");
                      }}
                      showTown
                      showAddress
                      errors={{
                        province: fieldErrors.province,
                        city: fieldErrors.city,
                      }}
                    />

                    {listingType === "tourism_business" && (
                      <div className="space-y-1">
                        <label className="flex min-h-11 items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={publishAddress}
                            onChange={(e) => setPublishAddress(e.target.checked)}
                            className="rounded border-gray-300"
                          />
                          Show my exact visitor address publicly
                        </label>
                        <p className="text-xs text-muted-foreground">
                          If you leave this off, only your area is published.
                        </p>
                      </div>
                    )}

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

                    <ContactSwitches
                      id="tourism-contact-methods"
                      options={CONTACT_OPTIONS}
                      selected={contactMethods}
                      onChange={(next) => {
                        setContactMethods(next);
                        clearErrors("contactMethods");
                      }}
                      verifiedPhone={verifiedPhone}
                      error={fieldErrors.contactMethods}
                    />

                    <OnlinePresenceFields
                      values={{
                        website,
                        mapDirections,
                        socialFacebook,
                        socialInstagram,
                        socialTwitter,
                        socialTiktok,
                        socialYoutube,
                      }}
                      onChange={(field, value) => {
                        ({
                          website: setWebsite,
                          mapDirections: setMapDirections,
                          socialFacebook: setSocialFacebook,
                          socialInstagram: setSocialInstagram,
                          socialTwitter: setSocialTwitter,
                          socialTiktok: setSocialTiktok,
                          socialYoutube: setSocialYoutube,
                        })[field](value);
                        clearErrors(field);
                      }}
                      errors={fieldErrors}
                      description={
                        listingType === "event"
                          ? "Optional. Help people check your event online and find the venue on a map."
                          : undefined
                      }
                      mapPinHint={
                        listingType === "event"
                          ? "Open Google Maps, drop a pin on the venue, tap Share and paste the link here."
                          : undefined
                      }
                      mapPinUnavailableReason={
                        listingType === "tourism_business" &&
                        !(locationAddress.trim() && publishAddress)
                          ? "Add your address above and choose to show it publicly to show a location pin. Otherwise only your area is published."
                          : undefined
                      }
                    />

                    {/* Operating hours (tourism business only; attractions give one line on step 2) */}
                    {listingType === "tourism_business" && fieldGroup !== "E" && (
                      <div className="space-y-3">
                        <p className="text-sm font-medium">Opening hours</p>
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
                      description={`${PHOTO_OR_VIDEO_RULE} The first photo is the cover. With only a video, the frame you choose becomes the first photo.`}
                    >
                      {/* Photos */}
                      <div className="space-y-2">
                        <p className="text-sm font-medium">Photos</p>
                        <MediaLimitsLine kind={listingType === "event" ? "event" : "other"} />
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
                          Video
                          {!videoAllowed ? " — Upgrade to unlock" : ""}
                        </p>
                        <MediaUpload
                          id="tourism-videos-input"
                          label="Upload video"
                          description={`Up to ${maxVideos}. One portrait 9:16 clip works best. ${VIDEO_SOUND_OFF_TIP}`}
                          error={fieldErrors.videos}
                          maxFiles={maxVideos}
                          maxVideoSeconds={videoLimitSeconds(
                            listingType === "event" ? "event" : "other"
                          )}
                          files={videoFiles}
                          onChange={(files) => {
                            setVideoFiles(files);
                            prewarmVideosForFastUpload(files);
                            setVideoThumbnailFile([]);
                            clearErrors("videos");
                          }}
                          accept="video/*"
                          previewShape="wide"
                          disabled={!videoAllowed}
                        />
                        {!videoAllowed && (
                          <p className="text-xs">
                            <Link
                              href="/billing"
                              className="font-semibold text-teal-700 underline underline-offset-2 dark:text-teal-300"
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
                            prepareVideo={prepareVideoForCover}
                            autoSelect={videoThumbnailFile.length === 0}
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
                            <div className="flex aspect-[4/1] items-center justify-center bg-gradient-to-r from-teal-200/70 to-teal-50 dark:from-teal-900/60 dark:to-teal-950/40">
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
                      <PostingTermsConsent
                        id="tourism-terms-checkbox"
                        checked={termsAccepted}
                        onCheckedChange={(checked) => {
                          setTermsAccepted(checked);
                          clearErrors("termsAccepted");
                        }}
                        error={fieldErrors.termsAccepted}
                        subject="tourism or event post"
                        accent="teal"
                      />
                    </PostFormSection>
                    {renderPreview()}
                  </div>
                )}
              </PostFormScaffold>
            </form>
          </PlanGate>
        </div>
      </main>
      <Footer showPostBand={false} />
    </div>
  );
}
