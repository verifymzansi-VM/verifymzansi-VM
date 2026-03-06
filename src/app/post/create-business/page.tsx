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
import { createClient } from "@/lib/supabase/client";
import { MediaUpload } from "@/components/ui/media-upload";
import {
  PlanGate,
  usePlanCoverVideoAllowed,
  usePlanMaxPhotos,
} from "@/components/billing/plan-gate";
import { getProvinceNames, getCitiesForProvince } from "@/lib/constants/sa-provinces";
import { BUSINESS_CATEGORIES, BUSINESS_TYPE_OPTIONS } from "@/lib/constants/categories";
import type { BusinessCategory, BusinessType, UploadArea } from "@/types/enums";
import { cn } from "@/lib/utils";
import {
  PostFormFooter,
  PostFormScaffold,
  type PostFormStep,
} from "@/components/post/post-form-scaffold";
import { normalizeCreatePostError } from "@/app/post/_lib/create-post-errors";
import { parseServiceAreas, validateBusinessForm } from "@/lib/forms/business-form";
import {
  coerceBusinessDetails,
  getDefaultBusinessDetails,
} from "@/lib/forms/business-type-details";
import { BusinessTypeDetailsFields } from "@/components/business/business-type-details-fields";
import type { BusinessDetails } from "@/types/business-details";

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

