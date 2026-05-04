"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileText,
  Inbox,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { usePostDraftAutosave } from "@/hooks/use-post-draft-autosave";
import { CategoryPicker } from "@/components/listings/category-picker";
import { MediaUpload } from "@/components/ui/media-upload";
import { VideoFrameSelector } from "@/components/ui/video-frame-selector";
import { MediaCropPreview, type CropPosition } from "@/components/ui/media-crop-preview";
import { UploadProgressPanel, type UploadSlotStatus } from "@/components/ui/upload-progress-panel";
import {
  PlanGate,
  usePlanMaxPhotos,
  usePlanMaxVideos,
  usePlanVideoAllowed,
} from "@/components/billing/plan-gate";
import { LocationSelector, type LocationValue } from "@/components/ui/location-selector";
import type { ListingCategory, ListingCondition } from "@/types/enums";
import { mapListingCategory } from "@/lib/utils/enum-compat";
import { cn } from "@/lib/utils";
import { ListingCard } from "@/components/listings/listing-card";
import {
  PostFormFooter,
  PostFormScaffold,
  type PostFormStep,
} from "@/components/post/post-form-scaffold";
import {
  normalizeCreatePostError,
  normalizeCreatePostRuntimeError,
} from "@/app/post/_lib/create-post-errors";
import {
  getListingMediaUploadErrorState,
  uploadListingVideoFiles,
} from "@/app/post/_lib/listing-media-upload";
import { prewarmVideosForFastUpload } from "@/app/post/_lib/video-fast-upload";
import { coerceListingAttributes, validateListingAttributes } from "@/lib/forms/listing-form";
import { CATEGORIES } from "@/lib/constants/categories";
import { ensureCsrfTokenReady, withCsrfHeaders } from "@/lib/utils/csrf";
import { fetchWithRetry } from "@/lib/utils/fetch-retry";
import { checkUploadServiceReachable } from "@/lib/utils/upload-preflight";
import type { ListingDraftData } from "@/lib/post-drafts/storage";
import { LISTING_CONDITIONS } from "@/lib/constants/listing-condition";
import { ListingDetailContent } from "@/components/listings/listing-detail-content";
import { readMediaDimensions } from "@/lib/utils/media-metadata";

const STEPS: PostFormStep[] = [
  { label: "Details", icon: FileText, description: "Category, title, and description" },
  { label: "Pricing", icon: MapPin, description: "Price, location, and contact" },
  { label: "Media", icon: Camera, description: "Photos, video, and final review" },
];

const TITLE_MAX = 100;
const DESC_MAX = 5000;

const CONTACT_OPTIONS = [
  { id: "call", label: "Phone Call", icon: Phone },
  { id: "whatsapp", label: "WhatsApp", icon: MessageCircle },
  { id: "form", label: "Contact Form", icon: Mail },
  { id: "in_app", label: "In-App Chat", icon: Inbox },
] as const;

const FIELD_IDS: Record<string, string> = {
  category: "listing-category-field",
  "attributes.property_type": "listing-attribute-property_type",
  "attributes.listing_intent": "listing-attribute-listing_intent",
  "attributes.bedrooms": "listing-attribute-bedrooms",
  "attributes.bathrooms": "listing-attribute-bathrooms",
  "attributes.floor_size_sqm": "listing-attribute-floor_size_sqm",
  "attributes.parking_spots": "listing-attribute-parking_spots",
  "attributes.furnished": "listing-attribute-furnished",
  "attributes.pets_allowed": "listing-attribute-pets_allowed",
  "attributes.make": "listing-attribute-make",
  "attributes.model": "listing-attribute-model",
  "attributes.year": "listing-attribute-year",
  "attributes.mileage_km": "listing-attribute-mileage_km",
  "attributes.transmission": "listing-attribute-transmission",
  "attributes.fuel_type": "listing-attribute-fuel_type",
  "attributes.service_history": "listing-attribute-service_history",
  "attributes.body_type": "listing-attribute-body_type",
  "attributes.colour": "listing-attribute-colour",
  "attributes.part_type": "listing-attribute-part_type",
  "attributes.part_condition": "listing-attribute-part_condition",
  "attributes.compatible_make": "listing-attribute-compatible_make",
  "attributes.compatible_model": "listing-attribute-compatible_model",
  "attributes.oem_or_aftermarket": "listing-attribute-oem_or_aftermarket",
  "attributes.device_type": "listing-attribute-device_type",
  "attributes.brand": "listing-attribute-brand",
  "attributes.model_name": "listing-attribute-model_name",
  "attributes.storage_gb": "listing-attribute-storage_gb",
  "attributes.screen_size_inches": "listing-attribute-screen_size_inches",
  "attributes.warranty_months": "listing-attribute-warranty_months",
  "attributes.sub_category": "listing-attribute-sub_category",
  "attributes.material": "listing-attribute-material",
  "attributes.job_type": "listing-attribute-job_type",
  "attributes.location_type": "listing-attribute-location_type",
  "attributes.farm_category": "listing-attribute-farm_category",
  "attributes.item_type": "listing-attribute-item_type",
  title: "title",
  description: "description",
  price_zar: "price",
  province: "province",
  city: "city",
  contactMethods: "listing-contact-methods",
  images: "listing-images",
  videos: "listing-video",
};

const LISTING_FIELD_KEY_ALIASES: Record<string, string> = {
  contact_methods: "contactMethods",
  location_province: "province",
  location_city: "city",
};

