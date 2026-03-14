"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Eye, FileText, Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { useToast } from "@/hooks/use-toast";
import { CategoryPicker } from "@/components/listings/category-picker";
import { MediaUpload } from "@/components/ui/media-upload";
import { PlanGate, usePlanMaxPhotos, usePlanVideoAllowed } from "@/components/billing/plan-gate";
import { getProvinceNames, getCitiesForProvince } from "@/lib/constants/sa-provinces";
import type { ListingCategory, ListingCondition } from "@/types/enums";
import { mapListingCategory } from "@/lib/utils/enum-compat";
import { cn } from "@/lib/utils";
import {
  PostFormFooter,
  PostFormScaffold,
  type PostFormStep,
} from "@/components/post/post-form-scaffold";
import { normalizeCreatePostError } from "@/app/post/_lib/create-post-errors";
import { coerceListingAttributes, validateListingAttributes } from "@/lib/forms/listing-form";
import { LISTING_CONDITIONS } from "@/lib/constants/listing-condition";
import { ListingDetailContent } from "@/components/listings/listing-detail-content";

const STEPS: PostFormStep[] = [
  { label: "Details", icon: FileText, description: "Category, title, and description" },
  { label: "Pricing & Reach", icon: MapPin, description: "Price, location, and contact" },
  { label: "Media & Review", icon: Camera, description: "Photos, video, and final review" },
];

const TITLE_MAX = 120;
const DESC_MAX = 5000;

const CONTACT_OPTIONS = [
  { id: "call", label: "Phone Call", icon: Phone },
  { id: "whatsapp", label: "WhatsApp", icon: MessageCircle },
  { id: "form", label: "Contact Form", icon: Mail },
] as const;

const FIELD_IDS: Record<string, string> = {
  category: "listing-category-field",
  "attributes.property_type": "listing-attribute-property_type",
  "attributes.bedrooms": "listing-attribute-bedrooms",
  "attributes.bathrooms": "listing-attribute-bathrooms",
  "attributes.size_sqm": "listing-attribute-size_sqm",
  "attributes.parking_spots": "listing-attribute-parking_spots",
  "attributes.furnished": "listing-attribute-furnished",
  "attributes.pets_allowed": "listing-attribute-pets_allowed",
  "attributes.make": "listing-attribute-make",
  "attributes.model": "listing-attribute-model",
  "attributes.year": "listing-attribute-year",
  "attributes.mileage_km": "listing-attribute-mileage_km",
  "attributes.transmission": "listing-attribute-transmission",
  "attributes.fuel_type": "listing-attribute-fuel_type",
  "attributes.body_type": "listing-attribute-body_type",
  "attributes.colour": "listing-attribute-colour",
  "attributes.part_type": "listing-attribute-part_type",
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
  "attributes.remote": "listing-attribute-remote",
  "attributes.salary_range": "listing-attribute-salary_range",
  title: "title",
  description: "description",
  price_zar: "price",
  province: "province",
  city: "city",
  contactMethods: "listing-contact-methods",
  images: "listing-images",
  videos: "listing-video",
};

