"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Building2, Camera, FileText, MapPin, Megaphone } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { MediaUpload } from "@/components/ui/media-upload";
import {
  PlanGate,
  usePlanMaxPhotos,
  usePlanMaxVideos,
  usePlanVideoAllowed,
} from "@/components/billing/plan-gate";
import { LocationSelector, type LocationValue } from "@/components/ui/location-selector";
import {
  getPromotionFilterTypeFromStoredType,
  getStoredPromotionTypeForFilter,
  PROMOTION_FILTER_TYPE_OPTIONS,
} from "@/lib/promotions/type-taxonomy";
import { type BusinessCategory, type PromotionType } from "@/types/enums";
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
import { validatePromotionForm } from "@/lib/forms/promotion-form";
import { BUSINESS_CATEGORIES } from "@/lib/constants/categories";
import { getDefaultEventDates } from "@/lib/post-drafts/defaults";
import { PromotionDetailContent } from "@/components/listings/promotion-detail-content";
import { SocialAuthorizationFields } from "@/components/promotions/social-authorization-fields";
import type { PromotionSocialAuthorizationInput } from "@/lib/promotions/social-authorization";
import { ensureCsrfTokenReady, withCsrfHeaders } from "@/lib/utils/csrf";
import type { PromotionDraftData } from "@/lib/post-drafts/storage";
const SELECT_CLASS =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

const STEPS: PostFormStep[] = [
  { label: "Details", icon: FileText, description: "Type, title, and campaign summary" },
  { label: "Pricing & Reach", icon: MapPin, description: "Price, location, dates, and contact" },
  { label: "Media & Review", icon: Camera, description: "Photos, video, and final review" },
];

const FIELD_IDS: Record<string, string> = {
  title: "title",
  description: "description",
  price_zar: "price",
  province: "province",
  city: "city",
  contact_methods: "promotion-contact-methods",
  start_date: "start_date",
  end_date: "end_date",
  images: "promotion-images",
  videos: "promotion-videos",
  "socialAuthorization.authorizerName": "social-authorizer-name",
  "socialAuthorization.authorizerRole": "social-authorizer-role",
  "socialAuthorization.relationship": "social-authorizer-relationship",
  "socialAuthorization.monetizationAcknowledged": "social-monetization-acknowledged",
  "socialAuthorization.acceptedVersion": "social-authorization-version",
};

export default function CreatePromotionPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Camera className="h-8 w-8 animate-pulse text-muted-foreground" />
        </div>
      }
    >
      <CreatePromotionContent />
    </Suspense>
  );
}

function CreatePromotionContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { user, profile, isLoading } = useAuth();
  const [step, setStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitProgress, setSubmitProgress] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitSucceeded, setSubmitSucceeded] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [promotionType, setPromotionType] = useState<PromotionType>("general");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [categoryKey, setCategoryKey] = useState<BusinessCategory | "">("");
  const [priceZar, setPriceZar] = useState("");
  const [negotiable, setNegotiable] = useState(false);
  const [province, setProvince] = useState("");
  const [city, setCity] = useState("");
  const [locationTown, setLocationTown] = useState("");
  const [locationAddress, setLocationAddress] = useState("");
  const [contactMethods, setContactMethods] = useState<string[]>(["call"]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [videoFiles, setVideoFiles] = useState<File[]>([]);
  const [videoThumbnailFile, setVideoThumbnailFile] = useState<File[]>([]);
  const [socialAuthorization, setSocialAuthorization] = useState<PromotionSocialAuthorizationInput>(
    {
      granted: false,
    }
  );
  const [businessId, setBusinessId] = useState(searchParams.get("business_id") || "");
  const [myBusinesses, setMyBusinesses] = useState<{ id: string; business_name: string }[]>([]);
  const {
    save: saveDraft,
    restore: restoreDraft,
    discard: discardDraft,
  } = usePostDraftAutosave<PromotionDraftData>("promotion", user?.id, !isLoading);
  const locationValue: LocationValue = {
    province,
    city,
    town: locationTown,
    address: locationAddress,
  };
  const isEvent = promotionType === "event";
  const selectedPromotionFilterType = getPromotionFilterTypeFromStoredType(promotionType);
  const maxPhotos = usePlanMaxPhotos("PROMOTIONS_EVENTS");
  const maxVideos = usePlanMaxVideos("PROMOTIONS_EVENTS");
  const videoAllowed = usePlanVideoAllowed("PROMOTIONS_EVENTS");

  useEffect(() => {
    void ensureCsrfTokenReady();
  }, []);

  // Stable blob URLs for photo previews — revoked on change
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

  useEffect(() => {
    async function loadBusinesses() {
      try {
        const res = await fetch("/api/businesses?mine=true&limit=50");
        if (!res.ok) return;
        const data = await res.json();
        setMyBusinesses(data.businesses ?? []);
      } catch {
        // Non-critical.
      }
    }
    loadBusinesses();
  }, []);

  useEffect(() => {
    if (!profile) return;

    if (!province && profile.location_province) {
      setProvince(profile.location_province);
    }

    if (!city && profile.location_city && (!province || province === profile.location_province)) {
      setCity(profile.location_city);
    }
  }, [profile, province, city]);

  useEffect(() => {
    if (!user?.id || isLoading || submitSucceeded) return;

    const restored = restoreDraft();
    if (!restored) return;

    const restoredData = restored.data;
    setStep(Math.min(Math.max(restored.step ?? 0, 0), STEPS.length - 1));
    setPromotionType((restoredData.promotionType as PromotionType) ?? "general");
    setTitle(restoredData.title ?? "");
    setDescription(restoredData.description ?? "");
    setCategory(restoredData.category ?? "");
    setCategoryKey((restoredData.categoryKey as BusinessCategory | "") ?? "");
    setPriceZar(restoredData.priceZar ?? "");
    setNegotiable(Boolean(restoredData.negotiable));
    setProvince(restoredData.province ?? "");
    setCity(restoredData.city ?? "");
    setLocationTown(restoredData.locationTown ?? "");
    setLocationAddress(restoredData.locationAddress ?? "");
    setContactMethods(
      Array.isArray(restoredData.contactMethods) && restoredData.contactMethods.length > 0
        ? restoredData.contactMethods
        : ["call"]
    );
    setStartDate(restoredData.startDate ?? "");
    setEndDate(restoredData.endDate ?? "");
    setBusinessId(restoredData.businessId ?? (searchParams.get("business_id") || ""));
    setSocialAuthorization(
      restoredData.socialAuthorization && typeof restoredData.socialAuthorization === "object"
        ? restoredData.socialAuthorization
        : { granted: false }
    );
    setLastSavedAt(restored.savedAt ?? null);
    toast({
      title: "Draft restored",
      description: "You can continue from where you left off.",
      variant: "success",
    });
  }, [user?.id, isLoading, submitSucceeded, restoreDraft, searchParams, toast]);

  useEffect(() => {
    if (!isEvent) return;

    const defaults = getDefaultEventDates(startDate, endDate);
    if (!startDate) {
      setStartDate(defaults.startDate);
    }

    if (!endDate) {
      setEndDate(defaults.endDate);
    }
  }, [isEvent, startDate, endDate]);

  useEffect(() => {
    if (!user?.id || isLoading || isSubmitting || submitSucceeded) return;

    saveDraft(step, {
      promotionType,
      title,
      description,
      category,
      categoryKey,
      priceZar,
      negotiable,
      province,
      city,
      locationTown,
      locationAddress,
      contactMethods,
      startDate,
      endDate,
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
    promotionType,
    title,
    description,
    category,
    categoryKey,
    priceZar,
    negotiable,
    province,
    city,
    locationTown,
    locationAddress,
    contactMethods,
    startDate,
    endDate,
    businessId,
    socialAuthorization,
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
      ["title", "description"],
      ["province", "city", "contact_methods"],
      ["images", "videos"],
    ][targetStep];
    const firstKey = orderByStep.find((key) => errors[key]) ?? Object.keys(errors)[0];
    const targetId = FIELD_IDS[firstKey];
    if (!targetId) return;
    requestAnimationFrame(() => {
      const element = document.getElementById(targetId);
      element?.focus();
      element?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  function toggleContact(method: string) {
    setContactMethods((current) =>
      current.includes(method) ? current.filter((item) => item !== method) : [...current, method]
    );
    clearErrors("contact_methods");
  }

  function handleSocialAuthorizationChange(nextValue: PromotionSocialAuthorizationInput) {
    setSocialAuthorization(nextValue);
    clearErrors(
      "socialAuthorization.authorizerName",
      "socialAuthorization.authorizerRole",
      "socialAuthorization.relationship",
      "socialAuthorization.monetizationAcknowledged",
      "socialAuthorization.acceptedVersion"
    );
  }

  function validateStep(targetStep: number) {
    const errors: Record<string, string> = {};
    const promotionValidationErrors = validatePromotionForm({
      priceZar,
      startDate,
      endDate,
      contactMethods,
      socialAuthorization: targetStep === 2 ? socialAuthorization : { granted: false },
    });
    if (targetStep === 0) {
      if (!title.trim()) errors.title = isEvent ? "Enter an event title." : "Enter a title.";
      else if (title.trim().length < 5) errors.title = "Title must be at least 5 characters.";
      if (!description.trim()) {
        errors.description = isEvent ? "Enter event details." : "Enter a description.";
      } else if (description.trim().length < 20) {
        errors.description = "Description must be at least 20 characters.";
      }
    }
    if (targetStep === 1) {
      if (!province) errors.province = "Select a province.";
      if (!city) errors.city = "Select a city.";
      Object.assign(errors, promotionValidationErrors);
    }
    if (targetStep === 2) {
      if (photoFiles.length === 0) errors.images = "Upload at least one photo.";
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

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const stepErrors = [0, 1, 2].map((index) => validateStep(index));
    const firstInvalidStep = stepErrors.findIndex((errors) => Object.keys(errors).length > 0);
    if (firstInvalidStep !== -1) {
      setStep(firstInvalidStep);
      setFieldErrors(stepErrors[firstInvalidStep]);
      setFormError("Please fix the highlighted fields.");
      focusFirstError(stepErrors[firstInvalidStep], firstInvalidStep);
      return;
    }

    clearErrors();
    setIsSubmitting(true);
    setSubmitProgress("Uploading media...");

    try {
      const csrfToken = await ensureCsrfTokenReady();
      if (!csrfToken) {
        setFormError("Security check failed. Please refresh the page and try again.");
        return;
      }

      // Upload photos, videos, and video thumbnail in parallel
      const [imageUrls, videoUrls, uploadedVideoThumbnailUrl] = await Promise.all([
        // Photos via server proxy (small files)
        photoFiles.length > 0
          ? (async () => {
              const uploadData = new FormData();
              uploadData.append("area", "promotion");
              photoFiles.forEach((file) => uploadData.append("files", file));
              const uploadRes = await fetch("/api/media/upload", {
                method: "POST",
                headers: withCsrfHeaders(),
                body: uploadData,
              });
              if (!uploadRes.ok) throw new Error("Failed to upload photos");
              const uploadJson = await uploadRes.json();
              return (uploadJson.urls || []) as string[];
            })()
          : Promise.resolve([] as string[]),

        // Videos via presigned URL (direct to R2, avoids proxying large files)
        videoFiles.length > 0
          ? Promise.all(
              videoFiles.map(async (file) => {
                const urlRes = await fetch("/api/media/upload-url", {
                  method: "POST",
                  headers: withCsrfHeaders({ "Content-Type": "application/json" }),
                  body: JSON.stringify({
                    filename: file.name,
                    contentType: file.type,
                    size: file.size,
                    area: "promotion",
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
              })
            )
          : Promise.resolve([] as string[]),

        // Video thumbnail via server proxy
        videoThumbnailFile.length > 0
          ? (async () => {
              const uploadData = new FormData();
              uploadData.append("area", "promotion");
              uploadData.append("files", videoThumbnailFile[0]);
              const uploadRes = await fetch("/api/media/upload", {
                method: "POST",
                headers: withCsrfHeaders(),
                body: uploadData,
              });
              if (!uploadRes.ok) return undefined;
              const uploadJson = await uploadRes.json();
              return uploadJson.urls?.[0] as string | undefined;
            })()
          : Promise.resolve(undefined as string | undefined),
      ]);

      setSubmitProgress("Saving promotion...");

      const body = {
        title: title.trim(),
        description: description.trim(),
        promotion_type: promotionType,
        category: category || undefined,
        category_key: categoryKey || undefined,
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
        start_date: startDate ? new Date(startDate).toISOString() : undefined,
        end_date: endDate ? new Date(endDate).toISOString() : undefined,
        business_id: businessId || undefined,
        socialAuthorization,
      };

      const res = await fetch("/api/promotions", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => null);

      if (!res.ok) {
        const normalized = normalizeCreatePostError(payload, "Failed to create promotion.");
        setFieldErrors(normalized.fieldErrors);
        setFormError(normalized.formError);
        focusFirstError(normalized.fieldErrors);
        return;
      }

      toast({ title: "Promotion submitted for review.", variant: "success" });
      setSubmitSucceeded(true);
      discardDraft();
      router.push("/dashboard/listings?area=PROMOTIONS_EVENTS&created=promotion");
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
    setPromotionType("general");
    setTitle("");
    setDescription("");
    setCategory("");
    setCategoryKey("");
    setPriceZar("");
    setNegotiable(false);
    setProvince(profile?.location_province ?? "");
    setCity(profile?.location_city ?? "");
    setLocationTown("");
    setLocationAddress("");
    setContactMethods(["call"]);
    setStartDate("");
    setEndDate("");
    setBusinessId(searchParams.get("business_id") || "");
    setPhotoFiles([]);
    setVideoFiles([]);
    setVideoThumbnailFile([]);
    setSocialAuthorization({ granted: false });
    setFieldErrors({});
    setFormError(null);
    setLastSavedAt(null);
    toast({
      title: "Draft discarded",
      description: "You can start a fresh promotion now.",
      variant: "success",
    });
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header isAuthenticated />

      <main className="flex-1">
        <div className="container-page py-6">
          <PlanGate area="PROMOTIONS_EVENTS">
            <form noValidate onSubmit={handleSubmit}>
              <PostFormScaffold
                title={isEvent ? "Create an Event" : "Create a Promotion"}
                description="Promote your offer or event with the key details people need to act quickly."
                breadcrumbs={[
                  { label: "Dashboard", href: "/dashboard" },
                  { label: "Create Post", href: "/post/create" },
                  { label: "Promotions & Events" },
                ]}
                badgeLabel="Promotions & Events"
                badgeClassName="bg-amber-600 text-white"
                guideDescription={
                  isEvent
                    ? "Add the event details, tell people where it happens, and submit it for review."
                    : "Add the offer details, show where it applies, and submit it for review."
                }
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
                        const prev = Math.max(step - 1, 0);
                        setStep(prev);
                        const firstFieldByStep = ["promotion_type", "price", "promotion-images"];
                        requestAnimationFrame(() => {
                          document
                            .getElementById("post-form-top")
                            ?.scrollIntoView({ behavior: "smooth", block: "start" });
                          const el = document.getElementById(firstFieldByStep[prev]);
                          el?.focus({ preventScroll: true });
                        });
                      }}
                      onNext={() => {
                        const errors = validateStep(step);
                        if (Object.keys(errors).length > 0) {
                          setFieldErrors((current) => ({ ...current, ...errors }));
                          setFormError("Please fix the highlighted fields.");
                          focusFirstError(errors);
                          return;
                        }
                        clearErrors();
                        const next = Math.min(step + 1, STEPS.length - 1);
                        setStep(next);
                        const firstFieldByStep = ["promotion_type", "price", "promotion-images"];
                        requestAnimationFrame(() => {
                          document
                            .getElementById("post-form-top")
                            ?.scrollIntoView({ behavior: "smooth", block: "start" });
                          const el = document.getElementById(firstFieldByStep[next]);
                          el?.focus({ preventScroll: true });
                        });
                      }}
                      submitDisabled={isSubmitting}
                      isSubmitting={isSubmitting}
                      submittingLabel={submitProgress || "Submitting..."}
                    />
                  </>
                }
              >
                {step === 0 && (
                  <div className="space-y-5 animate-in fade-in-0 duration-300">
                    <div className="space-y-2">
                      <Label htmlFor="promotion_type">Promotion Type</Label>
                      <select
                        id="promotion_type"
                        aria-label="Promotion Type"
                        className={SELECT_CLASS}
                        value={selectedPromotionFilterType}
                        onChange={(event) => {
                          setPromotionType(
                            getStoredPromotionTypeForFilter(
                              event.target
                                .value as (typeof PROMOTION_FILTER_TYPE_OPTIONS)[number]["value"],
                              promotionType
                            )
                          );
                          // Auto-focus the title field after selecting a promotion type
                          requestAnimationFrame(() => {
                            const el = document.getElementById("title");
                            if (el) {
                              el.focus();
                              el.scrollIntoView({ behavior: "smooth", block: "center" });
                            }
                          });
                        }}
                      >
                        {PROMOTION_FILTER_TYPE_OPTIONS.map(({ value, label }) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="title">{isEvent ? "Event Title" : "Title"} *</Label>
                        <span className="text-xs text-muted-foreground">{title.length}/120</span>
                      </div>
                      <Input
                        id="title"
                        value={title}
                        onChange={(event) => {
                          setTitle(event.target.value);
                          clearErrors("title");
                        }}
                        placeholder={
                          isEvent
                            ? "e.g. Saturday Night Market in Soweto"
                            : "e.g. Fresh Produce Delivery in Soweto"
                        }
                        maxLength={120}
                        className={cn(fieldErrors.title && "border-destructive")}
                      />
                      {fieldErrors.title && (
                        <p className="inline-form-error">{fieldErrors.title}</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="description">
                          {isEvent ? "Event Details" : "Description"} *
                        </Label>
                        <span className="text-xs text-muted-foreground">
                          {description.length}/5000
                        </span>
                      </div>
                      <Textarea
                        id="description"
                        value={description}
                        onChange={(event) => {
                          setDescription(event.target.value);
                          clearErrors("description");
                        }}
                        rows={5}
                        maxLength={5000}
                        placeholder={
                          isEvent
                            ? "Tell people what the event is, who it is for, and what they should expect."
                            : "Tell people what you're offering, why it matters, and how they can get it."
                        }
                        className={cn(fieldErrors.description && "border-destructive")}
                      />
                      {fieldErrors.description && (
                        <p className="inline-form-error">{fieldErrors.description}</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="category_key">Category</Label>
                      <select
                        id="category_key"
                        aria-label="Canonical category"
                        className={SELECT_CLASS}
                        value={categoryKey}
                        onChange={(event) =>
                          setCategoryKey(event.target.value as BusinessCategory | "")
                        }
                      >
                        <option value="">General & Other</option>
                        {BUSINESS_CATEGORIES.map((item) => (
                          <option key={item.value} value={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="category">Category (optional)</Label>
                      <Input
                        id="category"
                        value={category}
                        onChange={(event) => setCategory(event.target.value)}
                        placeholder={
                          isEvent ? "e.g. Live Music, Community Event" : "e.g. Food & Groceries"
                        }
                        maxLength={100}
                      />
                    </div>

                    {myBusinesses.length > 0 && (
                      <div className="space-y-2">
                        <Label htmlFor="business_id" className="flex items-center gap-1.5">
                          <Building2 className="h-4 w-4 text-brand-blue" />
                          Link to Business (optional)
                        </Label>
                        <select
                          id="business_id"
                          aria-label="Link to Business"
                          className={SELECT_CLASS}
                          value={businessId}
                          onChange={(event) => setBusinessId(event.target.value)}
                        >
                          <option value="">No linked business</option>
                          {myBusinesses.map((business) => (
                            <option key={business.id} value={business.id}>
                              {business.business_name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                )}

                {step === 1 && (
                  <div className="space-y-5 animate-in fade-in-0 duration-300">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="price">
                          {isEvent ? "Ticket / Entry Price (optional)" : "Price (optional)"}
                        </Label>
                        <Input
                          id="price"
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="0.01"
                          value={priceZar}
                          onChange={(event) => {
                            setPriceZar(event.target.value);
                            clearErrors("price_zar");
                          }}
                          placeholder="0.00"
                          className={cn(fieldErrors.price_zar && "border-destructive")}
                        />
                        {fieldErrors.price_zar && (
                          <p className="inline-form-error">{fieldErrors.price_zar}</p>
                        )}
                      </div>
                      <div className="flex items-end pb-2">
                        <label className="flex cursor-pointer items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={negotiable}
                            onChange={(event) => setNegotiable(event.target.checked)}
                            className="rounded"
                          />
                          {isEvent ? "Entry price is negotiable" : "Price is negotiable"}
                        </label>
                      </div>
                    </div>

                    <LocationSelector
                      value={locationValue}
                      onChange={(v) => {
                        setProvince(v.province);
                        setCity(v.city);
                        setLocationTown(v.town ?? "");
                        setLocationAddress(v.address ?? "");
                        clearErrors("province", "city");
                      }}
                      showTown
                      showAddress
                      errors={fieldErrors}
                    />

                    <div
                      id="promotion-contact-methods"
                      tabIndex={-1}
                      className="space-y-3 rounded-lg"
                    >
                      <Label>Contact Methods *</Label>
                      <div className="flex flex-wrap gap-3">
                        {(["call", "whatsapp", "form"] as const).map((method) => (
                          <label
                            key={method}
                            className="flex cursor-pointer items-center gap-2 text-sm"
                          >
                            <input
                              type="checkbox"
                              checked={contactMethods.includes(method)}
                              onChange={() => toggleContact(method)}
                              className="rounded"
                            />
                            {method === "call"
                              ? "Phone Call"
                              : method === "whatsapp"
                                ? "WhatsApp"
                                : "Contact Form"}
                          </label>
                        ))}
                      </div>
                      {fieldErrors.contact_methods && (
                        <p className="inline-form-error">{fieldErrors.contact_methods}</p>
                      )}
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="start_date">
                          {isEvent ? "Start Date" : "Start Date (optional)"}
                        </Label>
                        <Input
                          id="start_date"
                          type="date"
                          value={startDate}
                          onChange={(event) => {
                            setStartDate(event.target.value);
                            clearErrors("start_date", "end_date");
                          }}
                          className={cn(fieldErrors.start_date && "border-destructive")}
                        />
                        {fieldErrors.start_date && (
                          <p className="inline-form-error">{fieldErrors.start_date}</p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="end_date">
                          {isEvent ? "End Date" : "End Date (optional)"}
                        </Label>
                        <Input
                          id="end_date"
                          type="date"
                          value={endDate}
                          onChange={(event) => {
                            setEndDate(event.target.value);
                            clearErrors("end_date");
                          }}
                          className={cn(fieldErrors.end_date && "border-destructive")}
                        />
                        {fieldErrors.end_date && (
                          <p className="inline-form-error">{fieldErrors.end_date}</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {step === 2 && (
                  <div className="space-y-5 animate-in fade-in-0 duration-300">
                    <div id="promotion-images" tabIndex={-1} className="space-y-2 rounded-lg">
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
                        Your first photo becomes the promotion&apos;s cover image in cards and
                        feeds.
                      </p>
                      {fieldErrors.images && (
                        <p className="inline-form-error">{fieldErrors.images}</p>
                      )}
                    </div>

                    <div id="promotion-videos" tabIndex={-1} className="space-y-2 rounded-lg">
                      <MediaUpload
                        label={`Videos (max ${maxVideos}, optional)${!videoAllowed ? " — Upgrade to unlock" : ""}`}
                        maxFiles={Math.max(maxVideos, 1)}
                        files={videoFiles}
                        onChange={(files) => {
                          setVideoFiles(files);
                          if (files.length === 0) setVideoThumbnailFile([]);
                          clearErrors("videos");
                        }}
                        accept="video/*"
                        disabled={!videoAllowed}
                      />
                      {fieldErrors.videos && (
                        <p className="inline-form-error">{fieldErrors.videos}</p>
                      )}
                    </div>

                    {videoFiles.length > 0 && (
                      <MediaUpload
                        label="Video thumbnail (optional)"
                        maxFiles={1}
                        files={videoThumbnailFile}
                        onChange={setVideoThumbnailFile}
                        accept="image/*"
                      />
                    )}

                    <SocialAuthorizationFields
                      value={socialAuthorization}
                      onChange={handleSocialAuthorizationChange}
                      errors={fieldErrors}
                    />

                    <div className="rounded-xl border border-dashed border-brand-green/30 bg-brand-green/5 p-4 text-sm">
                      <div className="mb-3 flex items-center gap-2 font-medium text-muted-foreground">
                        <Megaphone className="h-4 w-4" />
                        Preview
                      </div>

                      <PromotionDetailContent
                        promotion={{
                          id: "preview-promotion",
                          owner_id: "preview-seller",
                          business_id: businessId || null,
                          title: title || "Your promotion title",
                          description:
                            description || "Your promotion description will appear here.",
                          promotion_type: promotionType,
                          category: category || null,
                          category_key: categoryKey || null,
                          photos: photoPreviewUrls,
                          videos: previewVideoUrls,
                          video_thumbnail: videoThumbnailUrl,
                          price_cents: priceZar
                            ? Math.round(parseFloat(priceZar || "0") * 100)
                            : null,
                          price_negotiable: negotiable,
                          location_province: province,
                          location_city: city,
                          location_town: locationTown || null,
                          location_address: locationAddress || null,
                          contact_methods: contactMethods,
                          start_date: startDate || null,
                          end_date: endDate || null,
                          boost_until: null,
                          featured_until: null,
                          view_count: null,
                          created_at: new Date().toISOString(),
                        }}
                        advertiserProfile={{
                          display_name: "You",
                          account_verification_status: null,
                          phone: null,
                          masked_phone_public: null,
                        }}
                        linkedBusiness={
                          businessId
                            ? (() => {
                                const linkedBusiness = myBusinesses.find(
                                  (item) => item.id === businessId
                                );
                                return linkedBusiness
                                  ? {
                                      id: linkedBusiness.id,
                                      business_name: linkedBusiness.business_name,
                                      logo_url: null,
                                    }
                                  : null;
                              })()
                            : null
                        }
                        showContactActions={false}
                        showContactSummary
                      />
                    </div>
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
