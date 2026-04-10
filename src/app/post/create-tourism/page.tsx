"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Camera, MapPin, TreePalm, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { MediaUpload } from "@/components/ui/media-upload";
import { VideoFrameSelector } from "@/components/ui/video-frame-selector";
import { MediaCropPreview, type CropPosition } from "@/components/ui/media-crop-preview";
import {
  PlanGate,
  usePlanMaxPhotos,
  usePlanMaxVideos,
  usePlanVideoAllowed,
  usePlanCoverVideoAllowed,
} from "@/components/billing/plan-gate";
import { LocationSelector, type LocationValue } from "@/components/ui/location-selector";
import {
  TOURISM_SUBCATEGORIES,
  TOURISM_AMENITIES,
  TOURISM_MEAL_OPTIONS,
  TOURISM_PRICE_RANGES,
  TOURISM_CANCELLATION_POLICIES,
  TOURISM_ACCOMMODATION_TYPES,
  EVENT_TYPES,
  EVENT_AGE_RESTRICTIONS,
  EVENT_ACCESSIBILITY_OPTIONS,
} from "@/lib/constants/categories";
import { cn } from "@/lib/utils";
import {
  PostFormFooter,
  PostFormScaffold,
  type PostFormStep,
} from "@/components/post/post-form-scaffold";
import {
  normalizeCreatePostError,
  normalizeCreatePostRuntimeError,
} from "@/app/post/_lib/create-post-errors";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { usePostDraftAutosave } from "@/hooks/use-post-draft-autosave";
import { validateTourismStep } from "@/lib/forms/tourism-form";
import type { TourismListingType } from "@/types/tourism-details";
import type { PromotionSocialAuthorizationInput } from "@/lib/promotions/social-authorization";
import { SocialAuthorizationFields } from "@/components/promotions/social-authorization-fields";
import {
  OperatingHoursInput,
  formatHoursValue,
  parseHoursValue,
} from "@/components/ui/operating-hours-input";
import { ensureCsrfTokenReady, withCsrfHeaders } from "@/lib/utils/csrf";
import { fetchWithRetry } from "@/lib/utils/fetch-retry";
import { checkUploadServiceReachable } from "@/lib/utils/upload-preflight";
import { readMediaDimensions } from "@/lib/utils/media-metadata";
import { getDefaultEventDates } from "@/lib/post-drafts/defaults";
import type { TourismDraftData } from "@/lib/post-drafts/storage";

const SELECT_CLASS =
  "flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:h-10 sm:text-sm";

const STEPS: PostFormStep[] = [
  {
    label: "Type & Basics",
    icon: TreePalm,
    description: "Choose listing type, title, and category",
  },
  { label: "Details", icon: ClipboardList, description: "Industry-specific details and features" },
  {
    label: "Location & Contact",
    icon: MapPin,
    description: "Address, contact info, and operating hours",
  },
  { label: "Media & Review", icon: Camera, description: "Photos, video, and final review" },
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
  phone: "phone",
  whatsapp: "whatsapp",
  email: "email",
  website: "website",
  images: "tourism-images",
  videos: "tourism-videos",
};

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

function CreateTourismContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { user, profile, isLoading } = useAuth();

  /* ── Step & error state ──────────────────────────────────── */
  const [step, setStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitProgress, setSubmitProgress] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitSucceeded, setSubmitSucceeded] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  /* ── Shared state ────────────────────────────────────────── */
  const [listingType, setListingType] = useState<TourismListingType>("tourism_business");
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
  const [petsAllowed, setPetsAllowed] = useState(false);
  const [smokingAllowed, setSmokingAllowed] = useState(false);
  const [hoursMonFri, setHoursMonFri] = useState("");
  const [hoursSat, setHoursSat] = useState("");
  const [hoursSun, setHoursSun] = useState("");

  /* ── Event state ─────────────────────────────────────────── */
  const [eventType, setEventType] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [priceZar, setPriceZar] = useState("");
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
  const [socialAuthorization, setSocialAuthorization] = useState<PromotionSocialAuthorizationInput>(
    {
      granted: false,
    }
  );

  /* ── Media state ─────────────────────────────────────────── */
  const [logoFiles, setLogoFiles] = useState<File[]>([]);
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [videoFiles, setVideoFiles] = useState<File[]>([]);
  const [videoThumbnailFile, setVideoThumbnailFile] = useState<File[]>([]);
  const [focalPoint, setFocalPoint] = useState<CropPosition>({ x: 0.5, y: 0.5 });

  /* ── Derived ─────────────────────────────────────────────── */
  const {
    save: saveDraft,
    restore: restoreDraft,
    discard: discardDraft,
  } = usePostDraftAutosave<TourismDraftData>("tourism", user?.id, !isLoading);

  const locationValue: LocationValue = {
    province,
    city,
    town: locationTown,
    address: locationAddress,
  };
  const maxPhotos = usePlanMaxPhotos("PROMOTIONS_EVENTS");
  const maxVideos = usePlanMaxVideos("PROMOTIONS_EVENTS");
  const videoAllowed = usePlanVideoAllowed("PROMOTIONS_EVENTS");
  const _coverVideoAllowed = usePlanCoverVideoAllowed("PROMOTIONS_EVENTS");

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

  // Pre-fill location from profile
  useEffect(() => {
    if (!profile) return;
    if (!province && profile.location_province) setProvince(profile.location_province);
    if (!city && profile.location_city && (!province || province === profile.location_province)) {
      setCity(profile.location_city);
    }
  }, [profile, province, city]);

  // Default event dates
  useEffect(() => {
    if (listingType !== "event") return;
    const defaults = getDefaultEventDates(startDate, endDate);
    if (!startDate) setStartDate(defaults.startDate);
    if (!endDate) setEndDate(defaults.endDate);
  }, [listingType, startDate, endDate]);

  // Restore draft
  useEffect(() => {
    if (!user?.id || isLoading) return;
    const draft = restoreDraft();
    if (!draft) return;
    setStep(draft.step);
    const d = draft.data;
    if (d.listingType) setListingType(d.listingType as TourismListingType);
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
    if (d.socialAuthorization) setSocialAuthorization(d.socialAuthorization);
    toast({ title: "Draft restored", description: "Continuing where you left off." });
  }, [user?.id, isLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save draft
  useEffect(() => {
    if (!user?.id || isLoading || isSubmitting || submitSucceeded) return;
    saveDraft(step, {
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
      socialAuthorization,
    });
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
    socialAuthorization,
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

  function focusFirstError(errors: Record<string, string>, _targetStep = step) {
    const firstKey = Object.keys(errors)[0];
    const targetId = FIELD_IDS[firstKey];
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
        socialAuthorization: targetStep === 3 ? socialAuthorization : { granted: false },
      },
      photoFiles.length
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
    }

    return errors;
  }

  /* ── Submit ──────────────────────────────────────────────── */

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const stepErrors = [0, 1, 2, 3].map((index) => validateStep(index));
    const firstInvalidStep = stepErrors.findIndex((e) => Object.keys(e).length > 0);
    if (firstInvalidStep !== -1) {
      setStep(firstInvalidStep);
      setFieldErrors(stepErrors[firstInvalidStep]);
      setFormError("Please fix the highlighted fields.");
      focusFirstError(stepErrors[firstInvalidStep], firstInvalidStep);
      return;
    }

    clearErrors();
    setIsSubmitting(true);
    setSubmitProgress("Checking upload service...");

    try {
      const csrfToken = await ensureCsrfTokenReady();
      if (!csrfToken) {
        setFormError("Security check failed. Please refresh the page and try again.");
        return;
      }
      try {
        await checkUploadServiceReachable();
      } catch {
        /* logged inside */
      }

      setSubmitProgress("Uploading media...");

      const readUploadError = async (response: Response, fallback: string): Promise<string> => {
        const payload = (await response.json().catch(() => null)) as {
          error?: unknown;
          traceId?: unknown;
        } | null;
        const payloadError =
          payload && typeof payload.error === "string" ? payload.error.trim() : "";
        const traceId =
          payload && typeof payload.traceId === "string" ? payload.traceId.trim() : "";
        if (payloadError && traceId) return `${payloadError} (trace: ${traceId})`;
        if (payloadError) return payloadError;
        return `${fallback} (HTTP ${response.status})`;
      };

      const uploadArea = listingType === "tourism_business" ? "business" : "promotion";

      let compressedVideoFileRef: File | null = null;
      const [imageUrls, videoUrls, uploadedVideoThumbnailUrl, uploadedLogoUrl] = await Promise.all([
        // Photos
        photoFiles.length > 0
          ? (async () => {
              const fd = new FormData();
              fd.append("area", uploadArea);
              photoFiles.forEach((f) => fd.append("files", f));
              const res = await fetchWithRetry("/api/media/upload", {
                method: "POST",
                headers: withCsrfHeaders(),
                body: fd,
              });
              if (!res.ok) throw new Error(await readUploadError(res, "Failed to upload photos"));
              const json = await res.json();
              return (json.urls || []) as string[];
            })()
          : Promise.resolve([] as string[]),
        // Videos
        videoFiles.length > 0
          ? (async () => {
              setSubmitProgress("Compressing video...");
              const { compressVideoForUpload } = await import("@/lib/media/compress-before-upload");
              const compressed: File[] = [];
              for (const f of videoFiles) compressed.push(await compressVideoForUpload(f));
              compressedVideoFileRef = compressed[0] ?? null;
              setSubmitProgress("Uploading media...");
              return Promise.all(
                compressed.map(async (file) => {
                  const urlRes = await fetchWithRetry("/api/media/upload-url", {
                    method: "POST",
                    headers: withCsrfHeaders({ "Content-Type": "application/json" }),
                    body: JSON.stringify({
                      filename: file.name,
                      contentType: file.type,
                      size: file.size,
                      area: uploadArea,
                    }),
                  });
                  if (!urlRes.ok)
                    throw new Error(
                      await readUploadError(urlRes, "Failed to get video upload URL")
                    );
                  const { uploadUrl, publicUrl } = await urlRes.json();
                  const putRes = await fetchWithRetry(uploadUrl, {
                    method: "PUT",
                    headers: { "Content-Type": file.type },
                    body: file,
                  });
                  if (!putRes.ok) throw new Error(`Failed to upload video (HTTP ${putRes.status})`);
                  return publicUrl as string;
                })
              );
            })()
          : Promise.resolve([] as string[]),
        // Video thumbnail
        videoThumbnailFile.length > 0
          ? (async () => {
              const fd = new FormData();
              fd.append("area", uploadArea);
              fd.append("files", videoThumbnailFile[0]);
              const res = await fetchWithRetry("/api/media/upload", {
                method: "POST",
                headers: withCsrfHeaders(),
                body: fd,
              });
              if (!res.ok) return undefined;
              const json = await res.json();
              return json.urls?.[0] as string | undefined;
            })()
          : Promise.resolve(undefined as string | undefined),
        // Logo (tourism business only)
        listingType === "tourism_business" && logoFiles.length > 0
          ? (async () => {
              const fd = new FormData();
              fd.append("area", "business_logo");
              fd.append("files", logoFiles[0]);
              const res = await fetchWithRetry("/api/media/upload", {
                method: "POST",
                headers: withCsrfHeaders(),
                body: fd,
              });
              if (!res.ok) return undefined;
              const json = await res.json();
              return json.urls?.[0] as string | undefined;
            })()
          : Promise.resolve(undefined as string | undefined),
      ]);

      const primaryMediaFile = compressedVideoFileRef ?? videoFiles[0] ?? photoFiles[0] ?? null;
      const mediaDimensions = primaryMediaFile ? await readMediaDimensions(primaryMediaFile) : null;

      if (listingType === "tourism_business") {
        setSubmitProgress("Saving tourism business...");

        const categoryDetails: Record<string, unknown> = {};
        if (subcategory) categoryDetails.subcategory = subcategory;
        if (starRating) categoryDetails.star_rating = Number(starRating);
        if (numberOfRooms) categoryDetails.number_of_rooms = Number(numberOfRooms);
        if (accommodationTypes.length) categoryDetails.accommodation_types = accommodationTypes;
        if (checkInTime) categoryDetails.check_in_time = checkInTime;
        if (checkOutTime) categoryDetails.check_out_time = checkOutTime;
        if (priceRange) categoryDetails.price_range = priceRange;
        if (amenities.length) categoryDetails.amenities = amenities;
        if (mealOptions.length) categoryDetails.meal_options = mealOptions;
        if (languagesSpoken) categoryDetails.languages_spoken = languagesSpoken;
        if (cancellationPolicy) categoryDetails.cancellation_policy = cancellationPolicy;
        if (bookingUrl) categoryDetails.booking_url = bookingUrl;
        categoryDetails.pets_allowed = petsAllowed;
        categoryDetails.smoking_allowed = smokingAllowed;

        const operatingHours: Record<string, string> = {};
        if (hoursMonFri) operatingHours.weekday = hoursMonFri;
        if (hoursSat) operatingHours.saturday = hoursSat;
        if (hoursSun) operatingHours.sunday = hoursSun;

        // Tourism businesses use the business API with category "tourism_hospitality"
        const slug =
          title
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")
            .slice(0, 80) +
          "-" +
          Date.now().toString(36);

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
          social_facebook: socialFacebook || undefined,
          social_instagram: socialInstagram || undefined,
          social_twitter: socialTwitter || undefined,
          social_tiktok: socialTiktok || undefined,
          operating_hours: Object.keys(operatingHours).length > 0 ? operatingHours : undefined,
          services_offered: [],
          category_details: categoryDetails,
          contact_methods: contactMethods,
        };

        const res = await fetch("/api/businesses", {
          method: "POST",
          headers: withCsrfHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify(body),
        });
        const payload = await res.json().catch(() => null);

        if (!res.ok) {
          const normalized = normalizeCreatePostError(payload, "Failed to create tourism listing.");
          setFieldErrors(normalized.fieldErrors);
          setFormError(normalized.formError);
          focusFirstError(normalized.fieldErrors);
          return;
        }

        toast({ title: "Tourism listing submitted for review.", variant: "success" });
      } else {
        /* ── Event submission ── */
        setSubmitProgress("Saving event...");

        const eventDetails: Record<string, unknown> = {};
        if (eventType) eventDetails.event_type = eventType;
        if (venueName) eventDetails.venue_name = venueName;
        if (venueCapacity) eventDetails.venue_capacity = Number(venueCapacity);
        if (ticketTiers.length) eventDetails.ticket_tiers = ticketTiers;
        if (ticketsUrl) eventDetails.tickets_url = ticketsUrl;
        if (ageRestriction) eventDetails.age_restriction = ageRestriction;
        if (dressCode) eventDetails.dress_code = dressCode;
        if (lineup) eventDetails.lineup = lineup;
        eventDetails.parking_available = parkingAvailable;
        if (eventAccessibility.length) eventDetails.accessibility = eventAccessibility;
        eventDetails.food_drinks_available = foodDrinksAvailable;
        if (bringYourOwn) eventDetails.bring_your_own = bringYourOwn;

        const body = {
          title: title.trim(),
          description: description.trim(),
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
          media_width: mediaDimensions?.width,
          media_height: mediaDimensions?.height,
          focal_x: focalPoint.x,
          focal_y: focalPoint.y,
          start_date: startDate ? new Date(startDate).toISOString() : undefined,
          end_date: endDate ? new Date(endDate).toISOString() : undefined,
          business_id: businessId || undefined,
          socialAuthorization,
          event_details: Object.keys(eventDetails).length > 0 ? eventDetails : undefined,
        };

        const res = await fetch("/api/promotions", {
          method: "POST",
          headers: withCsrfHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify(body),
        });
        const payload = await res.json().catch(() => null);

        if (!res.ok) {
          const normalized = normalizeCreatePostError(payload, "Failed to create event.");
          setFieldErrors(normalized.fieldErrors);
          setFormError(normalized.formError);
          focusFirstError(normalized.fieldErrors);
          return;
        }

        toast({ title: "Event submitted for review.", variant: "success" });
      }

      setSubmitSucceeded(true);
      discardDraft();
      router.push("/dashboard/listings?area=PROMOTIONS_EVENTS&created=tourism");
    } catch (error: unknown) {
      setFormError(normalizeCreatePostRuntimeError(error, "Something went wrong."));
    } finally {
      setIsSubmitting(false);
      setSubmitProgress(null);
    }
  }

  function handleDiscardDraft() {
    discardDraft();
    setStep(0);
    setListingType("tourism_business");
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
    setSocialAuthorization({ granted: false });
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

  function resetEventSpecificFields() {
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
    setSocialAuthorization({ granted: false });
  }

  function handleListingTypeChange(nextType: TourismListingType) {
    if (nextType === listingType) return;
    const confirmed = window.confirm(
      "Switching type will clear industry-specific details. Shared fields like title, description, location, contact, and media will stay. Continue?"
    );
    if (!confirmed) return;
    if (nextType === "event") {
      resetTourismSpecificFields();
    } else {
      resetEventSpecificFields();
    }
    setListingType(nextType);
    clearErrors("listingType");
  }

  /* ── Render ──────────────────────────────────────────────── */

  return (
    <div className="flex min-h-screen flex-col">
      <Header isAuthenticated />
      <main className="flex-1">
        <div className="container-page py-6">
          <PlanGate area="PROMOTIONS_EVENTS">
            <form noValidate onSubmit={handleSubmit}>
              <PostFormScaffold
                title={
                  listingType === "tourism_business" ? "List a Tourism Business" : "Create an Event"
                }
                description={
                  listingType === "tourism_business"
                    ? "Register your accommodation, tour, attraction, or tourism service."
                    : "Publish a festival, conference, market, or community event."
                }
                breadcrumbs={[
                  { label: "Dashboard", href: "/dashboard" },
                  { label: "Create Post", href: "/post/create" },
                  { label: "Tourism & Events" },
                ]}
                badgeLabel="Tourism & Events"
                badgeClassName="bg-teal-600 text-white"
                guideDescription="Fill in the details, location, and media — then submit for review."
                steps={STEPS}
                currentStep={step}
                error={formError}
                onRetry={
                  formError && !isSubmitting
                    ? () => handleSubmit(new Event("submit") as unknown as React.FormEvent)
                    : undefined
                }
                footer={
                  <>
                    {user?.id && !isSubmitting && (
                      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
                        <p>
                          {lastSavedAt
                            ? `Draft saved locally at ${new Date(lastSavedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                            : "Changes are saved locally while you fill this form."}
                        </p>
                        <button
                          type="button"
                          onClick={handleDiscardDraft}
                          className="font-medium text-amber-700 hover:underline"
                        >
                          Discard draft
                        </button>
                      </div>
                    )}
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
                        const errors = validateStep(step);
                        if (Object.keys(errors).length > 0) {
                          setFieldErrors((c) => ({ ...c, ...errors }));
                          setFormError("Please fix the highlighted fields.");
                          focusFirstError(errors);
                          return;
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
                  <div className="space-y-5 animate-in fade-in-0 duration-300">
                    {/* Listing type selector */}
                    <fieldset id="listing-type-group">
                      <legend className="mb-3 text-sm font-medium">What are you listing? *</legend>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {(
                          [
                            {
                              value: "tourism_business" as const,
                              label: "Tourism Business",
                              desc: "Accommodation, tours, attractions",
                            },
                            {
                              value: "event" as const,
                              label: "Event",
                              desc: "Festival, conference, market, show",
                            },
                          ] as const
                        ).map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => handleListingTypeChange(opt.value)}
                            className={cn(
                              "flex flex-col items-start rounded-lg border p-4 text-left transition-colors",
                              listingType === opt.value
                                ? "border-teal-600 bg-teal-50 ring-2 ring-teal-600 dark:bg-teal-950/20"
                                : "hover:border-muted-foreground/30"
                            )}
                          >
                            <span className="font-medium">{opt.label}</span>
                            <span className="text-xs text-muted-foreground">{opt.desc}</span>
                          </button>
                        ))}
                      </div>
                    </fieldset>

                    {/* Title */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="title">
                          {listingType === "event" ? "Event Title" : "Business Name"} *
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
                        <p className="text-sm text-destructive">{fieldErrors.title}</p>
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
                        <p className="text-sm text-destructive">{fieldErrors.description}</p>
                      )}
                    </div>

                    {/* Subcategory (tourism business) */}
                    {listingType === "tourism_business" && (
                      <div className="space-y-2">
                        <Label htmlFor="subcategory">Tourism Category *</Label>
                        <select
                          id="subcategory"
                          value={subcategory}
                          onChange={(e) => {
                            setSubcategory(e.target.value);
                            clearErrors("subcategory");
                          }}
                          className={SELECT_CLASS}
                          aria-label="Tourism Category"
                        >
                          <option value="">Select a category...</option>
                          {TOURISM_SUBCATEGORIES.map((s) => (
                            <option key={s.value} value={s.value}>
                              {s.label}
                            </option>
                          ))}
                        </select>
                        {fieldErrors.subcategory && (
                          <p className="text-sm text-destructive">{fieldErrors.subcategory}</p>
                        )}
                      </div>
                    )}

                    {/* Event type (event) */}
                    {listingType === "event" && (
                      <div className="space-y-2">
                        <Label htmlFor="eventType">Event Type *</Label>
                        <select
                          id="eventType"
                          value={eventType}
                          onChange={(e) => {
                            setEventType(e.target.value);
                            clearErrors("eventType");
                          }}
                          className={SELECT_CLASS}
                          aria-label="Event Type"
                        >
                          <option value="">Select an event type...</option>
                          {EVENT_TYPES.map((t) => (
                            <option key={t.value} value={t.value}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                        {fieldErrors.eventType && (
                          <p className="text-sm text-destructive">{fieldErrors.eventType}</p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* ── Step 1: Details ── */}
                {step === 1 && (
                  <div className="space-y-5 animate-in fade-in-0 duration-300">
                    {listingType === "tourism_business" ? (
                      <>
                        {/* Star rating */}
                        <div className="space-y-2">
                          <Label htmlFor="starRating">Star Rating</Label>
                          <select
                            id="starRating"
                            value={starRating}
                            onChange={(e) => setStarRating(e.target.value)}
                            className={SELECT_CLASS}
                            aria-label="Star Rating"
                          >
                            <option value="">Not rated</option>
                            {[1, 2, 3, 4, 5].map((n) => (
                              <option key={n} value={String(n)}>
                                {"★".repeat(n)} {n} Star{n > 1 ? "s" : ""}
                              </option>
                            ))}
                          </select>
                          {fieldErrors.starRating && (
                            <p className="text-sm text-destructive">{fieldErrors.starRating}</p>
                          )}
                        </div>

                        {/* Number of rooms */}
                        <div className="space-y-2">
                          <Label htmlFor="numberOfRooms">Number of Rooms / Units</Label>
                          <Input
                            id="numberOfRooms"
                            type="number"
                            min={0}
                            value={numberOfRooms}
                            onChange={(e) => setNumberOfRooms(e.target.value)}
                            placeholder="e.g. 24"
                          />
                          {fieldErrors.numberOfRooms && (
                            <p className="text-sm text-destructive">{fieldErrors.numberOfRooms}</p>
                          )}
                        </div>

                        {/* Accommodation types */}
                        <fieldset className="space-y-2">
                          <legend className="text-sm font-medium">Accommodation Types</legend>
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
                            <Input
                              id="checkInTime"
                              type="time"
                              value={checkInTime}
                              onChange={(e) => setCheckInTime(e.target.value)}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="checkOutTime">Check-out Time</Label>
                            <Input
                              id="checkOutTime"
                              type="time"
                              value={checkOutTime}
                              onChange={(e) => setCheckOutTime(e.target.value)}
                            />
                          </div>
                        </div>

                        {/* Price range */}
                        <div className="space-y-2">
                          <Label htmlFor="priceRange">Price Range</Label>
                          <select
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
                          </select>
                        </div>

                        {/* Amenities */}
                        <fieldset className="space-y-2">
                          <legend className="text-sm font-medium">Amenities</legend>
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

                        {/* Meal options */}
                        <fieldset className="space-y-2">
                          <legend className="text-sm font-medium">Meal Options</legend>
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

                        {/* Languages */}
                        <div className="space-y-2">
                          <Label htmlFor="languagesSpoken">Languages Spoken</Label>
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
                          <select
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
                          </select>
                        </div>

                        {/* Booking URL */}
                        <div className="space-y-2">
                          <Label htmlFor="bookingUrl">Booking URL</Label>
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
                            <p className="text-sm text-destructive">{fieldErrors.bookingUrl}</p>
                          )}
                        </div>

                        {/* Toggles */}
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
                    ) : (
                      /* ── Event details ── */
                      <>
                        {/* Start / End date */}
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="start_date">Start Date *</Label>
                            <Input
                              id="start_date"
                              type="date"
                              value={startDate}
                              onChange={(e) => {
                                setStartDate(e.target.value);
                                clearErrors("startDate");
                              }}
                              aria-invalid={!!fieldErrors.startDate}
                            />
                            {fieldErrors.startDate && (
                              <p className="text-sm text-destructive">{fieldErrors.startDate}</p>
                            )}
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="end_date">End Date</Label>
                            <Input
                              id="end_date"
                              type="date"
                              value={endDate}
                              onChange={(e) => {
                                setEndDate(e.target.value);
                                clearErrors("endDate");
                              }}
                              aria-invalid={!!fieldErrors.endDate}
                            />
                            {fieldErrors.endDate && (
                              <p className="text-sm text-destructive">{fieldErrors.endDate}</p>
                            )}
                          </div>
                        </div>

                        {/* Venue */}
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="venueName">Venue Name</Label>
                            <Input
                              id="venueName"
                              value={venueName}
                              onChange={(e) => setVenueName(e.target.value)}
                              placeholder="e.g. Cape Town Stadium"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="venueCapacity">Venue Capacity</Label>
                            <Input
                              id="venueCapacity"
                              type="number"
                              min={0}
                              value={venueCapacity}
                              onChange={(e) => setVenueCapacity(e.target.value)}
                              placeholder="e.g. 5000"
                            />
                            {fieldErrors.venueCapacity && (
                              <p className="text-sm text-destructive">
                                {fieldErrors.venueCapacity}
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Price */}
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="priceZar">Ticket / Entry Price (ZAR)</Label>
                            <Input
                              id="priceZar"
                              type="number"
                              min={0}
                              step="0.01"
                              value={priceZar}
                              onChange={(e) => {
                                setPriceZar(e.target.value);
                                clearErrors("priceZar");
                              }}
                              placeholder="0.00 = Free"
                              aria-invalid={!!fieldErrors.priceZar}
                            />
                            {fieldErrors.priceZar && (
                              <p className="text-sm text-destructive">{fieldErrors.priceZar}</p>
                            )}
                          </div>
                          <div className="flex items-end pb-1">
                            <label className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={negotiable}
                                onChange={(e) => setNegotiable(e.target.checked)}
                                className="rounded border-gray-300"
                              />
                              Price negotiable
                            </label>
                          </div>
                        </div>

                        {/* Ticket tiers */}
                        <fieldset className="space-y-3">
                          <legend className="text-sm font-medium">Ticket Tiers</legend>
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
                                  tier.price_cents !== null ? String(tier.price_cents / 100) : ""
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
                                onClick={() => setTicketTiers((t) => t.filter((_, j) => j !== i))}
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
                            <p className="text-sm text-destructive">{fieldErrors.ticketsUrl}</p>
                          )}
                        </div>

                        {/* Age restriction */}
                        <div className="space-y-2">
                          <Label htmlFor="ageRestriction">Age Restriction</Label>
                          <select
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
                          </select>
                        </div>

                        {/* Dress code */}
                        <div className="space-y-2">
                          <Label htmlFor="dressCode">Dress Code</Label>
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
                      </>
                    )}
                  </div>
                )}

                {/* ── Step 2: Location & Contact ── */}
                {step === 2 && (
                  <div className="space-y-5 animate-in fade-in-0 duration-300">
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
                      errors={{
                        province: fieldErrors.province,
                        city: fieldErrors.city,
                      }}
                    />

                    {/* Contact methods */}
                    <fieldset id="tourism-contact-methods" className="space-y-2">
                      <legend className="text-sm font-medium">Contact Methods *</legend>
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
                        <p className="text-sm text-destructive">{fieldErrors.contactMethods}</p>
                      )}
                    </fieldset>

                    {/* Phone & WhatsApp */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="phone">Phone Number</Label>
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
                          <p className="text-sm text-destructive">{fieldErrors.phone}</p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="whatsapp">WhatsApp Number</Label>
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
                          <p className="text-sm text-destructive">{fieldErrors.whatsapp}</p>
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
                          <p className="text-sm text-destructive">{fieldErrors.email}</p>
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
                          <p className="text-sm text-destructive">{fieldErrors.website}</p>
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
                            <p className="text-sm text-destructive">{fieldErrors[key]}</p>
                          )}
                        </div>
                      ))}
                    </div>

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
                  <div className="space-y-5 animate-in fade-in-0 duration-300">
                    {/* Logo (tourism business only) */}
                    {listingType === "tourism_business" && (
                      <div className="space-y-2">
                        <Label>Business Logo</Label>
                        <MediaUpload
                          label="Upload logo"
                          maxFiles={1}
                          files={logoFiles}
                          onChange={setLogoFiles}
                          accept="image/*"
                        />
                      </div>
                    )}

                    {/* Photos */}
                    <div className="space-y-2">
                      <Label>Photos *</Label>
                      <p className="text-xs text-muted-foreground">
                        Up to {maxPhotos} photos. The first photo will be your cover image.
                      </p>
                      <MediaUpload
                        label="Upload photos"
                        maxFiles={maxPhotos}
                        files={photoFiles}
                        onChange={(files) => {
                          setPhotoFiles(files);
                          clearErrors("images");
                        }}
                        accept="image/*"
                      />
                      {fieldErrors.images && (
                        <p className="text-sm text-destructive">{fieldErrors.images}</p>
                      )}
                    </div>

                    {/* Focal point */}
                    {photoFiles.length > 0 && (
                      <div className="space-y-2">
                        <Label>Cover Crop Position</Label>
                        <MediaCropPreview
                          file={photoFiles[0]}
                          aspectRatio={4 / 1}
                          value={focalPoint}
                          onChange={setFocalPoint}
                        />
                      </div>
                    )}

                    {/* Video */}
                    {videoAllowed && (
                      <div className="space-y-2">
                        <Label>Video (optional)</Label>
                        <p className="text-xs text-muted-foreground">
                          Up to {maxVideos} video{maxVideos > 1 ? "s" : ""}.
                        </p>
                        <MediaUpload
                          label="Upload video"
                          maxFiles={maxVideos}
                          files={videoFiles}
                          onChange={(files) => {
                            setVideoFiles(files);
                            clearErrors("videos");
                          }}
                          accept="video/*"
                        />
                        {fieldErrors.videos && (
                          <p className="text-sm text-destructive">{fieldErrors.videos}</p>
                        )}
                      </div>
                    )}

                    {/* Video thumbnail */}
                    {videoFiles.length > 0 && (
                      <div className="space-y-2">
                        <Label>Video Thumbnail</Label>
                        <VideoFrameSelector
                          file={videoFiles[0]}
                          onFrameSelect={(f) => setVideoThumbnailFile(f ? [f] : [])}
                        />
                      </div>
                    )}

                    {/* Social authorization (event only) */}
                    {listingType === "event" && (
                      <SocialAuthorizationFields
                        value={socialAuthorization}
                        onChange={(next) => {
                          setSocialAuthorization(next);
                          clearErrors(
                            "socialAuthorization.authorizerName",
                            "socialAuthorization.authorizerRole",
                            "socialAuthorization.relationship",
                            "socialAuthorization.monetizationAcknowledged",
                            "socialAuthorization.acceptedVersion"
                          );
                        }}
                        errors={fieldErrors}
                      />
                    )}
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
