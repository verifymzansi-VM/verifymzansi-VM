"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Building2,
  Camera,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  FileText,
  Film,
  Globe,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Plus,
  Store,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { usePostDraftAutosave } from "@/hooks/use-post-draft-autosave";
import { MediaUpload } from "@/components/ui/media-upload";
import {
  PlanGate,
  usePlanCoverVideoAllowed,
  usePlanMaxPhotos,
} from "@/components/billing/plan-gate";
import { LocationSelector, type LocationValue } from "@/components/ui/location-selector";
import { BUSINESS_CATEGORIES, BUSINESS_TYPE_OPTIONS } from "@/lib/constants/categories";
import type { BusinessCategory, BusinessType } from "@/types/enums";
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
import {
  getBusinessMediaUploadErrorState,
  uploadRequiredBusinessMedia,
  uploadRequiredBusinessVideo,
} from "@/app/post/_lib/business-media-upload";
import { parseServiceAreas, validateBusinessForm } from "@/lib/forms/business-form";
import {
  coerceBusinessDetails,
  getNormalizedDeliveryOptions,
  getDefaultBusinessDetails,
  sanitizeBusinessDetailsForSubmission,
} from "@/lib/forms/business-type-details";
import { BusinessTypeDetailsFields } from "@/components/business/business-type-details-fields";
import type { BusinessDetails } from "@/types/business-details";
import type { BusinessDetailRecord } from "@/components/business/business-detail-content";
import { BusinessLayoutRouter } from "@/components/business/layouts/business-layout-router";
import { DevicePreviewShell } from "@/components/business/shared/device-preview-shell";
import { LayoutChooser } from "@/components/business/shared/layout-chooser";
import { resolveBusinessLayout } from "@/lib/business/category-layout-map";
import type { LayoutTemplate } from "@/lib/business/layout-templates";
import type { BusinessDraftData } from "@/lib/post-drafts/storage";

const SELECT_CLASS =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
const STEPS: PostFormStep[] = [
  { label: "Details", icon: FileText, description: "Type, name, category, and overview" },
  { label: "Location & Reach", icon: MapPin, description: "Address, contact, and hours" },
  { label: "Media & Review", icon: Camera, description: "Media, extras, and final review" },
];

const PAYMENT_METHOD_OPTIONS = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "eft", label: "EFT / Bank Transfer" },
  { value: "snapscan", label: "SnapScan" },
  { value: "capitec_pay", label: "Capitec Pay" },
  { value: "other", label: "Other" },
];

const FIELD_IDS: Record<string, string> = {
  business_type: "business-type-group",
  business_name: "businessName",
  slug: "slug",
  category: "category",
  location_province: "province",
  location_city: "city",
  store_number: "storeNumber",
  service_areas: "serviceAreas",
  map_directions: "mapDirections",
  phone: "phone",
  whatsapp: "whatsapp",
  email: "email",
  website: "website",
  socialFacebook: "socialFacebook",
  socialInstagram: "socialInstagram",
  socialTwitter: "socialTwitter",
  socialTiktok: "socialTiktok",
  logo_url: "business-logo",
  cover_photo: "business-cover-photo",
  gallery_photos: "business-gallery",
  cover_video: "business-cover-video",
  video_thumbnail: "business-video-thumbnail",
};

const STEP_CONTACT_FIELDS = ["phone", "whatsapp", "email", "website"] as const;
const STEP_SOCIAL_FIELDS = [
  "socialFacebook",
  "socialInstagram",
  "socialTwitter",
  "socialTiktok",
] as const;

function getFieldId(key: string): string | undefined {
  if (FIELD_IDS[key]) return FIELD_IDS[key];
  if (key.startsWith("business_details.")) {
    return `business-detail-${key.split(".")[1]}`;
  }
  return undefined;
}

function getStepForFieldKey(key: string): number {
  if (
    key === "logo_url" ||
    key === "cover_photo" ||
    key === "gallery_photos" ||
    key === "cover_video" ||
    key === "video_thumbnail" ||
    STEP_SOCIAL_FIELDS.includes(key as (typeof STEP_SOCIAL_FIELDS)[number])
  ) {
    return 2;
  }

  if (
    key === "location_province" ||
    key === "location_city" ||
    STEP_CONTACT_FIELDS.includes(key as (typeof STEP_CONTACT_FIELDS)[number])
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

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
}

export default function CreateBusinessPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Camera className="h-8 w-8 animate-pulse text-muted-foreground" />
        </div>
      }
    >
      <CreateBusinessContent />
    </Suspense>
  );
}

function CreateBusinessContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, profile, isLoading } = useAuth();
  const initialType = (searchParams.get("type") as BusinessType) || "";
  const [step, setStep] = useState(0);
  const [businessType, setBusinessType] = useState<BusinessType | "">(initialType);
  const [businessDetails, setBusinessDetails] = useState<BusinessDetails | null>(
    initialType ? getDefaultBusinessDetails(initialType) : null
  );
  const [businessName, setBusinessName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugManual, setSlugManual] = useState(false);
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<BusinessCategory | "">("");
  const [province, setProvince] = useState("");
  const [city, setCity] = useState("");
  const [locationTown, setLocationTown] = useState("");
  const [locationAddress, setLocationAddress] = useState("");
  const [storeNumber, setStoreNumber] = useState("");
  const [serviceAreasInput, setServiceAreasInput] = useState("");
  const [mapDirections, setMapDirections] = useState("");
  const [phone, setPhone] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [hoursMonFri, setHoursMonFri] = useState("");
  const [hoursSat, setHoursSat] = useState("");
  const [hoursSun, setHoursSun] = useState("");
  const [socialFacebook, setSocialFacebook] = useState("");
  const [socialInstagram, setSocialInstagram] = useState("");
  const [socialTwitter, setSocialTwitter] = useState("");
  const [socialTiktok, setSocialTiktok] = useState("");
  const [servicesInput, setServicesInput] = useState("");
  const [services, setServices] = useState<string[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<string[]>([]);
  const [deliveryOptions, setDeliveryOptions] = useState<string[]>([]);
  const [logoFile, setLogoFile] = useState<File[]>([]);
  const [coverFile, setCoverFile] = useState<File[]>([]);
  const [galleryFiles, setGalleryFiles] = useState<File[]>([]);
  const [mallPhotoFiles, setMallPhotoFiles] = useState<File[]>([]);
  const [promoVideoFile, setPromoVideoFile] = useState<File[]>([]);
  const [videoThumbnailFile, setVideoThumbnailFile] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitProgress, setSubmitProgress] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitSucceeded, setSubmitSucceeded] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const { toast } = useToast();
  const {
    save: saveDraft,
    restore: restoreDraft,
    discard: discardDraft,
  } = usePostDraftAutosave<BusinessDraftData>("business", user?.id, !isLoading);
  const locationValue: LocationValue = {
    province,
    city,
    town: locationTown,
    address: locationAddress,
  };
  const maxPhotos = usePlanMaxPhotos("MZANSI_BUSINESS");
  const coverVideoAllowed = usePlanCoverVideoAllowed("MZANSI_BUSINESS");
  const [layoutTemplate, setLayoutTemplate] = useState<LayoutTemplate | null>(null);

  // Stable blob URLs for logo/cover previews — revoked on change
  const logoPreviewUrl = useMemo(
    () => (logoFile.length > 0 ? URL.createObjectURL(logoFile[0]) : null),
    [logoFile]
  );
  const coverPreviewUrl = useMemo(
    () => (coverFile.length > 0 ? URL.createObjectURL(coverFile[0]) : null),
    [coverFile]
  );
  const galleryPreviewUrls = useMemo(
    () => galleryFiles.map((file) => URL.createObjectURL(file)),
    [galleryFiles]
  );
  const mallPhotoPreviewUrls = useMemo(
    () => mallPhotoFiles.map((file) => URL.createObjectURL(file)),
    [mallPhotoFiles]
  );
  const promoVideoPreviewUrl = useMemo(
    () => (promoVideoFile.length > 0 ? URL.createObjectURL(promoVideoFile[0]) : null),
    [promoVideoFile]
  );
  const videoThumbnailPreviewUrl = useMemo(
    () => (videoThumbnailFile.length > 0 ? URL.createObjectURL(videoThumbnailFile[0]) : null),
    [videoThumbnailFile]
  );
  useEffect(
    () => () => {
      if (logoPreviewUrl) URL.revokeObjectURL(logoPreviewUrl);
    },
    [logoPreviewUrl]
  );
  useEffect(
    () => () => {
      if (coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl);
    },
    [coverPreviewUrl]
  );
  useEffect(
    () => () => {
      galleryPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
    },
    [galleryPreviewUrls]
  );
  useEffect(
    () => () => {
      mallPhotoPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
    },
    [mallPhotoPreviewUrls]
  );
  useEffect(
    () => () => {
      if (promoVideoPreviewUrl) URL.revokeObjectURL(promoVideoPreviewUrl);
    },
    [promoVideoPreviewUrl]
  );
  useEffect(
    () => () => {
      if (videoThumbnailPreviewUrl) URL.revokeObjectURL(videoThumbnailPreviewUrl);
    },
    [videoThumbnailPreviewUrl]
  );

  useEffect(() => {
    if (!slugManual && businessName) {
      setSlug(generateSlug(businessName));
    }
  }, [businessName, slugManual]);

  useEffect(() => {
    if (!profile) return;

    if (!province && profile.location_province) {
      setProvince(profile.location_province);
    }

    if (!city && profile.location_city && (!province || province === profile.location_province)) {
      setCity(profile.location_city);
    }

    if (!phone && profile.phone) {
      setPhone(profile.phone);
    }

    if (!whatsapp && profile.phone) {
      setWhatsapp(profile.phone);
    }
  }, [profile, province, city, phone, whatsapp]);

  useEffect(() => {
    if (!email && user?.email) {
      setEmail(user.email);
    }
  }, [email, user?.email]);

  useEffect(() => {
    if (!user?.id || isLoading || submitSucceeded) return;

    const restored = restoreDraft();
    if (!restored) return;

    const restoredData = restored.data;
    const restoredType = (restoredData.businessType as BusinessType) || "";

    setStep(Math.min(Math.max(restored.step ?? 0, 0), STEPS.length - 1));
    setBusinessType(restoredType);
    if (restoredType) {
      const fallbackDetails = getDefaultBusinessDetails(restoredType);
      const restoredDetails =
        restoredData.businessDetails && typeof restoredData.businessDetails === "object"
          ? (restoredData.businessDetails as unknown as BusinessDetails)
          : fallbackDetails;
      setBusinessDetails(coerceBusinessDetails(restoredType, restoredDetails));
    } else {
      setBusinessDetails(null);
    }

    setBusinessName(restoredData.businessName ?? "");
    setSlug(restoredData.slug ?? "");
    setSlugManual(Boolean(restoredData.slugManual));
    setDescription(restoredData.description ?? "");
    setCategory((restoredData.category as BusinessCategory | "") ?? "");
    setProvince(restoredData.province ?? "");
    setCity(restoredData.city ?? "");
    setLocationTown(restoredData.locationTown ?? "");
    setLocationAddress(restoredData.locationAddress ?? "");
    setStoreNumber(restoredData.storeNumber ?? "");
    setServiceAreasInput(restoredData.serviceAreasInput ?? "");
    setMapDirections(restoredData.mapDirections ?? "");
    setPhone(restoredData.phone ?? "");
    setWhatsapp(restoredData.whatsapp ?? "");
    setEmail(restoredData.email ?? "");
    setWebsite(restoredData.website ?? "");
    setHoursMonFri(restoredData.hoursMonFri ?? "");
    setHoursSat(restoredData.hoursSat ?? "");
    setHoursSun(restoredData.hoursSun ?? "");
    setSocialFacebook(restoredData.socialFacebook ?? "");
    setSocialInstagram(restoredData.socialInstagram ?? "");
    setSocialTwitter(restoredData.socialTwitter ?? "");
    setSocialTiktok(restoredData.socialTiktok ?? "");
    setServicesInput(restoredData.servicesInput ?? "");
    setServices(Array.isArray(restoredData.services) ? restoredData.services : []);
    setPaymentMethods(
      Array.isArray(restoredData.paymentMethods) ? restoredData.paymentMethods : []
    );
    setDeliveryOptions(
      Array.isArray(restoredData.deliveryOptions) ? restoredData.deliveryOptions : []
    );
    setLayoutTemplate(
      restoredData.selectedLayout ? (restoredData.selectedLayout as LayoutTemplate) : null
    );
    setLastSavedAt(restored.savedAt ?? null);
    toast({
      title: "Draft restored",
      description: "You can continue from where you left off.",
      variant: "success",
    });
  }, [user?.id, isLoading, submitSucceeded, restoreDraft, toast]);

  useEffect(() => {
    if (!user?.id || isLoading || isSubmitting || submitSucceeded) return;

    saveDraft(step, {
      businessType,
      businessName,
      slug,
      slugManual,
      description,
      category,
      province,
      city,
      locationTown,
      locationAddress,
      storeNumber,
      serviceAreasInput,
      mapDirections,
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
      servicesInput,
      services,
      paymentMethods,
      deliveryOptions,
      businessDetails: businessDetails as Record<string, unknown> | null,
      selectedLayout: layoutTemplate || "",
    });
    setLastSavedAt(Date.now());
  }, [
    user?.id,
    isLoading,
    isSubmitting,
    submitSucceeded,
    saveDraft,
    step,
    businessType,
    businessName,
    slug,
    slugManual,
    description,
    category,
    province,
    city,
    locationTown,
    locationAddress,
    storeNumber,
    serviceAreasInput,
    mapDirections,
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
    servicesInput,
    services,
    paymentMethods,
    deliveryOptions,
    businessDetails,
    layoutTemplate,
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

  function clearErrorPrefix(prefix: string) {
    setFieldErrors((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(prefix)))
    );
  }

  function focusFirstError(errors: Record<string, string>, targetStep = step) {
    const businessDetailKeys = Object.keys(errors).filter((key) =>
      key.startsWith("business_details.")
    );
    const orderByStep = [
      [
        "business_type",
        "store_number",
        "service_areas",
        "map_directions",
        ...businessDetailKeys,
        "business_name",
        "slug",
        "category",
      ],
      ["location_province", "location_city", ...STEP_CONTACT_FIELDS],
      ["gallery_photos", "cover_video", ...STEP_SOCIAL_FIELDS],
    ][targetStep];
    const firstKey = orderByStep.find((key) => errors[key]) ?? Object.keys(errors)[0];
    const targetId = getFieldId(firstKey);
    if (!targetId) return;
    requestAnimationFrame(() => {
      const element = document.getElementById(targetId);
      element?.focus();
      element?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  function addService() {
    const trimmed = servicesInput.trim();
    if (trimmed && !services.includes(trimmed) && services.length < 30) {
      setServices((current) => [...current, trimmed]);
      setServicesInput("");
    }
  }

  function removeService(index: number) {
    setServices((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  function togglePaymentMethod(method: string) {
    setPaymentMethods((current) =>
      current.includes(method) ? current.filter((item) => item !== method) : [...current, method]
    );
  }

  function setDeliveryAvailable(deliveryAvailable: boolean) {
    setDeliveryOptions(getNormalizedDeliveryOptions(deliveryAvailable));
  }

  function clearOnlineOnlyDeliveryDetails() {
    setBusinessDetails((current) => {
      if (businessType !== "online_only" || !current || current.type !== "online_only") {
        return current;
      }

      const { delivery_regions: _deliveryRegions, ...rest } = current;
      return rest as BusinessDetails;
    });
    clearErrors("business_details.delivery_regions");
  }

  function validateStep(targetStep: number) {
    const errors: Record<string, string> = {};
    const businessValidationErrors = validateBusinessForm({
      businessType,
      businessDetails,
      storeNumber: storeNumber.trim(),
      serviceAreasInput,
      mapDirections: mapDirections.trim(),
      phone: phone.trim(),
      whatsapp: whatsapp.trim(),
      email: email.trim(),
      website: website.trim(),
      socialFacebook: socialFacebook.trim(),
      socialInstagram: socialInstagram.trim(),
      socialTwitter: socialTwitter.trim(),
      socialTiktok: socialTiktok.trim(),
    });
    if (targetStep === 0) {
      if (!businessType) errors.business_type = "Choose a business type.";
      if (!businessName.trim()) errors.business_name = "Enter a business name.";
      else if (businessName.trim().length < 2)
        errors.business_name = "Business name must be at least 2 characters.";
      const currentSlug = (slug || generateSlug(businessName)).trim();
      if (!currentSlug) errors.slug = "Enter a valid URL slug.";
      else if (!/^[a-z0-9-]+$/.test(currentSlug))
        errors.slug = "Use lowercase letters, numbers, and hyphens only.";
      if (!category) errors.category = "Select a category.";
      for (const [key, message] of Object.entries(businessValidationErrors)) {
        if (
          key === "store_number" ||
          key === "service_areas" ||
          key === "map_directions" ||
          key.startsWith("business_details.")
        ) {
          errors[key] = message;
        }
      }
    }
    if (targetStep === 1) {
      if (!province) errors.location_province = "Select a province.";
      if (!city) errors.location_city = "Select a city.";
      for (const field of STEP_CONTACT_FIELDS) {
        if (businessValidationErrors[field]) {
          errors[field] = businessValidationErrors[field];
        }
      }
    }
    if (targetStep === 2) {
      if (galleryFiles.length > maxPhotos) {
        errors.gallery_photos = `You can upload up to ${maxPhotos} profile photos on this plan.`;
      }
      if (promoVideoFile.length > 0 && !coverVideoAllowed) {
        errors.cover_video = "Cover video is not available on your current plan.";
      }
      for (const key of STEP_SOCIAL_FIELDS) {
        if (businessValidationErrors[key]) {
          errors[key] = businessValidationErrors[key];
        }
      }
    }
    return errors;
  }

  function goNext() {
    const errors = validateStep(step);
    if (Object.keys(errors).length > 0) {
      setFieldErrors((current) => ({ ...current, ...errors }));
      setFormError(
        "Some required fields are missing or invalid. Check the highlighted fields above."
      );
      focusFirstError(errors);
      return;
    }
    clearErrors();
    setStep((current) => Math.min(current + 1, STEPS.length - 1));
  }

  function goBack() {
    clearErrors();
    setStep((current) => Math.max(current - 1, 0));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const stepErrors = [0, 1, 2].map((index) => validateStep(index));
    const firstInvalidStep = stepErrors.findIndex((errors) => Object.keys(errors).length > 0);
    if (firstInvalidStep !== -1) {
      setStep(firstInvalidStep);
      setFieldErrors(stepErrors[firstInvalidStep]);
      setFormError(
        "Some required fields are missing or invalid. Check the highlighted fields above."
      );
      focusFirstError(stepErrors[firstInvalidStep], firstInvalidStep);
      return;
    }
    clearErrors();
    setIsSubmitting(true);
    setSubmitProgress("Uploading media...");
    try {
      const [logoUrls, coverUrls, galleryUrls, mallPhotoUrls, videoUrl] = await Promise.all([
        uploadRequiredBusinessMedia({
          files: logoFile,
          area: "business_logo",
          field: "logo_url",
        }),
        uploadRequiredBusinessMedia({
          files: coverFile,
          area: "business_cover",
          field: "cover_photo",
        }),
        uploadRequiredBusinessMedia({
          files: galleryFiles,
          area: "business_gallery",
          field: "gallery_photos",
        }),
        uploadRequiredBusinessMedia({
          files: mallPhotoFiles,
          area: "business_gallery",
          field: "gallery_photos",
        }),
        promoVideoFile.length > 0
          ? uploadRequiredBusinessVideo({
              file: promoVideoFile[0],
              area: "business_cover",
            })
          : Promise.resolve(null),
      ]);
      const finalCoverPhoto = coverUrls[0] || null;
      const finalCoverVideo = videoUrl;
      let finalVideoThumbnail: string | null = null;
      if (finalCoverVideo && videoThumbnailFile.length > 0) {
        const thumbUrls = await uploadRequiredBusinessMedia({
          files: videoThumbnailFile,
          area: "business_cover",
          field: "video_thumbnail",
        });
        finalVideoThumbnail = thumbUrls[0] || null;
      }

      setSubmitProgress("Saving business...");

      const socialLinks: Record<string, string> = {};
      if (socialFacebook) socialLinks.facebook = socialFacebook;
      if (socialInstagram) socialLinks.instagram = socialInstagram;
      if (socialTwitter) socialLinks.twitter = socialTwitter;
      if (socialTiktok) socialLinks.tiktok = socialTiktok;
      const operatingHours: Record<string, string> = {};
      if (hoursMonFri) operatingHours.Mon_Fri = hoursMonFri;
      if (hoursSat) operatingHours.Sat = hoursSat;
      if (hoursSun) operatingHours.Sun = hoursSun;
      const serviceAreas =
        businessType === "mobile_service"
          ? {
              areas: parseServiceAreas(serviceAreasInput),
            }
          : undefined;
      const normalizedBusinessDetails = businessType
        ? coerceBusinessDetails(businessType, businessDetails)
        : undefined;
      const deliveryAvailable = deliveryOptions.length > 0;
      const finalBusinessDetails =
        normalizedBusinessDetails?.type === "mall_store"
          ? { ...normalizedBusinessDetails, mall_photos: mallPhotoUrls }
          : normalizedBusinessDetails
            ? sanitizeBusinessDetailsForSubmission(normalizedBusinessDetails, deliveryAvailable)
            : undefined;
      const normalizedDeliveryOptions = getNormalizedDeliveryOptions(deliveryAvailable);
      const body = {
        business_name: businessName.trim(),
        slug: (slug || generateSlug(businessName)).trim(),
        business_type: businessType,
        category,
        description: description.trim(),
        location_province: province,
        location_city: city,
        location_town: locationTown || undefined,
        location_address: locationAddress || undefined,
        store_number: businessType === "mall_store" ? storeNumber : undefined,
        map_directions: mapDirections || undefined,
        phone: phone || undefined,
        whatsapp: whatsapp || undefined,
        email: email || undefined,
        website: website || undefined,
        logo_url: logoUrls[0] || undefined,
        cover_photo: finalCoverPhoto || undefined,
        cover_video: finalCoverVideo || undefined,
        video_thumbnail: finalVideoThumbnail || undefined,
        gallery_photos: galleryUrls.length > 0 ? galleryUrls : undefined,
        services_offered: services.length > 0 ? services : undefined,
        service_areas: serviceAreas,
        business_details: finalBusinessDetails,
        operating_hours: Object.keys(operatingHours).length > 0 ? operatingHours : undefined,
        payment_methods_accepted: paymentMethods.length > 0 ? paymentMethods : undefined,
        delivery_options:
          normalizedDeliveryOptions.length > 0 ? normalizedDeliveryOptions : undefined,
        social_links: Object.keys(socialLinks).length > 0 ? socialLinks : undefined,
        layout_template: layoutTemplate || undefined,
      };
      const res = await fetch("/api/businesses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        const normalized = normalizeCreatePostError(payload, "Failed to create business.");
        const targetStep = getStepForServerErrors(normalized.fieldErrors);
        setStep(targetStep);
        setFieldErrors(normalized.fieldErrors);
        setFormError(normalized.formError);
        focusFirstError(normalized.fieldErrors, targetStep);
        return;
      }
      toast({ title: "Business submitted for review.", variant: "success" });
      setSubmitSucceeded(true);
      discardDraft();
      router.push("/dashboard/listings?area=MZANSI_BUSINESS&created=business");
    } catch (error: unknown) {
      const uploadFailure = getBusinessMediaUploadErrorState(error);
      if (uploadFailure) {
        setStep(2);
        setFieldErrors((current) => ({ ...current, ...uploadFailure.fieldErrors }));
        setFormError(uploadFailure.formError);
        focusFirstError(uploadFailure.fieldErrors, 2);
        return;
      }

      setFormError(normalizeCreatePostRuntimeError(error, "Something went wrong."));
    } finally {
      setIsSubmitting(false);
      setSubmitProgress(null);
    }
  }

  function handleDiscardDraft() {
    discardDraft();
    setStep(0);
    setBusinessType(initialType);
    setBusinessDetails(initialType ? getDefaultBusinessDetails(initialType) : null);
    setBusinessName("");
    setSlug("");
    setSlugManual(false);
    setDescription("");
    setCategory("");
    setProvince(profile?.location_province ?? "");
    setCity(profile?.location_city ?? "");
    setLocationTown("");
    setLocationAddress("");
    setStoreNumber("");
    setServiceAreasInput("");
    setMapDirections("");
    setPhone(profile?.phone ?? "");
    setWhatsapp(profile?.phone ?? "");
    setEmail(user?.email ?? "");
    setWebsite("");
    setHoursMonFri("");
    setHoursSat("");
    setHoursSun("");
    setSocialFacebook("");
    setSocialInstagram("");
    setSocialTwitter("");
    setSocialTiktok("");
    setServicesInput("");
    setServices([]);
    setPaymentMethods([]);
    setDeliveryOptions([]);
    setLogoFile([]);
    setCoverFile([]);
    setGalleryFiles([]);
    setMallPhotoFiles([]);
    setPromoVideoFile([]);
    setVideoThumbnailFile([]);
    setLayoutTemplate(null);
    setFieldErrors({});
    setFormError(null);
    setLastSavedAt(null);
    toast({
      title: "Draft discarded",
      description: "You can start a fresh business profile now.",
      variant: "success",
    });
  }

  function renderReview() {
    const selectedType = BUSINESS_TYPE_OPTIONS.find((option) => option.value === businessType);
    const serviceAreas = parseServiceAreas(serviceAreasInput);
    const socialLinks = Object.fromEntries(
      Object.entries({
        facebook: socialFacebook,
        instagram: socialInstagram,
        twitter: socialTwitter,
        tiktok: socialTiktok,
      }).filter(([, value]) => value.trim().length > 0)
    );
    const previewBusinessDetails = businessType
      ? coerceBusinessDetails(businessType, businessDetails)
      : businessDetails;
    const deliveryAvailable = deliveryOptions.length > 0;
    const previewMallDetails =
      previewBusinessDetails?.type === "mall_store"
        ? { ...previewBusinessDetails, mall_photos: mallPhotoPreviewUrls }
        : previewBusinessDetails
          ? sanitizeBusinessDetailsForSubmission(previewBusinessDetails, deliveryAvailable)
          : previewBusinessDetails;
    const normalizedDeliveryOptions = getNormalizedDeliveryOptions(deliveryAvailable);

    const effectiveCategory = (category || "general_other") as BusinessCategory;
    const effectiveLayout = resolveBusinessLayout(layoutTemplate, effectiveCategory);

    const previewBusiness = {
      id: "preview-business",
      owner_id: "preview-seller",
      business_name: businessName || "Your business name",
      description: description || "Your business description will appear here.",
      status: "preview",
      business_type: businessType || selectedType?.value || "standalone_shop",
      category: category || "general_other",
      cover_photo: coverPreviewUrl,
      logo_url: logoPreviewUrl,
      cover_video: promoVideoPreviewUrl,
      video_thumbnail: videoThumbnailPreviewUrl,
      gallery_photos: galleryPreviewUrls,
      social_links: Object.keys(socialLinks).length > 0 ? socialLinks : null,
      operating_hours: {
        ...(hoursMonFri ? { Mon_Fri: hoursMonFri } : {}),
        ...(hoursSat ? { Sat: hoursSat } : {}),
        ...(hoursSun ? { Sun: hoursSun } : {}),
      },
      services_offered: services,
      payment_methods_accepted: paymentMethods,
      delivery_options: normalizedDeliveryOptions,
      service_areas: serviceAreas.length > 0 ? { areas: serviceAreas } : null,
      location_city: city || null,
      location_province: province || null,
      location_town: locationTown || null,
      location_address: locationAddress || null,
      phone: phone || null,
      whatsapp: whatsapp || null,
      email: email || null,
      website: website || null,
      store_number: storeNumber || null,
      map_directions: mapDirections || null,
      business_details: previewMallDetails,
      layout_template: layoutTemplate,
    };

    return (
      <div className="space-y-6">
        {/* Layout chooser */}
        <LayoutChooser
          selected={effectiveLayout}
          onChange={(id) => setLayoutTemplate(id)}
          category={category ? (category as BusinessCategory) : undefined}
        />

        {/* Device preview with layout router */}
        <div className="rounded-xl border border-dashed border-brand-blue/30 bg-brand-blue/5 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Building2 className="h-4 w-4" />
            Preview how your profile will look
          </div>
          <DevicePreviewShell>
            <BusinessLayoutRouter
              business={previewBusiness as BusinessDetailRecord}
              trustLevel={null}
              ownerProfile={{ display_name: "You" }}
              promotions={[]}
              showPromotions={false}
              showPublicActions={false}
              layoutOverride={effectiveLayout}
            />
          </DevicePreviewShell>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <Header isAuthenticated />
      <main className="flex-1">
        <div className="container-page py-6">
          <PlanGate area="MZANSI_BUSINESS">
            <form noValidate onSubmit={handleSubmit}>
              <PostFormScaffold
                title="Create a Mzansi Business Profile"
                description="Set up a clear, professional business profile that helps customers trust and contact you."
                breadcrumbs={[
                  { label: "Dashboard", href: "/dashboard" },
                  { label: "Create Post", href: "/post/create" },
                  { label: "Mzansi Business" },
                ]}
                badgeLabel="Mzansi Business"
                badgeClassName="bg-brand-blue text-white"
                guideDescription="Choose your business type, add the key details customers need, and submit your profile for review."
                steps={STEPS}
                currentStep={step}
                error={formError}
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
                          className="font-medium text-brand-blue hover:underline"
                        >
                          Discard draft
                        </button>
                      </div>
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
                  <div className="space-y-5">
                    <div id="business-type-group" tabIndex={-1} className="space-y-3">
                      <Label>Business Type *</Label>
                      <div
                        role="radiogroup"
                        aria-label="Business type"
                        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
                      >
                        {BUSINESS_TYPE_OPTIONS.map((option) => {
                          const Icon = option.icon;
                          const isSelected = businessType === option.value;
                          return (
                            <label
                              key={option.value}
                              className={cn(
                                "cursor-pointer rounded-xl border-2 p-4 text-left transition-all",
                                isSelected
                                  ? "border-brand-blue bg-brand-blue/5 ring-1 ring-brand-blue/20"
                                  : "border-border hover:border-brand-blue/30"
                              )}
                            >
                              <input
                                type="radio"
                                name="business-type"
                                value={option.value}
                                checked={isSelected}
                                onChange={() => {
                                  setBusinessType(option.value);
                                  setBusinessDetails(getDefaultBusinessDetails(option.value));
                                  if (option.value !== "mall_store") {
                                    setStoreNumber("");
                                    setMallPhotoFiles([]);
                                  }
                                  if (option.value !== "mobile_service") {
                                    setServiceAreasInput("");
                                  }
                                  if (
                                    ![
                                      "mall_store",
                                      "standalone_shop",
                                      "home_business",
                                      "market_stall",
                                    ].includes(option.value)
                                  ) {
                                    setMapDirections("");
                                  }
                                  clearErrors(
                                    "business_type",
                                    "store_number",
                                    "service_areas",
                                    "map_directions"
                                  );
                                  clearErrorPrefix("business_details.");
                                }}
                                className="sr-only"
                              />
                              <Icon
                                className={cn(
                                  "mb-2 h-6 w-6",
                                  isSelected ? "text-brand-blue" : "text-muted-foreground"
                                )}
                              />
                              <p className="text-sm font-medium">{option.label}</p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {option.description}
                              </p>
                            </label>
                          );
                        })}
                      </div>
                      {fieldErrors.business_type && (
                        <p className="inline-form-error">{fieldErrors.business_type}</p>
                      )}
                    </div>

                    {businessType && businessDetails && (
                      <BusinessTypeDetailsFields
                        businessType={businessType}
                        businessDetails={businessDetails}
                        onBusinessDetailsChange={(name, value) => {
                          setBusinessDetails((current) => {
                            const next = coerceBusinessDetails(
                              businessType,
                              current ?? getDefaultBusinessDetails(businessType)
                            );
                            return { ...next, [name]: value } as BusinessDetails;
                          });
                          clearErrors(`business_details.${name}`);
                        }}
                        deliveryAvailable={deliveryOptions.length > 0}
                        onDeliveryAvailableChange={(nextDeliveryAvailable) => {
                          setDeliveryAvailable(nextDeliveryAvailable);
                          if (!nextDeliveryAvailable) {
                            clearOnlineOnlyDeliveryDetails();
                          }
                        }}
                        storeNumber={storeNumber}
                        onStoreNumberChange={(value) => {
                          setStoreNumber(value);
                          clearErrors("store_number");
                        }}
                        serviceAreasInput={serviceAreasInput}
                        onServiceAreasChange={(value) => {
                          setServiceAreasInput(value);
                          clearErrors("service_areas");
                        }}
                        mapDirections={mapDirections}
                        onMapDirectionsChange={(value) => {
                          setMapDirections(value);
                          clearErrors("map_directions");
                        }}
                        fieldErrors={fieldErrors}
                        selectClassName={SELECT_CLASS}
                      />
                    )}

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="businessName">Business Name *</Label>
                        <span className="text-xs text-muted-foreground">
                          {businessName.length}/100
                        </span>
                      </div>
                      <Input
                        id="businessName"
                        value={businessName}
                        onChange={(event) => {
                          setBusinessName(event.target.value);
                          clearErrors("business_name", "slug");
                        }}
                        placeholder="e.g. Nomsa's Fashion Boutique"
                        maxLength={100}
                        aria-invalid={!!fieldErrors.business_name}
                        className={cn(fieldErrors.business_name && "border-destructive")}
                      />
                      {fieldErrors.business_name && (
                        <p className="inline-form-error">{fieldErrors.business_name}</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="slug">URL Slug *</Label>
                      <Input
                        id="slug"
                        value={slug}
                        onChange={(event) => {
                          setSlugManual(true);
                          setSlug(generateSlug(event.target.value));
                          clearErrors("slug");
                        }}
                        placeholder="your-business-name"
                        maxLength={60}
                        aria-invalid={!!fieldErrors.slug}
                        className={cn(fieldErrors.slug && "border-destructive")}
                      />
                      <p className="text-xs text-muted-foreground">
                        Keep it short and readable. We use lowercase letters, numbers, and hyphens
                        only.
                      </p>
                      {fieldErrors.slug && <p className="inline-form-error">{fieldErrors.slug}</p>}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="category">Category *</Label>
                      <select
                        id="category"
                        aria-label="Category"
                        className={cn(SELECT_CLASS, fieldErrors.category && "border-destructive")}
                        value={category}
                        onChange={(event) => {
                          setCategory(event.target.value as BusinessCategory);
                          clearErrors("category");
                        }}
                      >
                        <option value="">Select a category</option>
                        {BUSINESS_CATEGORIES.map((item) => (
                          <option key={item.value} value={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                      {fieldErrors.category && (
                        <p className="inline-form-error">{fieldErrors.category}</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="description">About Your Business</Label>
                        <span className="text-xs text-muted-foreground">
                          {description.length}/3000
                        </span>
                      </div>
                      <Textarea
                        id="description"
                        value={description}
                        onChange={(event) => setDescription(event.target.value)}
                        placeholder="Describe what you offer, who you help, and what makes your business reliable."
                        rows={5}
                        maxLength={3000}
                      />
                    </div>
                  </div>
                )}

                {step === 1 && (
                  <div className="space-y-5">
                    <LocationSelector
                      value={locationValue}
                      onChange={(v) => {
                        setProvince(v.province);
                        setCity(v.city);
                        setLocationTown(v.town ?? "");
                        setLocationAddress(v.address ?? "");
                        clearErrors("location_province", "location_city");
                      }}
                      showTown
                      showAddress
                      errors={{
                        province: fieldErrors.location_province,
                        city: fieldErrors.location_city,
                      }}
                    />

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="phone" className="flex items-center gap-2">
                          <Phone className="h-4 w-4 text-muted-foreground" />
                          Phone Number
                        </Label>
                        <Input
                          id="phone"
                          inputMode="tel"
                          autoComplete="tel"
                          value={phone}
                          onChange={(event) => {
                            setPhone(event.target.value);
                            clearErrors("phone");
                          }}
                          placeholder="082 000 0000"
                          className={cn(fieldErrors.phone && "border-destructive")}
                        />
                        {fieldErrors.phone && (
                          <p className="inline-form-error">{fieldErrors.phone}</p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="whatsapp" className="flex items-center gap-2">
                          <MessageCircle className="h-4 w-4 text-green-600" />
                          WhatsApp
                        </Label>
                        <Input
                          id="whatsapp"
                          inputMode="tel"
                          autoComplete="tel"
                          value={whatsapp}
                          onChange={(event) => {
                            setWhatsapp(event.target.value);
                            clearErrors("whatsapp");
                          }}
                          placeholder="082 000 0000"
                          className={cn(fieldErrors.whatsapp && "border-destructive")}
                        />
                        {fieldErrors.whatsapp && (
                          <p className="inline-form-error">{fieldErrors.whatsapp}</p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="email" className="flex items-center gap-2">
                          <Mail className="h-4 w-4 text-muted-foreground" />
                          Email Address
                        </Label>
                        <Input
                          id="email"
                          type="email"
                          inputMode="email"
                          autoComplete="email"
                          value={email}
                          onChange={(event) => {
                            setEmail(event.target.value);
                            clearErrors("email");
                          }}
                          placeholder="contact@business.co.za"
                          className={cn(fieldErrors.email && "border-destructive")}
                        />
                        {fieldErrors.email && (
                          <p className="inline-form-error">{fieldErrors.email}</p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="website" className="flex items-center gap-2">
                          <Globe className="h-4 w-4 text-muted-foreground" />
                          Website
                        </Label>
                        <Input
                          id="website"
                          autoComplete="url"
                          value={website}
                          onChange={(event) => {
                            setWebsite(event.target.value);
                            clearErrors("website");
                          }}
                          placeholder="https://www.yourbusiness.co.za"
                          className={cn(fieldErrors.website && "border-destructive")}
                        />
                        {fieldErrors.website && (
                          <p className="inline-form-error">{fieldErrors.website}</p>
                        )}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <Label className="text-base font-semibold">Operating Hours</Label>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                        <div className="space-y-1.5">
                          <Label htmlFor="hoursMonFri" className="text-xs text-muted-foreground">
                            Mon - Fri
                          </Label>
                          <Input
                            id="hoursMonFri"
                            value={hoursMonFri}
                            onChange={(event) => setHoursMonFri(event.target.value)}
                            placeholder="e.g. 09:00 - 17:00"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="hoursSat" className="text-xs text-muted-foreground">
                            Saturday
                          </Label>
                          <Input
                            id="hoursSat"
                            value={hoursSat}
                            onChange={(event) => setHoursSat(event.target.value)}
                            placeholder="e.g. 09:00 - 14:00"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="hoursSun" className="text-xs text-muted-foreground">
                            Sunday / Public Holidays
                          </Label>
                          <Input
                            id="hoursSun"
                            value={hoursSun}
                            onChange={(event) => setHoursSun(event.target.value)}
                            placeholder="e.g. Closed"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {step === 2 && (
                  <div className="space-y-5">
                    <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                      <div id="business-logo" tabIndex={-1} className="space-y-2 rounded-lg">
                        <MediaUpload
                          label="Business logo (optional)"
                          maxFiles={1}
                          files={logoFile}
                          onChange={(files) => {
                            setLogoFile(files);
                            clearErrors("logo_url");
                          }}
                          accept="image/*"
                        />
                        {fieldErrors.logo_url && (
                          <p className="inline-form-error">{fieldErrors.logo_url}</p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          Square icon (96×96) shown beside your business name on cards and search
                          results.
                        </p>
                      </div>
                      <div id="business-cover-photo" tabIndex={-1} className="space-y-2 rounded-lg">
                        <MediaUpload
                          label="Cover photo (optional)"
                          maxFiles={1}
                          files={coverFile}
                          onChange={(files) => {
                            setCoverFile(files);
                            clearErrors("cover_photo");
                          }}
                          accept="image/*"
                        />
                        {fieldErrors.cover_photo && (
                          <p className="inline-form-error">{fieldErrors.cover_photo}</p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          Wide banner displayed at the top of your business page. Recommended size:
                          1200×400.
                        </p>
                      </div>
                    </div>

                    {/* Visual placement preview */}
                    <div className="rounded-xl border border-dashed border-brand-blue/20 bg-brand-blue/5 p-4 space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">
                        How your logo and cover will appear:
                      </p>
                      <div className="relative rounded-lg overflow-hidden border bg-muted">
                        {/* Cover preview */}
                        <div className="aspect-[4/1] bg-gradient-to-r from-brand-blue/30 to-brand-blue/10 flex items-center justify-center">
                          {coverPreviewUrl ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img
                              src={coverPreviewUrl}
                              alt="Cover preview"
                              className="w-full h-full object-cover"
                              width={600}
                              height={150}
                            />
                          ) : (
                            <span className="text-xs text-muted-foreground">Cover photo area</span>
                          )}
                        </div>
                        {/* Logo overlay */}
                        <div className="absolute bottom-2 left-4 h-12 w-12 rounded-lg bg-white dark:bg-warm-900 p-1 shadow-md border overflow-hidden">
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
                              <Store className="h-5 w-5 text-muted-foreground" />
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-4 text-[10px] text-muted-foreground">
                        <span>
                          ← <strong>Logo</strong> (small square icon)
                        </span>
                        <span>
                          ↑ <strong>Cover</strong> (wide banner behind logo)
                        </span>
                      </div>
                    </div>

                    <div id="business-gallery" className="space-y-2 rounded-lg">
                      <MediaUpload
                        label={`Profile photos (up to ${maxPhotos})`}
                        maxFiles={maxPhotos}
                        files={galleryFiles}
                        onChange={(files) => {
                          setGalleryFiles(files);
                          clearErrors("gallery_photos");
                        }}
                        accept="image/*"
                      />
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Camera className="h-3 w-3" />
                        Use clear photos of your products, team, premises, or completed work.
                      </p>
                      {galleryFiles.length > 1 && (
                        <div className="space-y-1">
                          <p className="text-xs font-medium text-muted-foreground">
                            Reorder photos. The first image appears on cards.
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {galleryFiles.map((file, index) => (
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
                                    const reordered = [...galleryFiles];
                                    [reordered[index - 1], reordered[index]] = [
                                      reordered[index],
                                      reordered[index - 1],
                                    ];
                                    setGalleryFiles(reordered);
                                  }}
                                  className="rounded p-0.5 hover:bg-background disabled:opacity-30"
                                  aria-label="Move photo left"
                                >
                                  <ChevronLeft className="h-3 w-3" />
                                </button>
                                <button
                                  type="button"
                                  disabled={index === galleryFiles.length - 1}
                                  onClick={() => {
                                    const reordered = [...galleryFiles];
                                    [reordered[index], reordered[index + 1]] = [
                                      reordered[index + 1],
                                      reordered[index],
                                    ];
                                    setGalleryFiles(reordered);
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
                      {fieldErrors.gallery_photos && (
                        <p className="inline-form-error">{fieldErrors.gallery_photos}</p>
                      )}
                    </div>

                    {businessType === "mall_store" && (
                      <div className="space-y-2 rounded-lg">
                        <MediaUpload
                          label="Mall photos (optional, up to 5)"
                          maxFiles={5}
                          files={mallPhotoFiles}
                          onChange={setMallPhotoFiles}
                          accept="image/*"
                        />
                        <p className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Camera className="h-3 w-3" />
                          Add optional photos of the mall entrance, corridors, or landmarks that
                          help customers find you.
                        </p>
                      </div>
                    )}

                    <div id="business-cover-video" className="space-y-2 rounded-lg">
                      <MediaUpload
                        label={`Promo video (optional)${!coverVideoAllowed ? " — Upgrade to unlock" : ""}`}
                        maxFiles={1}
                        files={promoVideoFile}
                        onChange={(files) => {
                          setPromoVideoFile(files);
                          if (files.length === 0) setVideoThumbnailFile([]);
                          clearErrors("cover_video", "video_thumbnail");
                        }}
                        accept="video/*"
                        disabled={!coverVideoAllowed}
                      />
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Film className="h-3 w-3" />A short intro video works best. Keep it focused
                        and easy to watch on mobile.
                      </p>
                      {fieldErrors.cover_video && (
                        <p className="inline-form-error">{fieldErrors.cover_video}</p>
                      )}
                    </div>

                    {promoVideoFile.length > 0 && (
                      <div
                        id="business-video-thumbnail"
                        tabIndex={-1}
                        className="space-y-2 rounded-lg"
                      >
                        <MediaUpload
                          label="Video thumbnail (optional)"
                          maxFiles={1}
                          files={videoThumbnailFile}
                          onChange={(files) => {
                            setVideoThumbnailFile(files);
                            clearErrors("video_thumbnail");
                          }}
                          accept="image/*"
                        />
                        {fieldErrors.video_thumbnail && (
                          <p className="inline-form-error">{fieldErrors.video_thumbnail}</p>
                        )}
                      </div>
                    )}

                    <details className="rounded-xl border bg-muted/30 p-4">
                      <summary className="cursor-pointer list-none font-medium">
                        Optional extras
                      </summary>
                      <div className="mt-4 space-y-5">
                        <div className="space-y-3">
                          <h3 className="text-sm font-medium">Social Links</h3>
                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <Input
                              id="socialFacebook"
                              value={socialFacebook}
                              onChange={(event) => {
                                setSocialFacebook(event.target.value);
                                clearErrors("socialFacebook");
                              }}
                              placeholder="Facebook URL"
                              className={cn(fieldErrors.socialFacebook && "border-destructive")}
                            />
                            {fieldErrors.socialFacebook && (
                              <p className="inline-form-error">{fieldErrors.socialFacebook}</p>
                            )}
                            <Input
                              id="socialInstagram"
                              value={socialInstagram}
                              onChange={(event) => {
                                setSocialInstagram(event.target.value);
                                clearErrors("socialInstagram");
                              }}
                              placeholder="Instagram URL"
                              className={cn(fieldErrors.socialInstagram && "border-destructive")}
                            />
                            {fieldErrors.socialInstagram && (
                              <p className="inline-form-error">{fieldErrors.socialInstagram}</p>
                            )}
                            <Input
                              id="socialTwitter"
                              value={socialTwitter}
                              onChange={(event) => {
                                setSocialTwitter(event.target.value);
                                clearErrors("socialTwitter");
                              }}
                              placeholder="X (Twitter) URL"
                              className={cn(fieldErrors.socialTwitter && "border-destructive")}
                            />
                            {fieldErrors.socialTwitter && (
                              <p className="inline-form-error">{fieldErrors.socialTwitter}</p>
                            )}
                            <Input
                              id="socialTiktok"
                              value={socialTiktok}
                              onChange={(event) => {
                                setSocialTiktok(event.target.value);
                                clearErrors("socialTiktok");
                              }}
                              placeholder="TikTok URL"
                              className={cn(fieldErrors.socialTiktok && "border-destructive")}
                            />
                            {fieldErrors.socialTiktok && (
                              <p className="inline-form-error">{fieldErrors.socialTiktok}</p>
                            )}
                          </div>
                        </div>

                        <div className="space-y-3">
                          <Label className="flex items-center gap-2">
                            <Wrench className="h-4 w-4 text-muted-foreground" />
                            Services Offered
                          </Label>
                          <div className="flex gap-2">
                            <Input
                              value={servicesInput}
                              onChange={(event) => setServicesInput(event.target.value)}
                              placeholder="Type a service and press Add"
                              maxLength={200}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  addService();
                                }
                              }}
                            />
                            <Button type="button" variant="outline" size="sm" onClick={addService}>
                              <Plus className="h-4 w-4" />
                            </Button>
                          </div>
                          {services.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                              {services.map((service, index) => (
                                <Badge
                                  key={service}
                                  variant="secondary"
                                  className="cursor-pointer gap-1"
                                  onClick={() => removeService(index)}
                                >
                                  {service}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="space-y-3">
                          <Label className="flex items-center gap-2">
                            <CreditCard className="h-4 w-4 text-muted-foreground" />
                            Payment Methods Accepted
                          </Label>
                          <div className="flex flex-wrap gap-3">
                            {PAYMENT_METHOD_OPTIONS.map((option) => (
                              <label
                                key={option.value}
                                className="flex cursor-pointer items-center gap-2 text-sm"
                              >
                                <input
                                  type="checkbox"
                                  checked={paymentMethods.includes(option.value)}
                                  onChange={() => togglePaymentMethod(option.value)}
                                  className="rounded"
                                />
                                {option.label}
                              </label>
                            ))}
                          </div>
                        </div>

                        {businessType !== "online_only" && (
                          <div className="space-y-3">
                            <Label className="flex items-center gap-2">
                              <Store className="h-4 w-4 text-muted-foreground" />
                              Delivery Service
                            </Label>
                            <div className="flex items-start gap-3 rounded-lg border bg-background px-3 py-3 text-sm">
                              <input
                                id="delivery-available"
                                type="checkbox"
                                aria-label="Delivery available"
                                checked={deliveryOptions.length > 0}
                                onChange={(event) => setDeliveryAvailable(event.target.checked)}
                                className="mt-0.5 rounded"
                              />
                              <span className="space-y-1">
                                <span className="block font-medium">Delivery available</span>
                                <span className="block text-xs text-muted-foreground">
                                  Only indicate whether you offer delivery. No delivery-region or
                                  shipping-detail fields are required.
                                </span>
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    </details>

                    {renderReview()}
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
