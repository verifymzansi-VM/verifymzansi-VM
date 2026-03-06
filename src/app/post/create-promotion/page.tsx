"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Building2, Camera, FileText, MapPin, Megaphone } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { MediaUpload } from "@/components/ui/media-upload";
import { PlanGate } from "@/components/billing/plan-gate";
import { getProvinceNames, getCitiesForProvince } from "@/lib/constants/sa-provinces";
import { PROMOTION_TYPE_LABELS, type PromotionType } from "@/types/enums";
import { cn } from "@/lib/utils";
import {
  PostFormFooter,
  PostFormScaffold,
  type PostFormStep,
} from "@/components/post/post-form-scaffold";
import { normalizeCreatePostError } from "@/app/post/_lib/create-post-errors";
import { useToast } from "@/hooks/use-toast";

const PROMOTION_TYPES = Object.entries(PROMOTION_TYPE_LABELS) as [PromotionType, string][];
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
  province: "province",
  city: "city",
  contact_methods: "promotion-contact-methods",
  images: "promotion-images",
  videos: "promotion-videos",
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
  const [step, setStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [promotionType, setPromotionType] = useState<PromotionType>("general");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [priceZar, setPriceZar] = useState("");
  const [negotiable, setNegotiable] = useState(false);
  const [province, setProvince] = useState("");
  const [city, setCity] = useState("");
  const [contactMethods, setContactMethods] = useState<string[]>(["call"]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [videoFiles, setVideoFiles] = useState<File[]>([]);
  const [videoThumbnailFile, setVideoThumbnailFile] = useState<File[]>([]);
  const [businessId, setBusinessId] = useState(searchParams.get("business_id") || "");
  const [myBusinesses, setMyBusinesses] = useState<{ id: string; business_name: string }[]>([]);
  const provinces = getProvinceNames();
  const cities = province ? getCitiesForProvince(province) : [];
  const isEvent = promotionType === "event";

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

  function validateStep(targetStep: number) {
    const errors: Record<string, string> = {};
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
      if (contactMethods.length === 0)
        errors.contact_methods = "Choose at least one contact method.";
    }
    if (targetStep === 2) {
      if (photoFiles.length === 0) errors.images = "Upload at least one photo.";
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
      setFormError("Please fix the highlighted fields before submitting.");
      focusFirstError(stepErrors[firstInvalidStep], firstInvalidStep);
      return;
    }

    clearErrors();
    setIsSubmitting(true);

    try {
      let imageUrls: string[] = [];
      if (photoFiles.length > 0) {
        const uploadData = new FormData();
        uploadData.append("area", "promotion");
        photoFiles.forEach((file) => uploadData.append("files", file));
        const uploadRes = await fetch("/api/media/upload", { method: "POST", body: uploadData });
        if (!uploadRes.ok) throw new Error("Failed to upload photos");
        const uploadJson = await uploadRes.json();
        imageUrls = uploadJson.urls || [];
      }

      let videoUrls: string[] = [];
      if (videoFiles.length > 0) {
        const uploadData = new FormData();
        uploadData.append("area", "promotion");
        videoFiles.forEach((file) => uploadData.append("files", file));
        const uploadRes = await fetch("/api/media/upload", { method: "POST", body: uploadData });
        if (!uploadRes.ok) throw new Error("Failed to upload video");
        const uploadJson = await uploadRes.json();
        videoUrls = uploadJson.urls || [];
      }

      let videoThumbnailUrl: string | undefined;
      if (videoThumbnailFile.length > 0) {
        const uploadData = new FormData();
        uploadData.append("area", "promotion");
        uploadData.append("files", videoThumbnailFile[0]);
        const uploadRes = await fetch("/api/media/upload", { method: "POST", body: uploadData });
        if (uploadRes.ok) {
          const uploadJson = await uploadRes.json();
          videoThumbnailUrl = uploadJson.urls?.[0];
        }
      }

      const body = {
        title: title.trim(),
        description: description.trim(),
        promotion_type: promotionType,
        category: category || undefined,
        price_zar: priceZar ? parseFloat(priceZar) : undefined,
        negotiable,
        province,
        city,
        contact_methods: contactMethods,
        images: imageUrls,
        videos: videoUrls,
        video_thumbnail: videoThumbnailUrl,
        start_date: startDate ? new Date(startDate).toISOString() : undefined,
        end_date: endDate ? new Date(endDate).toISOString() : undefined,
        business_id: businessId || undefined,
      };

      const res = await fetch("/api/promotions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      router.push("/dashboard/promotions?created=true");
    } catch (error: unknown) {
      setFormError(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header isAuthenticated />

      <main className="flex-1">
        <div className="container-page py-6">
          <PlanGate area="PROMOTIONS_EVENTS">
            <form noValidate onSubmit={handleSubmit}>
              <PostFormScaffold
                title="Create a Promotions & Events Post"
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
                  <PostFormFooter
                    currentStep={step}
                    totalSteps={STEPS.length}
                    onBack={() => {
                      clearErrors();
                      setStep((current) => Math.max(current - 1, 0));
                    }}
                    onNext={() => {
                      const errors = validateStep(step);
                      if (Object.keys(errors).length > 0) {
                        setFieldErrors((current) => ({ ...current, ...errors }));
                        setFormError("Please fix the highlighted fields before continuing.");
                        focusFirstError(errors);
                        return;
                      }
                      clearErrors();
                      setStep((current) => Math.min(current + 1, STEPS.length - 1));
                    }}
                    submitDisabled={isSubmitting}
                    isSubmitting={isSubmitting}
                    submittingLabel="Submitting..."
                  />
                }
              >
                {step === 0 && (
                  <div className="space-y-5">
                    <div className="space-y-2">
                      <Label htmlFor="promotion_type">Promotion Type</Label>
                      <select
                        id="promotion_type"
                        aria-label="Promotion Type"
                        className={SELECT_CLASS}
                        value={promotionType}
                        onChange={(event) => setPromotionType(event.target.value as PromotionType)}
                      >
                        {PROMOTION_TYPES.map(([value, label]) => (
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
                        <p className="text-xs text-destructive">{fieldErrors.title}</p>
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
                        <p className="text-xs text-destructive">{fieldErrors.description}</p>
                      )}
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
                  <div className="space-y-5">
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
                          onChange={(event) => setPriceZar(event.target.value)}
                          placeholder="0.00"
                        />
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

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="province">Province *</Label>
                        <select
                          id="province"
                          aria-label="Province"
                          className={cn(SELECT_CLASS, fieldErrors.province && "border-destructive")}
                          value={province}
                          onChange={(event) => {
                            setProvince(event.target.value);
                            setCity("");
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
                          <p className="text-xs text-destructive">{fieldErrors.province}</p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="city">City / Town *</Label>
                        <select
                          id="city"
                          aria-label="City / Town"
                          className={cn(SELECT_CLASS, fieldErrors.city && "border-destructive")}
                          value={city}
                          onChange={(event) => {
                            setCity(event.target.value);
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
                          <p className="text-xs text-destructive">{fieldErrors.city}</p>
                        )}
                      </div>
                    </div>

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
                        <p className="text-xs text-destructive">{fieldErrors.contact_methods}</p>
                      )}
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="start_date">
                          {isEvent ? "Start Date (optional)" : "Start Date (optional)"}
                        </Label>
                        <Input
                          id="start_date"
                          type="date"
                          value={startDate}
                          onChange={(event) => setStartDate(event.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="end_date">
                          {isEvent ? "End Date (optional)" : "End Date (optional)"}
                        </Label>
                        <Input
                          id="end_date"
                          type="date"
                          value={endDate}
                          onChange={(event) => setEndDate(event.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {step === 2 && (
                  <div className="space-y-5">
                    <div id="promotion-images" tabIndex={-1} className="space-y-2 rounded-lg">
                      <MediaUpload
                        label="Photos (max 10)"
                        maxFiles={10}
                        files={photoFiles}
                        onChange={(files) => {
                          setPhotoFiles(files);
                          clearErrors("images");
                        }}
                        accept="image/*"
                      />
                      {fieldErrors.images && (
                        <p className="text-xs text-destructive">{fieldErrors.images}</p>
                      )}
                    </div>

                    <div id="promotion-videos" tabIndex={-1} className="space-y-2 rounded-lg">
                      <MediaUpload
                        label="Videos (max 3, optional)"
                        maxFiles={3}
                        files={videoFiles}
                        onChange={(files) => {
                          setVideoFiles(files);
                          if (files.length === 0) setVideoThumbnailFile([]);
                          clearErrors("videos");
                        }}
                        accept="video/*"
                      />
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

                    <div className="rounded-xl border border-dashed border-amber-600/30 bg-amber-50/70 p-4 text-sm">
                      <div className="mb-3 flex items-center gap-2 font-medium text-muted-foreground">
                        <Megaphone className="h-4 w-4" />
                        Review
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-muted-foreground">
                        <span>Type:</span>
                        <span className="font-medium text-foreground">
                          {PROMOTION_TYPE_LABELS[promotionType]}
                        </span>
                        <span>{isEvent ? "Event title:" : "Title:"}</span>
                        <span className="font-medium text-foreground">{title || "Not set"}</span>
                        <span>Location:</span>
                        <span className="font-medium text-foreground">
                          {[city, province].filter(Boolean).join(", ") || "Not set"}
                        </span>
                        <span>Photos:</span>
                        <span className="font-medium text-foreground">{photoFiles.length}</span>
                        <span>Videos:</span>
                        <span className="font-medium text-foreground">{videoFiles.length}</span>
                      </div>
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