export default function CreateListingPage() {
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [negotiable, setNegotiable] = useState(false);
  const [category, setCategory] = useState<ListingCategory | "">("");
  const [condition, setCondition] = useState<ListingCondition | "">("");
  const [categoryAttributes, setCategoryAttributes] = useState<Record<string, string | boolean>>(
    {}
  );
  const [province, setProvince] = useState("");
  const [city, setCity] = useState("");
  const [town, setTown] = useState("");
  const [contactMethods, setContactMethods] = useState<string[]>(["call"]);
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [videoFile, setVideoFile] = useState<File[]>([]);
  const [videoCoverFile, setVideoCoverFile] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitProgress, setSubmitProgress] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const router = useRouter();
  const { toast } = useToast();
  const provinces = getProvinceNames();
  const cities = province ? getCitiesForProvince(province) : [];
  const maxPhotos = usePlanMaxPhotos("MZANSI_MARKET");
  const videoAllowed = usePlanVideoAllowed("MZANSI_MARKET");
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

  function focusFirstError(errors: Record<string, string>) {
    const orderByStep = [
      ["category", "title", "description"],
      ["price_zar", "province", "city", "contactMethods"],
      ["images", "videos"],
    ][step];

    const firstKey = orderByStep.find((key) => errors[key]) ?? Object.keys(errors)[0];
    const targetId = FIELD_IDS[firstKey];

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
      }
    }

    return errors;
  }

  function handleCategoryChange(nextCategory: ListingCategory) {
    setCategory(nextCategory);
    setCategoryAttributes({});
    clearErrors("category");
  }

  function handleAttributeChange(name: string, value: string | boolean) {
    setCategoryAttributes((prev) => ({ ...prev, [name]: value }));
  }

  function toggleContact(id: string) {
    setContactMethods((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]));
    clearErrors("contactMethods");
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
      requestAnimationFrame(() => focusFirstError(stepErrors[firstInvalidStep]));
      return;
    }

    clearErrors();
    setIsSubmitting(true);
    setSubmitProgress("Uploading media...");

    try {
      const normalizedAttributes = category
        ? coerceListingAttributes(category, categoryAttributes)
        : {};

      // Upload photos, video, and video cover in parallel
      const [photoUrls, videoUrl, videoThumbnailUrl] = await Promise.all([
        // Photos via server proxy (small files)
        photoFiles.length > 0
          ? (async () => {
              const uploadData = new FormData();
              uploadData.append("area", "listing");
              photoFiles.forEach((file) => uploadData.append("files", file));
              const uploadRes = await fetch("/api/media/upload", {
                method: "POST",
                body: uploadData,
              });
              if (!uploadRes.ok) throw new Error("Failed to upload photos");
              const uploadJson = await uploadRes.json();
              return (uploadJson.urls || []) as string[];
            })()
          : Promise.resolve([] as string[]),

        // Video via presigned URL (direct to R2, avoids proxying large files)
        videoFile.length > 0
          ? (async () => {
              const file = videoFile[0];
              const urlRes = await fetch("/api/media/upload-url", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  filename: file.name,
                  contentType: file.type,
                  size: file.size,
                  area: "listing_video",
                }),
              });
              if (!urlRes.ok) throw new Error("Failed to get video upload URL");
              const { uploadUrl, publicUrl } = await urlRes.json();
              const putRes = await fetch(uploadUrl, {
                method: "PUT",
                headers: { "Content-Type": file.type },
                body: file,
              });
              if (!putRes.ok) throw new Error("Failed to upload video");
              return publicUrl as string;
            })()
          : Promise.resolve(null as string | null),

        // Video cover image via server proxy
        videoCoverFile.length > 0
          ? (async () => {
              const uploadData = new FormData();
              uploadData.append("area", "listing");
              uploadData.append("files", videoCoverFile[0]);
              const uploadRes = await fetch("/api/media/upload", {
                method: "POST",
                body: uploadData,
              });
              if (!uploadRes.ok) return null;
              const uploadJson = await uploadRes.json();
              return (uploadJson.urls?.[0] || null) as string | null;
            })()
          : Promise.resolve(null as string | null),
      ]);

      setSubmitProgress("Saving listing...");

      const res = await fetch("/api/listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
          images: photoUrls,
          videos: videoUrl ? [videoUrl] : [],
          videoThumbnail: videoThumbnailUrl,
          contactMethods,
        }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        const normalized = normalizeCreatePostError(payload, "Failed to create listing.");
        setFieldErrors(normalized.fieldErrors);
        setFormError(normalized.formError);
        focusFirstError(normalized.fieldErrors);
        return;
      }

      toast({ title: "Listing submitted for review.", variant: "success" });
      router.push("/dashboard/listings");
    } catch (error: unknown) {
      setFormError(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setIsSubmitting(false);
      setSubmitProgress(null);
    }
  }

  function renderPreview() {
    const numericPrice = parseFloat(price);
    const normalizedAttributes = category
      ? coerceListingAttributes(category, categoryAttributes)
      : {};

    return (
      <div className="rounded-xl border border-dashed border-brand-green/30 bg-brand-green/5 p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Eye className="h-4 w-4" />
          Listing preview
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
            location_province: province || null,
            location_city: city || null,
            location_suburb: town || null,
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
                error={formError}
                footer={
                  <PostFormFooter
                    currentStep={step}
                    totalSteps={STEPS.length}
                    onBack={goBack}
                    onNext={goNext}
                    submitDisabled={isSubmitting}
                    isSubmitting={isSubmitting}
                    submittingLabel={submitProgress || "Submitting..."}
                  />
                }
              >
                {step === 0 && (
                  <div className="space-y-5">
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
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        value={condition}
                        onChange={(event) =>
                          setCondition(event.target.value as ListingCondition | "")
                        }
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
                  <div className="space-y-5">
                    <div className="space-y-2">
                      <Label htmlFor="price">Price (ZAR) *</Label>
                      <div className="flex gap-3">
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

                        <button
                          type="button"
                          aria-pressed={negotiable}
                          onClick={() => setNegotiable((current) => !current)}
                          className={cn(
                            "rounded-md border px-3 py-2 text-sm font-medium transition-all",
                            negotiable
                              ? "border-brand-green bg-brand-green/10 text-brand-green"
                              : "border-input text-muted-foreground hover:border-brand-green/40"
                          )}
                        >
                          Negotiable
                        </button>
                      </div>
                      {fieldErrors.price_zar && (
                        <p className="inline-form-error">{fieldErrors.price_zar}</p>
                      )}
                    </div>

                    <div className="space-y-3">
                      <Label className="text-base font-semibold">Location</Label>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <div className="space-y-1.5">
                          <Label htmlFor="province">Province *</Label>
                          <select
                            id="province"
                            aria-label="Province"
                            className={cn(
                              "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                              fieldErrors.province && "border-destructive"
                            )}
                            value={province}
                            onChange={(event) => {
                              setProvince(event.target.value);
                              setCity("");
                              setTown("");
                              clearErrors("province", "city");
                            }}
                          >
                            <option value="">Select province</option>
                            {provinces.map((provinceName) => (
                              <option key={provinceName} value={provinceName}>
                                {provinceName}
                              </option>
                            ))}
                          </select>
                          {fieldErrors.province && (
                            <p className="inline-form-error">{fieldErrors.province}</p>
                          )}
                        </div>

                        <div className="space-y-1.5">
                          <Label htmlFor="city">City *</Label>
                          <select
                            id="city"
                            aria-label="City"
                            className={cn(
                              "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                              fieldErrors.city && "border-destructive"
                            )}
                            value={city}
                            onChange={(event) => {
                              setCity(event.target.value);
                              setTown("");
                              clearErrors("city");
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
                          {fieldErrors.city && (
                            <p className="inline-form-error">{fieldErrors.city}</p>
                          )}
                        </div>

                        <div className="space-y-1.5">
                          <Label htmlFor="town">Town / Suburb</Label>
                          <Input
                            id="town"
                            value={town}
                            onChange={(event) => setTown(event.target.value)}
                            placeholder="e.g. Sandton, Umlazi"
                            disabled={!city}
                          />
                        </div>
                      </div>
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
                      <div
                        role="group"
                        aria-label="Contact methods"
                        className="grid grid-cols-3 gap-2"
                      >
                        {CONTACT_OPTIONS.map((option) => {
                          const Icon = option.icon;
                          const isSelected = contactMethods.includes(option.id);

                          return (
                            <button
                              key={option.id}
                              type="button"
                              aria-pressed={isSelected}
                              onClick={() => toggleContact(option.id)}
                              className={cn(
                                "flex flex-col items-center gap-1.5 rounded-lg border-2 p-3 text-xs font-medium transition-all",
                                isSelected
                                  ? "border-brand-green bg-brand-green/10 text-brand-green"
                                  : "border-input text-muted-foreground hover:border-brand-green/40 hover:bg-muted/50",
                                fieldErrors.contactMethods && !isSelected && "border-destructive/40"
                              )}
                            >
                              <Icon className="h-5 w-5" />
                              {option.label}
                            </button>
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
                  <div className="space-y-5">
                    <div id="listing-images" tabIndex={-1} className="space-y-2 rounded-lg">
                      <MediaUpload
                        label={`Photos (max ${maxPhotos})`}
                        maxFiles={maxPhotos}
                        files={photoFiles}
                        onChange={(files) => {
                          setPhotoFiles(files);
                          clearErrors("images");
                        }}
                        accept="image/*"
                      />
                      <p className="text-xs text-muted-foreground">
                        Your first photo will be the main image on your listing card and search
                        results.
                      </p>
                      {fieldErrors.images && (
                        <p className="inline-form-error">{fieldErrors.images}</p>
                      )}
                    </div>

                    <div id="listing-video" tabIndex={-1} className="space-y-2 rounded-lg">
                      <MediaUpload
                        label={`Video (max 1)${!videoAllowed ? " — Upgrade to unlock" : ""}`}
                        maxFiles={1}
                        files={videoFile}
                        onChange={(files) => {
                          setVideoFile(files);
                          if (files.length === 0) setVideoCoverFile([]);
                          clearErrors("videos");
                        }}
                        accept="video/*"
                        disabled={!videoAllowed}
                      />
                      {fieldErrors.videos && (
                        <p className="inline-form-error">{fieldErrors.videos}</p>
                      )}
                    </div>

                    {videoFile.length > 0 && (
                      <MediaUpload
                        label="Video cover image (optional)"
                        maxFiles={1}
                        files={videoCoverFile}
                        onChange={setVideoCoverFile}
                        accept="image/*"
                      />
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
