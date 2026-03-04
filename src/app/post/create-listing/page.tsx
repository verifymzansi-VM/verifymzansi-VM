"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  FileText,
  MapPin,
  Camera,
  ChevronRight,
  ChevronLeft,
  Check,
  Phone,
  MessageCircle,
  Mail,
  Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { PageHeader } from "@/components/layout/page-header";
import { useToast } from "@/hooks/use-toast";
import { CategoryPicker } from "@/components/listings/category-picker";
import { MediaUpload } from "@/components/ui/media-upload";
import { PlanGate, usePlanMaxPhotos, usePlanVideoAllowed } from "@/components/billing/plan-gate";
import { getProvinceNames, getCitiesForProvince } from "@/lib/constants/sa-provinces";
import { formatZAR } from "@/lib/utils/format";
import type { ListingCategory } from "@/types/enums";
import { mapListingCategory } from "@/lib/utils/enum-compat";
import { cn } from "@/lib/utils";

/* ── Step definitions ─────────────────────────────────────────── */
const STEPS = [
  { label: "Details", icon: FileText, description: "Category, title & description" },
  { label: "Pricing & Location", icon: MapPin, description: "Price, location & contact" },
  { label: "Media & Review", icon: Camera, description: "Photos, video & preview" },
] as const;

const TITLE_MAX = 120;
const DESC_MAX = 5000;

const CONTACT_OPTIONS = [
  { id: "call", label: "Phone Call", icon: Phone },
  { id: "whatsapp", label: "WhatsApp", icon: MessageCircle },
  { id: "form", label: "Contact Form", icon: Mail },
] as const;