const DELIVERY_OPTIONS = [
  { value: "in_store", label: "In-store / Walk-in" },
  { value: "delivery", label: "Delivery" },
  { value: "collection", label: "Collection" },
  { value: "nationwide", label: "Nationwide Shipping" },
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
  gallery_photos: "business-gallery",
  cover_video: "business-cover-video",
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
  const [storeNumber, setStoreNumber] = useState("");
  const [mallId, setMallId] = useState("");
  const [malls, setMalls] = useState<{ id: string; name: string; location_city: string | null }[]>(
    []
  );
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
  const [promoVideoFile, setPromoVideoFile] = useState<File[]>([]);
  const [videoThumbnailFile, setVideoThumbnailFile] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const { toast } = useToast();
  const provinces = getProvinceNames();
  const cities = province ? getCitiesForProvince(province) : [];
  const maxPhotos = usePlanMaxPhotos("MZANSI_BUSINESS");
  const coverVideoAllowed = usePlanCoverVideoAllowed("MZANSI_BUSINESS");

  // Stable blob URLs for logo/cover previews — revoked on change
  const logoPreviewUrl = useMemo(
    () => (logoFile.length > 0 ? URL.createObjectURL(logoFile[0]) : null),
    [logoFile]
  );
  const coverPreviewUrl = useMemo(
    () => (coverFile.length > 0 ? URL.createObjectURL(coverFile[0]) : null),
    [coverFile]
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

  useEffect(() => {
    if (businessType === "mall_store") {
      async function fetchMalls() {
        const supabase = createClient();
        const { data } = await supabase
          .from("malls")
          .select("id, name, location_city")
          .order("name");
        if (data) setMalls(data);
      }
      fetchMalls();
    }
  }, [businessType]);

  useEffect(() => {
    if (!slugManual && businessName) {
      setSlug(generateSlug(businessName));
    }
  }, [businessName, slugManual]);

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

  function toggleDeliveryOption(option: string) {
    setDeliveryOptions((current) =>
      current.includes(option) ? current.filter((item) => item !== option) : [...current, option]
    );
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

  async function uploadMedia(files: File[], area: UploadArea): Promise<string[]> {
    if (files.length === 0) return [];
    try {
      const uploadData = new FormData();
      uploadData.append("area", area);
      files.forEach((file) => uploadData.append("files", file));
      const uploadRes = await fetch("/api/media/upload", { method: "POST", body: uploadData });
      if (!uploadRes.ok) throw new Error("Upload failed");
      const uploadJson = await uploadRes.json();
      return uploadJson.urls || [];
    } catch {
      toast({
        title: "Some media was skipped",
        description: "You can add the failed files later after your business is created.",
        variant: "destructive",
      });
      return [];
    }
  }

  function goNext() {
    const errors = validateStep(step);
    if (Object.keys(errors).length > 0) {
      setFieldErrors((current) => ({ ...current, ...errors }));
      setFormError("Please fix the highlighted fields before continuing.");
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
      setFormError("Please fix the highlighted fields before submitting.");
      focusFirstError(stepErrors[firstInvalidStep], firstInvalidStep);
      return;
    }
    clearErrors();
    setIsSubmitting(true);
    try {
      const [logoUrls, coverUrls, galleryUrls, videoUrls] = await Promise.all([
        uploadMedia(logoFile, "business_logo"),
        uploadMedia(coverFile, "business_cover"),
        uploadMedia(galleryFiles, "business_gallery"),
        uploadMedia(promoVideoFile, "business_cover"),
      ]);
      const finalCoverPhoto = coverUrls[0] || null;
      const finalCoverVideo = videoUrls[0] || null;
      let finalVideoThumbnail: string | null = null;
      if (finalCoverVideo && videoThumbnailFile.length > 0) {
        const thumbUrls = await uploadMedia(videoThumbnailFile, "business_cover");
        finalVideoThumbnail = thumbUrls[0] || null;
      }
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
      const body = {
        business_name: businessName.trim(),
        slug: (slug || generateSlug(businessName)).trim(),
        business_type: businessType,
        category,
        description: description.trim(),
        location_province: province,
        location_city: city,
        store_number: businessType === "mall_store" ? storeNumber : undefined,
        mall_id: businessType === "mall_store" && mallId ? mallId : undefined,
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
        business_details: businessType
          ? coerceBusinessDetails(businessType, businessDetails)
          : undefined,
        operating_hours: Object.keys(operatingHours).length > 0 ? operatingHours : undefined,
        payment_methods_accepted: paymentMethods.length > 0 ? paymentMethods : undefined,
        delivery_options: deliveryOptions.length > 0 ? deliveryOptions : undefined,
        social_links: Object.keys(socialLinks).length > 0 ? socialLinks : undefined,
      };
      const res = await fetch("/api/businesses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        const normalized = normalizeCreatePostError(payload, "Failed to create business.");
        setFieldErrors(normalized.fieldErrors);
        setFormError(normalized.formError);
        focusFirstError(normalized.fieldErrors);
        return;
      }
      toast({ title: "Business submitted for review.", variant: "success" });
      router.push("/dashboard/businesses");
    } catch (error: unknown) {
      setFormError(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function renderReview() {
    const selectedType = BUSINESS_TYPE_OPTIONS.find((option) => option.value === businessType);
    const selectedCategory = BUSINESS_CATEGORIES.find((option) => option.value === category);
    const serviceAreas = serviceAreasInput
      .split(",")
      .map((area) => area.trim())
      .filter(Boolean);
    return (
      <div className="rounded-xl border border-dashed border-brand-blue/30 bg-brand-blue/5 p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Building2 className="h-4 w-4" />
          Business review
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Business</p>
            <p className="font-display text-base font-semibold">
              {businessName || "Your business name"}
            </p>
            <p className="text-sm text-muted-foreground">
              {selectedType?.label || "Business type not selected"}
            </p>
            {selectedCategory && (
              <Badge variant="secondary" className="mt-1">
                {selectedCategory.label}
              </Badge>
            )}
          </div>
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Reach</p>
            <p className="text-sm text-foreground">
              {[city, province].filter(Boolean).join(", ") || "Location not set"}
            </p>
            {businessType === "mall_store" && storeNumber && (
              <p className="text-sm text-muted-foreground">Store number: {storeNumber}</p>
            )}
            {businessType === "mobile_service" && serviceAreas.length > 0 && (
              <p className="text-sm text-muted-foreground">
                Service areas: {serviceAreas.join(", ")}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Contact</p>
            <p className="text-sm text-muted-foreground">
              {[phone && "Phone", whatsapp && "WhatsApp", email && "Email", website && "Website"]
                .filter(Boolean)
                .join(", ") || "No contact channels added yet"}
            </p>
          </div>
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Media</p>
            <p className="text-sm text-muted-foreground">
              {logoFile.length} logo, {coverFile.length} cover, {galleryFiles.length} gallery
              photos, {promoVideoFile.length} video
            </p>
            {/* Mini visual preview of logo + cover placement */}
            {(logoFile.length > 0 || coverFile.length > 0) && (
              <div className="relative rounded-lg overflow-hidden border bg-muted">
                <div className="aspect-[4/1] bg-gradient-to-r from-brand-blue/20 to-brand-blue/5 flex items-center justify-center">
                  {coverPreviewUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={coverPreviewUrl}
                      alt="Cover preview"
                      className="w-full h-full object-cover"
                      width={400}
                      height={100}
                    />
                  ) : (
                    <span className="text-[10px] text-muted-foreground">No cover</span>
                  )}
                </div>
                <div className="absolute bottom-1 left-2 h-8 w-8 rounded-md bg-white dark:bg-warm-900 p-0.5 shadow border overflow-hidden">
                  {logoPreviewUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={logoPreviewUrl}
                      alt="Logo preview"
                      className="w-full h-full object-contain rounded"
                      width={32}
                      height={32}
                    />
                  ) : (
                    <div className="w-full h-full rounded bg-muted flex items-center justify-center">
                      <Store className="h-3 w-3 text-muted-foreground" />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
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
                  <PostFormFooter
                    currentStep={step}
                    totalSteps={STEPS.length}
                    onBack={goBack}
                    onNext={goNext}
                    submitDisabled={isSubmitting}
                    isSubmitting={isSubmitting}
                    submittingLabel="Submitting..."
                  />
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
                            <button
                              key={option.value}
                              type="button"
                              role="radio"
                              aria-checked={isSelected ? "true" : "false"}
                              onClick={() => {
                                setBusinessType(option.value);
                                setBusinessDetails(getDefaultBusinessDetails(option.value));
                                if (option.value !== "mall_store") {
                                  setStoreNumber("");
                                  setMallId("");
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
                              className={cn(
                                "rounded-xl border-2 p-4 text-left transition-all",
                                isSelected
                                  ? "border-brand-blue bg-brand-blue/5 ring-1 ring-brand-blue/20"
                                  : "border-border hover:border-brand-blue/30"
                              )}
                            >
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
                            </button>
                          );
                        })}
                      </div>
                      {fieldErrors.business_type && (
                        <p className="text-xs text-destructive">{fieldErrors.business_type}</p>
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
                        storeNumber={storeNumber}
                        onStoreNumberChange={(value) => {
                          setStoreNumber(value);
                          clearErrors("store_number");
                        }}
                        mallId={mallId}
                        malls={malls}
                        onMallIdChange={setMallId}
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
                        <p className="text-xs text-destructive">{fieldErrors.business_name}</p>
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
                      {fieldErrors.slug && (
                        <p className="text-xs text-destructive">{fieldErrors.slug}</p>
                      )}
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
                        <p className="text-xs text-destructive">{fieldErrors.category}</p>
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
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="province">Province *</Label>
                        <select
                          id="province"
                          aria-label="Province"
                          className={cn(
                            SELECT_CLASS,
                            fieldErrors.location_province && "border-destructive"
                          )}
                          value={province}
                          onChange={(event) => {
                            setProvince(event.target.value);
                            setCity("");
                            clearErrors("location_province", "location_city");
                          }}
                        >
                          <option value="">Select province</option>
                          {provinces.map((provinceName) => (
                            <option key={provinceName} value={provinceName}>
                              {provinceName}
                            </option>
                          ))}
                        </select>
                        {fieldErrors.location_province && (
                          <p className="text-xs text-destructive">
                            {fieldErrors.location_province}
                          </p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="city">City / Town *</Label>
                        <select
                          id="city"
                          aria-label="City / Town"
                          className={cn(
                            SELECT_CLASS,
                            fieldErrors.location_city && "border-destructive"
                          )}
                          value={city}
                          onChange={(event) => {
                            setCity(event.target.value);
                            clearErrors("location_city");
                          }}
                          disabled={!province}
                        >
                          <option value="">Select city</option>
                          {cities.map((cityName) => (
                            <option key={cityName} value={cityName}>
                              {cityName}
                            </option>
                          ))}
                        </select>
                        {fieldErrors.location_city && (
                          <p className="text-xs text-destructive">{fieldErrors.location_city}</p>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="phone" className="flex items-center gap-2">
                          <Phone className="h-4 w-4 text-muted-foreground" />
                          Phone Number
                        </Label>
                        <Input
                          id="phone"
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
                          <p className="text-xs text-destructive">{fieldErrors.phone}</p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="whatsapp" className="flex items-center gap-2">
                          <MessageCircle className="h-4 w-4 text-green-600" />
                          WhatsApp
                        </Label>
                        <Input
                          id="whatsapp"
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
                          <p className="text-xs text-destructive">{fieldErrors.whatsapp}</p>
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
                          <p className="text-xs text-destructive">{fieldErrors.email}</p>
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
                          <p className="text-xs text-destructive">{fieldErrors.website}</p>
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
                      <div className="space-y-2">
                        <MediaUpload
                          label="Business logo (optional)"
                          maxFiles={1}
                          files={logoFile}
                          onChange={setLogoFile}
                          accept="image/*"
                        />
                        <p className="text-xs text-muted-foreground">
                          Square icon (96×96) shown beside your business name on cards and search
                          results.
                        </p>
                      </div>
                      <div className="space-y-2">
                        <MediaUpload
                          label="Cover photo (optional)"
                          maxFiles={1}
                          files={coverFile}
                          onChange={setCoverFile}
                          accept="image/*"
                        />
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
                        <p className="text-xs text-destructive">{fieldErrors.gallery_photos}</p>
                      )}
                    </div>

                    <div id="business-cover-video" className="space-y-2 rounded-lg">
                      <MediaUpload
                        label={`Promo video (optional)${!coverVideoAllowed ? " — Upgrade to unlock" : ""}`}
                        maxFiles={1}
                        files={promoVideoFile}
                        onChange={(files) => {
                          setPromoVideoFile(files);
                          if (files.length === 0) setVideoThumbnailFile([]);
                          clearErrors("cover_video");
                        }}
                        accept="video/*"
                        disabled={!coverVideoAllowed}
                      />
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Film className="h-3 w-3" />A short intro video works best. Keep it focused
                        and easy to watch on mobile.
                      </p>
                      {fieldErrors.cover_video && (
                        <p className="text-xs text-destructive">{fieldErrors.cover_video}</p>
                      )}
                    </div>

                    {promoVideoFile.length > 0 && (
                      <MediaUpload
                        label="Video thumbnail (optional)"
                        maxFiles={1}
                        files={videoThumbnailFile}
                        onChange={setVideoThumbnailFile}
                        accept="image/*"
                      />
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
                              <p className="text-xs text-destructive">
                                {fieldErrors.socialFacebook}
                              </p>
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
                              <p className="text-xs text-destructive">
                                {fieldErrors.socialInstagram}
                              </p>
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
                              <p className="text-xs text-destructive">
                                {fieldErrors.socialTwitter}
                              </p>
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
                              <p className="text-xs text-destructive">{fieldErrors.socialTiktok}</p>
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

                        <div className="space-y-3">
                          <Label className="flex items-center gap-2">
                            <Store className="h-4 w-4 text-muted-foreground" />
                            Delivery Options
                          </Label>
                          <div className="flex flex-wrap gap-3">
                            {DELIVERY_OPTIONS.map((option) => (
                              <label
                                key={option.value}
                                className="flex cursor-pointer items-center gap-2 text-sm"
                              >
                                <input
                                  type="checkbox"
                                  checked={deliveryOptions.includes(option.value)}
                                  onChange={() => toggleDeliveryOption(option.value)}
                                  className="rounded"
                                />
                                {option.label}
                              </label>
                            ))}
                          </div>
                        </div>
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