/** Human-readable labels for each form field key, used in the error alert. */
const LISTING_FIELD_LABELS: Record<string, string> = {
  category: "Category",
  title: "Title",
  description: "Description",
  price_zar: "Price",
  province: "Province",
  city: "City",
  contactMethods: "Contact methods",
  images: "Photos",
  videos: "Videos",
};

function getFieldId(key: string | undefined): string | undefined {
  if (!key) return undefined;
  const normalizedKey = LISTING_FIELD_KEY_ALIASES[key] ?? key;
  return FIELD_IDS[normalizedKey];
}

function normalizeListingFieldErrors(errors: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, message] of Object.entries(errors)) {
    const normalizedKey = LISTING_FIELD_KEY_ALIASES[key] ?? key;
    if (!normalized[normalizedKey]) {
      normalized[normalizedKey] = message;
    }
  }
  return normalized;
}

function getStepForFieldKey(key: string): number {
  const normalizedKey = LISTING_FIELD_KEY_ALIASES[key] ?? key;

  if (normalizedKey === "images" || normalizedKey === "videos") {
    return 2;
  }

  if (
    normalizedKey === "price_zar" ||
    normalizedKey === "province" ||
    normalizedKey === "city" ||
    normalizedKey === "contactMethods"
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

  return keys.reduce((targetStep, key) => Math.min(targetStep, getStepForFieldKey(key)), 2);
}

interface UploadStatuses {
  logo: UploadSlotStatus;
  photos: UploadSlotStatus;
  video: UploadSlotStatus;
  saving: UploadSlotStatus;
}

const INITIAL_UPLOAD_STATUSES: UploadStatuses = {
  logo: "idle",
  photos: "idle",
  video: "idle",
  saving: "idle",
};

export default function CreateListingPage() {
  const { user, profile, isLoading } = useAuth();
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [negotiable, setNegotiable] = useState(false);
  const [category, setCategory] = useState<ListingCategory | "">("");
  const [condition, setCondition] = useState<ListingCondition | "">("");
  const [categoryAttributes, setCategoryAttributes] = useState<
    Record<string, string | boolean | string[]>
  >({});
  const [province, setProvince] = useState("");
  const [city, setCity] = useState("");
  const [town, setTown] = useState("");
  const [address, setAddress] = useState("");
  const [contactMethods, setContactMethods] = useState<string[]>(["call"]);
  const [logoFile, setLogoFile] = useState<File[]>([]);
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [videoFile, setVideoFile] = useState<File[]>([]);
  const [videoCoverFile, setVideoCoverFile] = useState<File[]>([]);
  const [focalPoint, setFocalPoint] = useState<CropPosition>({ x: 0.5, y: 0.5 });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submissionInFlightRef = useRef(false);
  const [submitProgress, setSubmitProgress] = useState<string | null>(null);
  const [uploadStatuses, setUploadStatuses] = useState<UploadStatuses>(INITIAL_UPLOAD_STATUSES);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitSucceeded, setSubmitSucceeded] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  const router = useRouter();
  const { toast } = useToast();
  const {
    save: saveDraft,
    restore: restoreDraft,
    discard: discardDraft,
  } = usePostDraftAutosave<ListingDraftData>("listing", user?.id, !isLoading);
  const locationValue: LocationValue = { province, city, town, address };
  const maxPhotos = usePlanMaxPhotos("MZANSI_MARKET");
  const maxVideos = usePlanMaxVideos("MZANSI_MARKET");
  const videoAllowed = usePlanVideoAllowed("MZANSI_MARKET");
  const logoPreviewUrl = useMemo(
    () => (logoFile.length > 0 ? URL.createObjectURL(logoFile[0]) : null),
    [logoFile]
  );
  const photoPreviewUrls = useMemo(
    () => photoFiles.map((file) => URL.createObjectURL(file)),
    [photoFiles]
  );
  const videoPreviewUrl = useMemo(
    () => (videoFile.length > 0 ? URL.createObjectURL(videoFile[0]) : null),
    [videoFile]
  );
  const videoCoverPreviewUrl = useMemo(
    () => (videoCoverFile.length > 0 ? URL.createObjectURL(videoCoverFile[0]) : null),
    [videoCoverFile]
  );

  const listingCompleteness = useMemo(() => {
    const base = [
      !!title.trim(),
      !!description.trim(),
      !!price,
      !!category,
      !!province,
      !!city,
      photoFiles.length > 0,
      contactMethods.length > 0,
    ];
    const catDef = category ? CATEGORIES.find((c) => c.value === category) : undefined;
    const attrFields = (catDef?.attributeFields ?? []).filter((field) => {
      if (!field.dependsOnValue || !field.dependsOn) {
        return true;
      }

      const parentValue = categoryAttributes[field.dependsOn];
      if (parentValue === undefined || parentValue === null || parentValue === "") {
        return false;
      }

      const allowedValues = Array.isArray(field.dependsOnValue)
        ? field.dependsOnValue
        : [field.dependsOnValue];
      return allowedValues.includes(String(parentValue));
    });
    const attrFilled = attrFields.map((f: { name: string; type: string }) => {
      const v = categoryAttributes[f.name];
      if (v === undefined || v === "" || v === false) return false;
      if (Array.isArray(v) && v.length === 0) return false;
      return true;
    });
    const all = [...base, ...attrFilled];
    return all.length === 0 ? 0 : Math.round((all.filter(Boolean).length / all.length) * 100);
  }, [
    title,
    description,
    price,
    category,
    province,
    city,
    photoFiles,
    contactMethods,
    categoryAttributes,
  ]);

  const isPropertyRentListing =
    category === "property" && categoryAttributes["listing_intent"] === "rent";

  useEffect(
    () => () => {
      if (logoPreviewUrl) URL.revokeObjectURL(logoPreviewUrl);
    },
    [logoPreviewUrl]
  );

  useEffect(
    () => () => {
      photoPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
    },
    [photoPreviewUrls]
  );

  useEffect(
    () => () => {
      if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
    },
    [videoPreviewUrl]
  );

  useEffect(
    () => () => {
      if (videoCoverPreviewUrl) URL.revokeObjectURL(videoCoverPreviewUrl);
    },
    [videoCoverPreviewUrl]
  );

  useEffect(() => {
    if (!profile) return;

    queueMicrotask(() => {
      if (!province && profile.location_province) {
        setProvince(profile.location_province);
      }

      if (!city && profile.location_city && (!province || province === profile.location_province)) {
        setCity(profile.location_city);
      }
    });
  }, [profile, province, city]);

  useEffect(() => {
    void ensureCsrfTokenReady();
  }, []);

  useEffect(() => {
    if (!user?.id || isLoading || submitSucceeded) return;

    const restored = restoreDraft();
    if (!restored) return;

    const restoredData = restored.data;
    queueMicrotask(() => {
      setStep(Math.min(Math.max(restored.step ?? 0, 0), STEPS.length - 1));
      setTitle(restoredData.title ?? "");
      setDescription(restoredData.description ?? "");
      setPrice(restoredData.price ?? "");
      setNegotiable(Boolean(restoredData.negotiable));
      setCategory((restoredData.category as ListingCategory | "") ?? "");
      setCondition((restoredData.condition as ListingCondition | "") ?? "");
      setCategoryAttributes(restoredData.categoryAttributes ?? {});
      setProvince(restoredData.province ?? "");
      setCity(restoredData.city ?? "");
      setTown(restoredData.town ?? "");
      setAddress(restoredData.address ?? "");
      setContactMethods(
        Array.isArray(restoredData.contactMethods) && restoredData.contactMethods.length > 0
          ? restoredData.contactMethods
          : ["call"]
      );
      setLastSavedAt(restored.savedAt ?? null);
      toast({
        title: "Draft restored",
        description: "You can continue from where you left off.",
        variant: "success",
      });
    });
  }, [user?.id, isLoading, submitSucceeded, restoreDraft, toast]);

  useEffect(() => {
    if (!user?.id || isLoading || isSubmitting || submitSucceeded) return;

    saveDraft(step, {
      category,
      condition,
      categoryAttributes,
      title,
      description,
      price,
      negotiable,
      province,
      city,
      town,
      address,
      contactMethods,
    });
    queueMicrotask(() => {
      setLastSavedAt(Date.now());
    });
  }, [
    user?.id,
    isLoading,
    isSubmitting,
    submitSucceeded,
    saveDraft,
    step,
    category,
    condition,
    categoryAttributes,
    title,
    description,
    price,
    negotiable,
    province,
    city,
    town,
    address,
    contactMethods,
  ]);

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
      ["category", "title", "description"],
      ["price_zar", "province", "city", "contactMethods"],
      ["images", "videos"],
    ][targetStep];

    const firstKey = orderByStep?.find((key) => errors[key]) ?? Object.keys(errors)[0];
    if (!firstKey) return;
    const targetId = getFieldId(firstKey);

    if (!targetId) return;

    requestAnimationFrame(() => {
      const element = document.getElementById(targetId);
      element?.focus();
      element?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  function validateStep(targetStep: number) {
    const errors: Record<string, string> = {};

    if (targetStep === 0) {
      if (!category) errors.category = "Select a category.";
      if (!title.trim()) errors.title = "Enter a title.";
      else if (title.trim().length < 5) errors.title = "Title must be at least 5 characters.";
      else if (title.trim().length > TITLE_MAX)
        errors.title = `Title must be ${TITLE_MAX} characters or fewer.`;

      if (!description.trim()) errors.description = "Enter a description.";
      else if (description.trim().length < 20)
        errors.description = "Description must be at least 20 characters.";
      else if (description.trim().length > DESC_MAX)
        errors.description = `Description must be ${DESC_MAX} characters or fewer.`;

      if (category) {
        Object.assign(errors, validateListingAttributes(category, categoryAttributes));
      }
    }

    if (targetStep === 1) {
      if (!price || Number.isNaN(parseFloat(price)) || parseFloat(price) < 0) {
        errors.price_zar = "Enter a valid price.";
      }
      if (!province) errors.province = "Select a province.";
      if (!city) errors.city = "Select a city.";
      if (province.trim().length > 50) {
        errors.province = "Province must be 50 characters or fewer.";
      }
      if (city.trim().length > 80) {
        errors.city = "City must be 80 characters or fewer.";
      }
      if (town.trim().length > 120) {
        errors.town = "Town / suburb must be 120 characters or fewer.";
      }
      if (address.trim().length > 300) {
        errors.address = "Address must be 300 characters or fewer.";
      }
      if (contactMethods.length === 0) {
        errors.contactMethods = "Choose at least one contact method.";
      }
    }

    if (targetStep === 2) {
      if (photoFiles.length === 0) errors.images = "Upload at least one photo.";
      if (photoFiles.length > maxPhotos) {
        errors.images = `You can upload up to ${maxPhotos} photos on this plan.`;
      }
      if (videoFile.length > 0 && !videoAllowed) {
        errors.videos = "Video upload is not available on your current plan.";
      } else if (videoFile.length > maxVideos) {
        errors.videos = `You can upload up to ${maxVideos} videos on this plan.`;
      }
    }

    return errors;
  }

  function handleCategoryChange(nextCategory: ListingCategory) {
    setCategory(nextCategory);
    setCategoryAttributes(
      nextCategory === "vehicles" ? { year: String(new Date().getFullYear()) } : {}
    );
    clearErrors("category");
  }

  function handleAttributeChange(name: string, value: string | boolean | string[]) {
    setCategoryAttributes((prev) => ({ ...prev, [name]: value }));
  }

  function toggleContact(id: string) {
    setContactMethods((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]));
    clearErrors("contactMethods");
  }

  /** Scroll to top and focus the first field of the target step */
  function scrollToStepTop(targetStep: number) {
    const firstFieldByStep = ["listing-category-field", "price", "listing-images"];
    requestAnimationFrame(() => {
      document
        .getElementById("post-form-top")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
      const fieldId = firstFieldByStep[targetStep];
      if (fieldId) {
        const el = document.getElementById(fieldId);
        el?.focus({ preventScroll: true });
      }
    });
  }

  function goNext() {
    // Validate all steps up to and including the current step
    for (let i = 0; i <= step; i++) {
      const errors = validateStep(i);
      if (Object.keys(errors).length > 0) {
        if (i !== step) setStep(i);
        setFieldErrors((current) => ({ ...current, ...errors }));
        const count = Object.keys(errors).length;
        setFormError(
          `Please fix ${count} field${count > 1 ? "s" : ""} on Step ${i + 1} \u2014 ${STEPS[i].label}.`
        );
        focusFirstError(errors, i);
        return;
      }
    }

    clearErrors();
    const next = Math.min(step + 1, STEPS.length - 1);
    setStep(next);
    scrollToStepTop(next);
  }

  function goBack() {
    clearErrors();
    const prev = Math.max(step - 1, 0);
    setStep(prev);
    scrollToStepTop(prev);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    // Ref-based guard: prevent concurrent/duplicate submissions even across re-renders
    if (submissionInFlightRef.current) return;

    const stepErrors = [0, 1, 2].map((index) => validateStep(index));
    const firstInvalidStep = stepErrors.findIndex((errors) => Object.keys(errors).length > 0);

    if (firstInvalidStep !== -1) {
      setStep(firstInvalidStep);
      setFieldErrors(stepErrors[firstInvalidStep]);
      const count = Object.keys(stepErrors[firstInvalidStep]).length;
      setFormError(
        `Please fix ${count} field${count > 1 ? "s" : ""} on Step ${firstInvalidStep + 1} \u2014 ${STEPS[firstInvalidStep].label}.`
      );
      requestAnimationFrame(() => focusFirstError(stepErrors[firstInvalidStep], firstInvalidStep));
      return;
    }

    clearErrors();
    setIsSubmitting(true);
    submissionInFlightRef.current = true;
    setSubmitProgress("Checking upload service...");
    setUploadStatuses({
      logo: logoFile.length > 0 ? "uploading" : "skipped",
      photos: photoFiles.length > 0 ? "uploading" : "skipped",
      video: videoFile.length > 0 ? "uploading" : "skipped",
      saving: "idle",
    });

    try {
      const csrfToken = await ensureCsrfTokenReady();
      if (!csrfToken) {
        setFormError("Security check failed. Please refresh the page and try again.");
        return;
      }

      // Best-effort preflight — never block the form on a health check.
      try {
        await checkUploadServiceReachable();
      } catch {
        // logged inside checkUploadServiceReachable; continue to real upload
      }
      setSubmitProgress("Uploading media...");

      const normalizedAttributes = category
        ? coerceListingAttributes(category, categoryAttributes)
        : {};

      const readUploadError = async (response: Response, fallback: string): Promise<string> => {
        try {
          const payload = (await response.json()) as { error?: unknown; message?: unknown };
          const payloadError =
            typeof payload.error === "string"
              ? payload.error
              : typeof payload.message === "string"
                ? payload.message
                : null;
          if (payloadError) {
            return payloadError;
          }
        } catch {
          // Ignore JSON parse failures and use fallback below.
        }
        return `${fallback} (HTTP ${response.status})`;
      };

      let logoUrls: string[] = [];
      if (logoFile.length > 0) {
        const uploadData = new FormData();
        uploadData.append("area", "listing_logo");
        uploadData.append("files", logoFile[0]);
        const uploadRes = await fetchWithRetry("/api/media/upload", {
          method: "POST",
          headers: withCsrfHeaders(),
          body: uploadData,
        });
        if (!uploadRes.ok) {
          throw new Error(await readUploadError(uploadRes, "Failed to upload listing logo"));
        }
        const uploadJson = await uploadRes.json();
        logoUrls = (uploadJson.urls || []) as string[];
        setUploadStatuses((current) => ({ ...current, logo: "done" }));
      }

      // Upload photos, video, and video cover in parallel after the logo upload settles.
      const [photoUrls, videoUrls, videoThumbnailUrl] = await Promise.all([
        // Photos via server proxy (small files)
        photoFiles.length > 0
          ? (async () => {
              const uploadData = new FormData();
              uploadData.append("area", "listing");
              photoFiles.forEach((file) => uploadData.append("files", file));
              const uploadRes = await fetchWithRetry("/api/media/upload", {
                method: "POST",
                headers: withCsrfHeaders(),
                body: uploadData,
              });
              if (!uploadRes.ok) {
                throw new Error(await readUploadError(uploadRes, "Failed to upload photos"));
              }
              const uploadJson = await uploadRes.json();
              const urls = (uploadJson.urls || []) as string[];
              const fileErrors = (uploadJson.errors || []) as string[];
              if (urls.length === 0 && fileErrors.length > 0) {
                throw new Error("Failed to upload photos");
              }
              if (fileErrors.length > 0) {
                toast({
                  title: `${urls.length} of ${photoFiles.length} photos uploaded. Some files were rejected.`,
                  variant: "destructive",
                });
              }
              setUploadStatuses((current) => ({ ...current, photos: "done" }));
              return urls;
            })()
          : Promise.resolve([] as string[]),

        // Video via shared fast path with validated server fallback.
        videoFile.length > 0
          ? (async () => {
              setSubmitProgress("Uploading media...");
              const urls = await uploadListingVideoFiles({
                files: videoFile,
                area: "listing_video",
              });
              setUploadStatuses((current) => ({ ...current, video: "done" }));
              return urls;
            })()
          : Promise.resolve([] as string[]),

        // Video cover image via server proxy
        videoCoverFile.length > 0
          ? (async () => {
              const uploadData = new FormData();
              uploadData.append("area", "listing");
              uploadData.append("files", videoCoverFile[0]);
              const uploadRes = await fetchWithRetry("/api/media/upload", {
                method: "POST",
                headers: withCsrfHeaders(),
                body: uploadData,
              });
              if (!uploadRes.ok) return null;
              const uploadJson = await uploadRes.json();
              return (uploadJson.urls?.[0] || null) as string | null;
            })()
          : Promise.resolve(null as string | null),
      ]);

      setSubmitProgress("Saving listing...");
      setUploadStatuses((current) => ({ ...current, saving: "uploading" }));
      const primaryMediaFile = videoFile[0] ?? photoFiles[0] ?? null;
      const mediaDimensions = primaryMediaFile ? await readMediaDimensions(primaryMediaFile) : null;

      const res = await fetch("/api/listings", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          price_zar: parseFloat(price),
          negotiable,
          category: mapListingCategory(category),
          condition: condition || undefined,
          attributes: normalizedAttributes,
          province,
          city,
          town,
          address,
          logo_url: logoUrls[0] || null,
          images: photoUrls,
          videos: videoUrls,
          videoThumbnail: videoThumbnailUrl,
          contactMethods,
          media_width: mediaDimensions?.width,
          media_height: mediaDimensions?.height,
          focal_x: focalPoint.x,
          focal_y: focalPoint.y,
        }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => null);

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
            setStep(2);
            setFieldErrors(errors);
            setFormError(`Please fix 1 field on Step 3 — ${STEPS[2].label}.`);
            focusFirstError(errors, 2);
            return;
          }
          if (lower.includes("video")) {
            const errors = { videos: message };
            setStep(2);
            setFieldErrors(errors);
            setFormError(`Please fix 1 field on Step 3 — ${STEPS[2].label}.`);
            focusFirstError(errors, 2);
            return;
          }
        }

        const normalized = normalizeCreatePostError(payload, "Failed to create listing.");
        const normalizedFieldErrors = normalizeListingFieldErrors(normalized.fieldErrors);
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

      toast({ title: "Listing submitted for review.", variant: "success" });
      setSubmitSucceeded(true);
      discardDraft();
      setUploadStatuses((current) => ({ ...current, saving: "done" }));
      router.push("/dashboard/listings");
    } catch (error: unknown) {
      const uploadFailure = getListingMediaUploadErrorState(error);
      if (uploadFailure) {
        setStep(2);
        setFieldErrors(uploadFailure.fieldErrors);
        setFormError(uploadFailure.formError);
        focusFirstError(uploadFailure.fieldErrors, 2);
        return;
      }
      setFormError(normalizeCreatePostRuntimeError(error, "Something went wrong."));
    } finally {
      setIsSubmitting(false);
      submissionInFlightRef.current = false;
      setSubmitProgress(null);
      setUploadStatuses(INITIAL_UPLOAD_STATUSES);
    }
  }

  function handleDiscardDraft() {
    discardDraft();
    setStep(0);
    setTitle("");
    setDescription("");
    setPrice("");
    setNegotiable(false);
    setCategory("");
    setCondition("");
    setCategoryAttributes({});
    setProvince(profile?.location_province ?? "");
    setCity(profile?.location_city ?? "");
    setTown("");
    setAddress("");
    setContactMethods(["call"]);
    setLogoFile([]);
    setPhotoFiles([]);
    setVideoFile([]);
    setVideoCoverFile([]);
    setFieldErrors({});
    setFormError(null);
    setLastSavedAt(null);
    toast({
      title: "Draft discarded",
      description: "You can start a fresh listing now.",
      variant: "success",
    });
  }

  function renderPreview() {
    const numericPrice = parseFloat(price);
    const normalizedAttributes = category
      ? coerceListingAttributes(category, categoryAttributes)
      : {};
    const cardMediaUrl = videoPreviewUrl || photoPreviewUrls[0];
    const cardPosterUrl = videoCoverPreviewUrl || photoPreviewUrls[0] || undefined;

    return (
      <div className="rounded-xl border border-dashed border-brand-green/30 bg-brand-green/5 p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Eye className="h-4 w-4" />
          Listing preview
        </div>

        <div className="mb-4 max-w-[264px]">
          <ListingCard
            id="preview-listing"
            title={title || "Your listing title"}
            price={
              !Number.isNaN(numericPrice) && numericPrice > 0 ? Math.round(numericPrice * 100) : 0
            }
            imageUrl={cardMediaUrl || undefined}
            posterUrl={cardPosterUrl}
            isVideo={videoFile.length > 0}
            fitStrategy="contain"
            logoUrl={logoPreviewUrl}
            province={province || "Province"}
            city={city || "City"}
            category={category || "property"}
            attributes={normalizedAttributes}
            condition={condition || undefined}
            createdAt={new Date().toISOString()}
          />
        </div>

        <ListingDetailContent
          listing={{
            id: "preview-listing",
            owner_id: "preview-owner",
            title: title || "Your listing title",
            description: description || "Your listing description will appear here.",
            price_cents:
              !Number.isNaN(numericPrice) && numericPrice > 0 ? Math.round(numericPrice * 100) : 0,
            price_negotiable: negotiable,
            category: category || null,
            condition: condition || null,
            attributes: normalizedAttributes,
            photos: photoPreviewUrls,
            videos: videoPreviewUrl ? [videoPreviewUrl] : [],
            video_thumbnail: videoCoverPreviewUrl,
            logo_url: logoPreviewUrl,
            location_province: province || null,
            location_city: city || null,
            location_suburb: town || null,
            location_address: address || null,
            contact_methods: contactMethods,
            created_at: new Date().toISOString(),
          }}
          seller={{
            display_name: "You",
            location_province: province || null,
            location_city: city || null,
            account_verification_status: null,
          }}
          showContactActions={false}
          showSimilarListings={false}
          photoCount={photoPreviewUrls.length}
          trackView={false}
          layoutMode="review"
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header isAuthenticated />

      <main className="flex-1">
        <div className="container-page py-6">
          <PlanGate area="MZANSI_MARKET">
            <form noValidate onSubmit={handleSubmit}>
              <PostFormScaffold
                title="Create a Mzansi Market Listing"
                description="Add your listing with a clear title, trusted details, and strong media."
                breadcrumbs={[
                  { label: "Dashboard", href: "/dashboard" },
                  { label: "Create Post", href: "/post/create" },
                  { label: "Mzansi Market" },
                ]}
                badgeLabel="Mzansi Market"
                badgeClassName="bg-brand-green text-white"
                guideDescription="Choose your category, complete the 3 guided steps, and submit your listing for review."
                steps={STEPS}
                currentStep={step}
                completeness={listingCompleteness}
                error={formError}
                fieldErrors={fieldErrors}
                fieldLabels={LISTING_FIELD_LABELS}
                errorStepLabel={
                  formError ? `Step ${step + 1} \u2014 ${STEPS[step].label}` : undefined
                }
                stepHasErrors={STEPS.map((_, i) => Object.keys(validateStep(i)).length > 0)}
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
                          className="font-medium text-brand-green hover:underline"
                        >
                          Discard draft
                        </button>
                      </div>
                    )}

                    {isSubmitting && (
                      <UploadProgressPanel
                        visible={isSubmitting}
                        slots={[
                          {
                            key: "logo",
                            label: "Uploading logo...",
                            doneLabel: "Logo uploaded",
                            status: logoFile.length > 0 ? uploadStatuses.logo : "skipped",
                          },
                          {
                            key: "photos",
                            label: "Uploading photos...",
                            doneLabel: "Photos uploaded",
                            status: photoFiles.length > 0 ? uploadStatuses.photos : "skipped",
                          },
                          {
                            key: "video",
                            label: "Preparing and verifying video...",
                            doneLabel: "Video verified",
                            status: videoFile.length > 0 ? uploadStatuses.video : "skipped",
                          },
                          {
                            key: "saving",
                            label: "Saving listing...",
                            doneLabel: "Listing saved",
                            status: uploadStatuses.saving,
                          },
                        ]}
                      />
                    )}

                    <PostFormFooter
                      currentStep={step}
                      totalSteps={STEPS.length}
                      onBack={goBack}
                      onNext={goNext}
                      submitDisabled={isSubmitting}
                      isSubmitting={isSubmitting}
                      submittingLabel={submitProgress || "Submitting..."}
                    />
                  </>
                }
              >
                {step === 0 && (
                  <div className="space-y-5 animate-in fade-in-0 duration-300">
                    <div
                      id="listing-category-field"
                      tabIndex={-1}
                      className={cn(
                        "rounded-xl p-1 transition-colors",
                        fieldErrors.category && "rounded-xl border border-destructive/60"
                      )}
                    >
                      <CategoryPicker
                        value={category}
                        onChange={handleCategoryChange}
                        attributes={categoryAttributes}
                        onAttributeChange={handleAttributeChange}
                        errors={fieldErrors}
                      />
                    </div>
                    {fieldErrors.category && (
                      <p className="inline-form-error">{fieldErrors.category}</p>
                    )}

                    <div className="space-y-2">
                      <Label htmlFor="condition">Condition</Label>
                      <select
                        id="condition"
                        aria-label="Condition"
                        className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:h-10 sm:text-sm"
                        value={condition}
                        onChange={(event) => {
                          setCondition(event.target.value as ListingCondition | "");
                          // Auto-focus the title field after selecting condition
                          requestAnimationFrame(() => {
                            const el = document.getElementById("title");
                            if (el) {
                              el.focus();
                              el.scrollIntoView({ behavior: "smooth", block: "center" });
                            }
                          });
                        }}
                      >
                        <option value="">Condition not specified</option>
                        {LISTING_CONDITIONS.map((item) => (
                          <option key={item.value} value={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-muted-foreground">
                        Optional, but recommended for buyers comparing similar listings.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="title">Title *</Label>
                        <span
                          className={cn(
                            "text-xs",
                            title.length > TITLE_MAX * 0.9
                              ? "font-medium text-destructive"
                              : "text-muted-foreground"
                          )}
                        >
                          {title.length}/{TITLE_MAX}
                        </span>
                      </div>
                      <Input
                        id="title"
                        value={title}
                        onChange={(event) => {
                          setTitle(event.target.value.slice(0, TITLE_MAX));
                          clearErrors("title");
                        }}
                        placeholder="e.g. iPhone 15 Pro Max 256GB"
                        maxLength={TITLE_MAX}
                        aria-invalid={!!fieldErrors.title}
                        className={cn(fieldErrors.title && "border-destructive")}
                      />
                      {fieldErrors.title && (
                        <p className="inline-form-error">{fieldErrors.title}</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="description">Description *</Label>
                        <span
                          className={cn(
                            "text-xs",
                            description.length > DESC_MAX * 0.9
                              ? "font-medium text-destructive"
                              : "text-muted-foreground"
                          )}
                        >
                          {description.length}/{DESC_MAX}
                        </span>
                      </div>
                      <Textarea
                        id="description"
                        value={description}
                        onChange={(event) => {
                          setDescription(event.target.value.slice(0, DESC_MAX));
                          clearErrors("description");
                        }}
                        placeholder="Describe the item, condition, included extras, and anything buyers should know."
                        className={cn(
                          "min-h-[120px]",
                          fieldErrors.description && "border-destructive"
                        )}
                        aria-invalid={!!fieldErrors.description}
                      />
                      {fieldErrors.description && (
                        <p className="inline-form-error">{fieldErrors.description}</p>
                      )}
                    </div>
                  </div>
                )}

                {step === 1 && (
                  <div className="space-y-5 animate-in fade-in-0 duration-300">
                    <div className="space-y-2">
                      <Label htmlFor="price">
                        {isPropertyRentListing ? "Monthly Rent (ZAR) *" : "Asking Price (ZAR) *"}
                      </Label>
                      <div className="flex flex-col xs:flex-row gap-3">
                        <div className="relative flex-1">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted-foreground">
                            R
                          </span>
                          <Input
                            id="price"
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="0.01"
                            value={price}
                            onChange={(event) => {
                              setPrice(event.target.value);
                              clearErrors("price_zar");
                            }}
                            placeholder="0.00"
                            className={cn("pl-8", fieldErrors.price_zar && "border-destructive")}
                            aria-invalid={!!fieldErrors.price_zar}
                          />
                        </div>

                        <label
                          className={cn(
                            "flex cursor-pointer items-center rounded-md border px-3 py-2 text-sm font-medium transition-all",
                            negotiable
                              ? "border-brand-green bg-brand-green/10 text-brand-green"
                              : "border-input text-muted-foreground hover:border-brand-green/40"
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={negotiable}
                            onChange={(event) => setNegotiable(event.target.checked)}
                            className="sr-only"
                          />
                          Negotiable
                        </label>
                      </div>
                      {fieldErrors.price_zar && (
                        <p className="inline-form-error">{fieldErrors.price_zar}</p>
                      )}
                    </div>

                    <div className="space-y-3">
                      <Label className="text-base font-semibold">Location</Label>
                      <LocationSelector
                        value={locationValue}
                        onChange={(v) => {
                          setProvince(v.province);
                          setCity(v.city);
                          setTown(v.town ?? "");
                          setAddress(v.address ?? "");
                          clearErrors("province", "city");
                        }}
                        cityLabel="City"
                        showTown
                        showAddress
                        errors={{
                          province: fieldErrors.province,
                          city: fieldErrors.city,
                        }}
                      />
                    </div>

                    <div
                      id="listing-contact-methods"
                      tabIndex={-1}
                      className="space-y-3 rounded-lg"
                    >
                      <Label className="text-base font-semibold">Contact Methods *</Label>
                      <p className="text-xs text-muted-foreground">
                        Choose how buyers should reach you.
                      </p>
                      <div className="grid grid-cols-1 xs:grid-cols-3 gap-2">
                        {CONTACT_OPTIONS.map((option) => {
                          const Icon = option.icon;
                          const isSelected = contactMethods.includes(option.id);

                          return (
                            <label
                              key={option.id}
                              className={cn(
                                "flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border-2 p-3 text-xs font-medium transition-all",
                                isSelected
                                  ? "border-brand-green bg-brand-green/10 text-brand-green"
                                  : "border-input text-muted-foreground hover:border-brand-green/40 hover:bg-muted/50",
                                fieldErrors.contactMethods && !isSelected && "border-destructive/40"
                              )}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleContact(option.id)}
                                className="sr-only"
                              />
                              <Icon className="h-5 w-5" />
                              {option.label}
                            </label>
                          );
                        })}
                      </div>
                      {fieldErrors.contactMethods && (
                        <p className="inline-form-error">{fieldErrors.contactMethods}</p>
                      )}
                    </div>
                  </div>
                )}

                {step === 2 && (
                  <div className="space-y-5 animate-in fade-in-0 duration-300">
                    <div className="space-y-2">
                      <MediaUpload
                        id="listing-logo-input"
                        label="Listing logo (optional)"
                        description="Optional brand mark shown on listing cards when available."
                        maxFiles={1}
                        files={logoFile}
                        onChange={setLogoFile}
                        accept="image/*"
                        recommendedAspect="Recommended: square image, at least 96 x 96."
                      />
                      <p className="text-xs text-muted-foreground">
                        If present, this logo will be shown on listing cards across the marketplace.
                      </p>
                    </div>

                    <div id="listing-images" tabIndex={-1} className="space-y-2 rounded-lg">
                      <MediaUpload
                        id="listing-images-input"
                        label={`Photos (max ${maxPhotos})`}
                        description="Required. Your first photo becomes the public hero image and marketplace card cover."
                        error={fieldErrors.images}
                        maxFiles={maxPhotos}
                        files={photoFiles}
                        onChange={(files) => {
                          setPhotoFiles(files);
                          clearErrors("images");
                        }}
                        accept="image/*"
                      />
                      <p className="text-xs text-muted-foreground">
                        Your first photo becomes the hero image on the public listing page and the
                        cover on cards. Portrait photos around 1080 x 1920 work best.
                      </p>
                      {photoFiles.length > 1 && (
                        <div className="space-y-1">
                          <p className="text-xs font-medium text-muted-foreground">
                            Reorder photos. The first image appears on cards.
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {photoFiles.map((file, index) => (
                              <div
                                key={`${file.name}-${index}`}
                                className="flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs"
                              >
                                <span className="max-w-[100px] truncate font-medium">
                                  {file.name}
                                </span>
                                <button
                                  type="button"
                                  disabled={index === 0}
                                  onClick={() => {
                                    const reordered = [...photoFiles];
                                    [reordered[index - 1], reordered[index]] = [
                                      reordered[index],
                                      reordered[index - 1],
                                    ];
                                    setPhotoFiles(reordered);
                                  }}
                                  className="rounded p-0.5 hover:bg-background disabled:opacity-30"
                                  aria-label="Move photo left"
                                >
                                  <ChevronLeft className="h-3 w-3" />
                                </button>
                                <button
                                  type="button"
                                  disabled={index === photoFiles.length - 1}
                                  onClick={() => {
                                    const reordered = [...photoFiles];
                                    [reordered[index], reordered[index + 1]] = [
                                      reordered[index + 1],
                                      reordered[index],
                                    ];
                                    setPhotoFiles(reordered);
                                  }}
                                  className="rounded p-0.5 hover:bg-background disabled:opacity-30"
                                  aria-label="Move photo right"
                                >
                                  <ChevronRight className="h-3 w-3" />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {photoFiles.length > 0 && videoFile.length === 0 && (
                      <MediaCropPreview
                        file={photoFiles[0]}
                        value={focalPoint}
                        onChange={setFocalPoint}
                      />
                    )}

                    <div id="listing-video" tabIndex={-1} className="space-y-2 rounded-lg">
                      <MediaUpload
                        id="listing-video-input"
                        label={`Video (max ${maxVideos})${!videoAllowed ? " — Upgrade to unlock" : ""}`}
                        description="Optional. Use clear portrait clips that show the item, property, or service honestly."
                        error={fieldErrors.videos}
                        maxFiles={maxVideos}
                        files={videoFile}
                        onChange={(files) => {
                          setVideoFile(files);
                          prewarmVideosForFastUpload(files);
                          if (files.length === 0) setVideoCoverFile([]);
                          clearErrors("videos");
                        }}
                        accept="video/*"
                        disabled={!videoAllowed}
                      />
                      <p className="text-xs text-muted-foreground">
                        Use one clear vertical clip for the poster-style hero. Portrait 9:16 video
                        is the best fit.
                      </p>
                    </div>

                    {videoFile.length > 0 && (
                      <div className="space-y-3">
                        <VideoFrameSelector
                          file={videoFile[0]}
                          onFrameSelect={(frame) => {
                            setVideoCoverFile(frame ? [frame] : []);
                          }}
                        />
                        <details className="group">
                          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                            Or upload a custom cover image…
                          </summary>
                          <div className="mt-2">
                            <MediaUpload
                              id="listing-video-cover-input"
                              label="Custom cover image"
                              description="Optional poster image shown before the video plays."
                              maxFiles={1}
                              files={videoCoverFile}
                              onChange={setVideoCoverFile}
                              accept="image/*"
                            />
                            <p className="mt-2 text-xs text-muted-foreground">
                              This image is shown before the video plays and may become the hero
                              poster in previews.
                            </p>
                          </div>
                        </details>
                      </div>
                    )}

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