export default function CreateListingPage() {
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [negotiable, setNegotiable] = useState(false);
  const [category, setCategory] = useState<ListingCategory | "">("");
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
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const router = useRouter();
  const { toast } = useToast();
  const provinces = getProvinceNames();
  const cities = province ? getCitiesForProvince(province) : [];
  const maxPhotos = usePlanMaxPhotos("MZANSI_MARKET");
  const videoAllowed = usePlanVideoAllowed("MZANSI_MARKET");

  useEffect(() => {
    if (photoFiles.length > 0) {
      const url = URL.createObjectURL(photoFiles[0]);
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setPreviewUrl(null);
  }, [photoFiles]);

  function handleCategoryChange(cat: ListingCategory) {
    setCategory(cat);
    setCategoryAttributes({});
  }

  function handleAttributeChange(name: string, value: string | boolean) {
    setCategoryAttributes((prev) => ({ ...prev, [name]: value }));
  }

  function toggleContact(id: string) {
    setContactMethods((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]));
  }

  /* ── Step validation ──────────────────────────────────────────── */
  function validateStep(s: number): string | null {
    switch (s) {
      case 0:
        if (!category) return "Please select a category";
        if (!title.trim()) return "Please enter a title";
        if (title.trim().length > TITLE_MAX)
          return `Title must be ${TITLE_MAX} characters or fewer`;
        if (!description.trim()) return "Please enter a description";
        if (description.trim().length > DESC_MAX)
          return `Description must be ${DESC_MAX} characters or fewer`;
        return null;
      case 1:
        if (!price || isNaN(parseFloat(price)) || parseFloat(price) < 0)
          return "Please enter a valid price";
        if (!province) return "Please select a province";
        if (!city) return "Please select a city";
        if (contactMethods.length === 0) return "Please select at least one contact method";
        return null;
      case 2:
        if (photoFiles.length === 0) return "Please upload at least one photo";
        return null;
      default:
        return null;
    }
  }

  function goNext() {
    const error = validateStep(step);
    if (error) {
      toast({ title: error, variant: "destructive" });
      return;
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function goBack() {
    setStep((s) => Math.max(s - 1, 0));
  }

  /* ── Submit ────────────────────────────────────────────────────── */
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (step < STEPS.length - 1) {
      goNext();
      return;
    }

    const err0 = validateStep(0);
    const err1 = validateStep(1);
    const err2 = validateStep(2);

    if (err0 || err1 || err2) {
      toast({ title: (err0 || err1 || err2) as string, variant: "destructive" });
      return;
    }

    if (photoFiles.length > maxPhotos) {
      toast({ title: `You can only upload up to ${maxPhotos} photos`, variant: "destructive" });
      return;
    }

    if (videoFile.length > 0 && !videoAllowed) {
      toast({ title: "Video upload is not allowed on your current plan", variant: "destructive" });
      return;
    }

    const numPrice = parseFloat(price);

    setIsSubmitting(true);
    try {
      // Upload media files
      let photoUrls: string[] = [];
      if (photoFiles.length > 0) {
        const uploadData = new FormData();
        uploadData.append("area", "listing");
        photoFiles.forEach((f) => uploadData.append("files", f));
        const uploadRes = await fetch("/api/media/upload", { method: "POST", body: uploadData });
        if (!uploadRes.ok) throw new Error("Failed to upload photos");
        const uploadJson = await uploadRes.json();
        if (uploadJson.urls) photoUrls = uploadJson.urls;
      }

      let videoUrls: string[] = [];
      if (videoFile.length > 0) {
        const uploadData = new FormData();
        uploadData.append("area", "listing_video");
        uploadData.append("files", videoFile[0]);
        const uploadRes = await fetch("/api/media/upload", { method: "POST", body: uploadData });
        if (!uploadRes.ok) throw new Error("Failed to upload video");
        const uploadJson = await uploadRes.json();
        if (uploadJson.urls && uploadJson.urls.length > 0) {
          videoUrls.push(uploadJson.urls[0]);
        }
      }

      // Upload video cover image
      let videoThumbnailUrl: string | null = null;
      if (videoCoverFile.length > 0) {
        const uploadData = new FormData();
        uploadData.append("area", "listing");
        uploadData.append("files", videoCoverFile[0]);
        const uploadRes = await fetch("/api/media/upload", { method: "POST", body: uploadData });
        if (uploadRes.ok) {
          const uploadJson = await uploadRes.json();
          if (uploadJson.urls && uploadJson.urls.length > 0) {
            videoThumbnailUrl = uploadJson.urls[0];
          }
        }
      }

      // Submit via server-side API route for full validation & entitlement enforcement
      const res = await fetch("/api/listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          price_zar: numPrice,
          negotiable,
          category: mapListingCategory(category),
          attributes: categoryAttributes,
          province: province || "",
          city: city || "",
          town: town || "",
          images: photoUrls,
          videos: videoUrls,
          videoThumbnail: videoThumbnailUrl,
          contactMethods,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast({
          title: "Failed to create listing",
          description: data.error || data.reason || "Something went wrong",
          variant: "destructive",
        });
        return;
      }

      toast({ title: "Listing submitted for review!" });
      router.push("/dashboard/listings");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      toast({ title: message, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  }

  /* ── Preview card ──────────────────────────────────────────────── */
  function renderPreview() {
    const numPrice = parseFloat(price);
    return (
      <Card className="border-dashed border-2 border-brand-green/30 bg-brand-green/5">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Eye className="h-4 w-4" />
            Listing Preview
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-3">
            {/* Preview image */}
            <div className="w-20 h-20 rounded-lg bg-muted flex-shrink-0 overflow-hidden">
              {previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewUrl}
                  alt="Preview"
                  className="w-full h-full object-cover"
                  loading="lazy"
                  width={80}
                  height={80}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
                  <Camera className="h-5 w-5" />
                </div>
              )}
            </div>
            <div className="space-y-1 min-w-0 flex-1">
              <h4 className="font-display font-semibold text-sm truncate">
                {title || "Your listing title"}
              </h4>
              <p className="text-base font-bold text-brand-green">
                {!isNaN(numPrice) && numPrice > 0
                  ? formatZAR(Math.round(numPrice * 100))
                  : "R 0.00"}
                {negotiable && (
                  <span className="ml-1.5 text-[10px] font-medium bg-brand-green/10 text-brand-green rounded px-1 py-0.5">
                    Neg.
                  </span>
                )}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {[city, province].filter(Boolean).join(", ") || "Location not set"}
              </p>
            </div>
          </div>
          {description && (
            <p className="text-xs text-muted-foreground line-clamp-2">{description}</p>
          )}
          <div className="flex flex-wrap gap-1">
            {category && (
              <Badge variant="secondary" className="text-[10px]">
                {category.replace(/_/g, " ")}
              </Badge>
            )}
            {contactMethods.map((m) => (
              <Badge key={m} variant="outline" className="text-[10px] capitalize">
                {m}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header isAuthenticated />

      <main className="flex-1">
        <div className="container-page py-6">
          <div className="max-w-2xl mx-auto space-y-6">
            <PageHeader
              title="Create Listing"
              description="List an item for sale on Mzansi Market."
              breadcrumbs={[
                { label: "Dashboard", href: "/dashboard" },
                { label: "Create Post", href: "/post/create" },
                { label: "Mzansi Market Listing" },
              ]}
            />

            <PlanGate area="MZANSI_MARKET">
              {/* ── Progress Steps ──────────────────────────────────── */}
              <div className="mb-6">
                <div className="flex items-center justify-between">
                  {STEPS.map((s, i) => {
                    const Icon = s.icon;
                    const isCompleted = i < step;
                    const isCurrent = i === step;
                    return (
                      <div key={s.label} className="flex items-center flex-1 last:flex-initial">
                        <button
                          type="button"
                          onClick={() => {
                            if (i < step) setStep(i);
                          }}
                          className={cn(
                            "flex items-center gap-2 text-sm font-medium transition-colors",
                            isCurrent && "text-brand-green",
                            isCompleted &&
                              "text-brand-green/70 cursor-pointer hover:text-brand-green",
                            !isCurrent && !isCompleted && "text-muted-foreground"
                          )}
                        >
                          <div
                            className={cn(
                              "flex items-center justify-center h-9 w-9 rounded-full border-2 transition-all duration-300",
                              isCurrent &&
                                "border-brand-green bg-brand-green text-white shadow-lg shadow-brand-green/25",
                              isCompleted &&
                                "border-brand-green bg-brand-green/10 text-brand-green",
                              !isCurrent &&
                                !isCompleted &&
                                "border-muted-foreground/30 text-muted-foreground"
                            )}
                          >
                            {isCompleted ? (
                              <Check className="h-4 w-4" />
                            ) : (
                              <Icon className="h-4 w-4" />
                            )}
                          </div>
                          <div className="hidden sm:block text-left">
                            <p className="text-xs font-semibold">{s.label}</p>
                            <p className="text-[10px] text-muted-foreground">{s.description}</p>
                          </div>
                        </button>
                        {i < STEPS.length - 1 && (
                          <div
                            className={cn(
                              "flex-1 h-0.5 mx-3 rounded-full transition-colors duration-300",
                              i < step ? "bg-brand-green" : "bg-muted"
                            )}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Badge className="bg-brand-green text-white">Mzansi Market</Badge>
                    <span className="text-sm text-muted-foreground font-normal">
                      Step {step + 1} of {STEPS.length}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleSubmit} className="space-y-5">
                    {/* ═══════════════════════════════════════════════════
                                    STEP 0: Details
                       ═══════════════════════════════════════════════════ */}
                    {step === 0 && (
                      <div className="space-y-5 animate-in fade-in slide-in-from-right-3 duration-300">
                        {/* Category Picker */}
                        <CategoryPicker
                          value={category}
                          onChange={handleCategoryChange}
                          attributes={categoryAttributes}
                          onAttributeChange={handleAttributeChange}
                        />

                        {/* Title */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label htmlFor="title">Title *</Label>
                            <span
                              className={cn(
                                "text-xs transition-colors",
                                title.length > TITLE_MAX * 0.9
                                  ? "text-red-500 font-medium"
                                  : "text-muted-foreground"
                              )}
                            >
                              {title.length}/{TITLE_MAX}
                            </span>
                          </div>
                          <Input
                            id="title"
                            value={title}
                            onChange={(e) => setTitle(e.target.value.slice(0, TITLE_MAX))}
                            placeholder="e.g. iPhone 15 Pro Max 256GB"
                            maxLength={TITLE_MAX}
                            required
                          />
                        </div>

                        {/* Description */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label htmlFor="description">Description *</Label>
                            <span
                              className={cn(
                                "text-xs transition-colors",
                                description.length > DESC_MAX * 0.9
                                  ? "text-red-500 font-medium"
                                  : "text-muted-foreground"
                              )}
                            >
                              {description.length}/{DESC_MAX}
                            </span>
                          </div>
                          <textarea
                            id="description"
                            className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 transition-shadow"
                            value={description}
                            onChange={(e) => setDescription(e.target.value.slice(0, DESC_MAX))}
                            placeholder="Describe your item in detail — condition, reason for selling, what's included..."
                            required
                          />
                        </div>
                      </div>
                    )}

                    {/* ═══════════════════════════════════════════════════
                                    STEP 1: Pricing & Location
                       ═══════════════════════════════════════════════════ */}
                    {step === 1 && (
                      <div className="space-y-5 animate-in fade-in slide-in-from-right-3 duration-300">
                        {/* Price with Negotiable toggle */}
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
                                min="0"
                                step="0.01"
                                value={price}
                                onChange={(e) => setPrice(e.target.value)}
                                placeholder="0.00"
                                className="pl-8"
                                required
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => setNegotiable((v) => !v)}
                              className={cn(
                                "flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-all",
                                negotiable
                                  ? "border-brand-green bg-brand-green/10 text-brand-green"
                                  : "border-input text-muted-foreground hover:border-brand-green/50"
                              )}
                            >
                              <div
                                className={cn(
                                  "h-4 w-4 rounded-full border-2 flex items-center justify-center transition-all",
                                  negotiable
                                    ? "border-brand-green bg-brand-green"
                                    : "border-muted-foreground/40"
                                )}
                              >
                                {negotiable && <Check className="h-2.5 w-2.5 text-white" />}
                              </div>
                              Negotiable
                            </button>
                          </div>
                        </div>

                        {/* Location: Province / City / Town */}
                        <div className="space-y-3">
                          <Label className="text-base font-semibold">Location</Label>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div className="space-y-1.5">
                              <Label htmlFor="province">Province</Label>
                              <select
                                id="province"
                                aria-label="Province"
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 transition-shadow"
                                value={province}
                                onChange={(e) => {
                                  setProvince(e.target.value);
                                  setCity("");
                                  setTown("");
                                }}
                              >
                                <option value="">Select province</option>
                                {provinces.map((p) => (
                                  <option key={p} value={p}>
                                    {p}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div className="space-y-1.5">
                              <Label htmlFor="city">City</Label>
                              <select
                                id="city"
                                aria-label="City"
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 transition-shadow"
                                value={city}
                                onChange={(e) => {
                                  setCity(e.target.value);
                                  setTown("");
                                }}
                                disabled={!province}
                              >
                                <option value="">Select city</option>
                                {cities.map((c) => (
                                  <option key={c} value={c}>
                                    {c}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div className="space-y-1.5">
                              <Label htmlFor="town">Town / Suburb</Label>
                              <Input
                                id="town"
                                value={town}
                                onChange={(e) => setTown(e.target.value)}
                                placeholder="e.g. Sandton, Umlazi"
                                disabled={!city}
                              />
                            </div>
                          </div>
                        </div>

                        {/* Contact Methods */}
                        <div className="space-y-3">
                          <Label className="text-base font-semibold">Contact Methods *</Label>
                          <p className="text-xs text-muted-foreground">How can buyers reach you?</p>
                          <div className="grid grid-cols-3 gap-2">
                            {CONTACT_OPTIONS.map((opt) => {
                              const Icon = opt.icon;
                              const isSelected = contactMethods.includes(opt.id);
                              return (
                                <button
                                  key={opt.id}
                                  type="button"
                                  onClick={() => toggleContact(opt.id)}
                                  className={cn(
                                    "flex flex-col items-center gap-1.5 rounded-lg border-2 p-3 text-xs font-medium transition-all",
                                    isSelected
                                      ? "border-brand-green bg-brand-green/10 text-brand-green shadow-sm"
                                      : "border-input text-muted-foreground hover:border-brand-green/40 hover:bg-muted/50"
                                  )}
                                >
                                  <Icon className="h-5 w-5" />
                                  {opt.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* ═══════════════════════════════════════════════════
                                    STEP 2: Media & Review
                       ═══════════════════════════════════════════════════ */}
                    {step === 2 && (
                      <div className="space-y-5 animate-in fade-in slide-in-from-right-3 duration-300">
                        {/* Photos */}
                        <MediaUpload
                          label={`Photos (max ${maxPhotos})`}
                          maxFiles={maxPhotos}
                          files={photoFiles}
                          onChange={setPhotoFiles}
                          accept="image/*"
                        />

                        {/* Video */}
                        <MediaUpload
                          label={`Video (max 1)${!videoAllowed ? " — Upgrade to unlock" : ""}`}
                          maxFiles={1}
                          files={videoFile}
                          onChange={setVideoFile}
                          accept="video/*"
                          disabled={!videoAllowed}
                        />

                        {/* Video Cover Image — shown before video plays */}
                        {videoFile.length > 0 && (
                          <MediaUpload
                            label="Video Cover Image (1 max) — Shown before video plays"
                            maxFiles={1}
                            files={videoCoverFile}
                            onChange={setVideoCoverFile}
                            accept="image/*"
                          />
                        )}

                        {/* Preview */}
                        {renderPreview()}

                        {/* Submit button */}
                        <Button
                          type="submit"
                          className="w-full h-12 text-base font-semibold"
                          disabled={isSubmitting}
                          size="lg"
                        >
                          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                          Submit Listing for Review
                        </Button>
                      </div>
                    )}

                    {/* ── Step Navigation ────────────────────────── */}
                    {step < STEPS.length - 1 && (
                      <div className="flex items-center justify-between pt-4 border-t">
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={goBack}
                          disabled={step === 0}
                          className="gap-1"
                        >
                          <ChevronLeft className="h-4 w-4" />
                          Back
                        </Button>
                        <Button type="button" onClick={goNext} className="gap-1">
                          Next
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    )}

                    {step === STEPS.length - 1 && step > 0 && (
                      <div className="flex items-center pt-2">
                        <Button type="button" variant="ghost" onClick={goBack} className="gap-1">
                          <ChevronLeft className="h-4 w-4" />
                          Back
                        </Button>
                      </div>
                    )}
                  </form>
                </CardContent>
              </Card>
            </PlanGate>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
