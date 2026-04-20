"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { Megaphone, ArrowLeft, Loader2, X, Building2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { PageHeader } from "@/components/layout/page-header";
import { MediaUpload } from "@/components/ui/media-upload";
import { UploadProgressPanel, type UploadSlotStatus } from "@/components/ui/upload-progress-panel";
import { LocationSelector } from "@/components/ui/location-selector";
import { type BusinessCategory, type PromotionType } from "@/types/enums";
import { normalizeMediaUrl } from "@/lib/utils/media-url";
import {
  usePlanMaxPhotos,
  usePlanMaxVideos,
  usePlanVideoAllowed,
} from "@/components/billing/plan-gate";
import { normalizeCreatePostRuntimeError } from "@/app/post/_lib/create-post-errors";
import { validatePromotionForm } from "@/lib/forms/promotion-form";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import { fetchWithRetry } from "@/lib/utils/fetch-retry";
import { useToast } from "@/hooks/use-toast";
import {
  BUSINESS_CATEGORIES,
  EVENT_TYPES,
  EVENT_AGE_RESTRICTIONS,
  EVENT_ACCESSIBILITY_OPTIONS,
} from "@/lib/constants/categories";
import { PromotionDetailContent } from "@/components/listings/promotion-detail-content";
import { readMediaDimensions } from "@/lib/utils/media-metadata";
const selectClass =
  "flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 transition-shadow sm:h-10 sm:text-sm";

export default function EditPromotionPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const promotionId = params.id;

  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitProgress, setSubmitProgress] = useState<string | null>(null);
  const [uploadStatuses, setUploadStatuses] = useState<Record<string, UploadSlotStatus>>({
    logo: "idle",
    photos: "idle",
    videos: "idle",
    saving: "idle",
  });
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Form state
  const [promotionType, setPromotionType] = useState<PromotionType>("event");
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
  // Existing URLs loaded from API
  const [existingImages, setExistingImages] = useState<string[]>([]);
  const [existingVideos, setExistingVideos] = useState<string[]>([]);
  const [videoThumbnail, setVideoThumbnail] = useState("");
  // New files to upload
  const [newPhotoFiles, setNewPhotoFiles] = useState<File[]>([]);
  const [newVideoFiles, setNewVideoFiles] = useState<File[]>([]);
  const [focalPoint, setFocalPoint] = useState({ x: 0.5, y: 0.5 });

  // Logo
  const [existingLogoUrl, setExistingLogoUrl] = useState("");
  const [newLogoFile, setNewLogoFile] = useState<File[]>([]);
  const [logoBlobUrl, setLogoBlobUrl] = useState<string | null>(null);
  const logoPreviewUrl = logoBlobUrl || existingLogoUrl || null;

  // Link to Business
  const [businessId, setBusinessId] = useState("");
  const [myBusinesses, setMyBusinesses] = useState<{ id: string; business_name: string }[]>([]);

  // Event details
  const [eventType, setEventType] = useState("");
  const [venueName, setVenueName] = useState("");
  const [venueCapacity, setVenueCapacity] = useState("");
  const [ticketTiers, setTicketTiers] = useState<{ name: string; price_cents: number | null }[]>(
    []
  );
  const [ticketsUrl, setTicketsUrl] = useState("");
  const [ageRestriction, setAgeRestriction] = useState("");
  const [dressCode, setDressCode] = useState("");
  const [lineup, setLineup] = useState("");
  const [parkingAvailable, setParkingAvailable] = useState(false);
  const [accessibility, setAccessibility] = useState<string[]>([]);
  const [foodDrinksAvailable, setFoodDrinksAvailable] = useState(false);
  const [bringYourOwn, setBringYourOwn] = useState("");

  const maxPhotos = usePlanMaxPhotos("PROMOTIONS_EVENTS");
  const maxVideos = usePlanMaxVideos("PROMOTIONS_EVENTS");
  const videoAllowed = usePlanVideoAllowed("PROMOTIONS_EVENTS");
  const previewPhotoUrls = useMemo(
    () => newPhotoFiles.map((file) => URL.createObjectURL(file)),
    [newPhotoFiles]
  );
  const previewVideoUrls = useMemo(
    () => newVideoFiles.map((file) => URL.createObjectURL(file)),
    [newVideoFiles]
  );

  // Load existing data and user's businesses
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/promotions/${promotionId}`);
        if (!res.ok) {
          setError("Tourism & Events listing not found");
          return;
        }
        const data = await res.json();
        const p = data.promotion;

        setPromotionType("event");
        setTitle(p.title || "");
        setDescription(p.description || "");
        setCategory(p.category || "");
        setCategoryKey((p.category_key as BusinessCategory | null) || "");
        setPriceZar(p.price_cents ? (p.price_cents / 100).toString() : "");
        setNegotiable(p.price_negotiable || false);
        setProvince(p.location_province || "");
        setCity(p.location_city || "");
        setLocationTown(p.location_town || "");
        setLocationAddress(p.location_address || "");
        setContactMethods(p.contact_methods || ["call"]);
        setStartDate(p.start_date ? p.start_date.split("T")[0] : "");
        setEndDate(p.end_date ? p.end_date.split("T")[0] : "");
        setExistingImages(p.photos || []);
        setExistingVideos(p.videos || []);
        setVideoThumbnail(p.video_thumbnail || "");
        setFocalPoint({
          x: typeof p.focal_x === "number" ? p.focal_x : 0.5,
          y: typeof p.focal_y === "number" ? p.focal_y : 0.5,
        });
        setBusinessId(p.business_id || "");
        setExistingLogoUrl(p.logo_url || "");
        // Load event details if present
        const ed = p.event_details;
        if (ed && typeof ed === "object") {
          setEventType(ed.event_type || "");
          setVenueName(ed.venue_name || "");
          setVenueCapacity(ed.venue_capacity != null ? String(ed.venue_capacity) : "");
          setTicketTiers(Array.isArray(ed.ticket_tiers) ? ed.ticket_tiers : []);
          setTicketsUrl(ed.tickets_url || "");
          setAgeRestriction(ed.age_restriction || "");
          setDressCode(ed.dress_code || "");
          setLineup(ed.lineup || "");
          setParkingAvailable(!!ed.parking_available);
          setAccessibility(Array.isArray(ed.accessibility) ? ed.accessibility : []);
          setFoodDrinksAvailable(!!ed.food_drinks_available);
          setBringYourOwn(ed.bring_your_own || "");
        }
      } catch {
        setError("Failed to load promotion");
      } finally {
        setIsLoading(false);
      }
    }

    async function loadBusinesses() {
      try {
        const res = await fetch("/api/businesses?mine=true&limit=50");
        if (res.ok) {
          const data = await res.json();
          setMyBusinesses(data.businesses ?? []);
        }
      } catch {
        // non-critical
      }
    }

    void load();
    void loadBusinesses();
  }, [promotionId]);

  useEffect(
    () => () => {
      previewPhotoUrls.forEach((url) => URL.revokeObjectURL(url));
    },
    [previewPhotoUrls]
  );

  useEffect(
    () => () => {
      previewVideoUrls.forEach((url) => URL.revokeObjectURL(url));
    },
    [previewVideoUrls]
  );

  useEffect(() => {
    if (newLogoFile[0]) {
      const url = URL.createObjectURL(newLogoFile[0]);
      queueMicrotask(() => {
        setLogoBlobUrl(url);
      });
      return () => URL.revokeObjectURL(url);
    }
    queueMicrotask(() => {
      setLogoBlobUrl(null);
    });
  }, [newLogoFile]);

  function toggleContact(method: string) {
    setContactMethods((prev) =>
      prev.includes(method) ? prev.filter((m) => m !== method) : [...prev, method]
    );
  }

  function removeExistingImage(index: number) {
    if (!window.confirm("Remove this photo?")) return;
    setExistingImages((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit() {
    setIsSubmitting(true);
    setSubmitProgress("Uploading media...");
    setUploadStatuses({
      logo: newLogoFile.length > 0 ? "uploading" : "skipped",
      photos: newPhotoFiles.length > 0 ? "uploading" : "skipped",
      videos: newVideoFiles.length > 0 ? "uploading" : "skipped",
      saving: "idle",
    });
    setError(null);
    setFieldErrors({});

    try {
      const validationErrors = validatePromotionForm({
        priceZar,
        startDate,
        endDate,
        contactMethods,
      });
      const totalVideoCount = existingVideos.length + newVideoFiles.length;
      if (existingImages.length + newPhotoFiles.length > maxPhotos) {
        validationErrors.images = `You can upload up to ${maxPhotos} photos on this plan.`;
      }
      if (!videoAllowed && totalVideoCount > 0) {
        validationErrors.videos = "Video upload is not available on your current plan.";
      } else if (totalVideoCount > maxVideos) {
        validationErrors.videos = `You can upload up to ${maxVideos} videos on this plan.`;
      }
      if (Object.keys(validationErrors).length > 0) {
        setFieldErrors(validationErrors);
        setError(Object.values(validationErrors)[0]);
        setIsSubmitting(false);
        setSubmitProgress(null);
        return;
      }

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

      // Upload new photos and videos in parallel
      let compressedVideoFileRef: File | null = null;
      const [newImageUrls, newVideoUrls] = await Promise.all([
        // Photos via server proxy
        newPhotoFiles.length > 0
          ? (async () => {
              const uploadData = new FormData();
              uploadData.append("area", "promotion");
              for (const f of newPhotoFiles) uploadData.append("files", f);
              const uploadRes = await fetchWithRetry("/api/media/upload", {
                method: "POST",
                headers: withCsrfHeaders(),
                body: uploadData,
              });
              if (!uploadRes.ok) {
                throw new Error(await readUploadError(uploadRes, "Failed to upload photos"));
              }
              const uploadJson = await uploadRes.json();
              setUploadStatuses((c) => ({ ...c, photos: "done" }));
              return (uploadJson.urls || []) as string[];
            })()
          : Promise.resolve([] as string[]),

        // Videos via presigned URL (direct to R2)
        newVideoFiles.length > 0
          ? (async () => {
              setSubmitProgress("Compressing video...");
              const { compressVideoForUpload } = await import("@/lib/media/compress-before-upload");
              // Compress sequentially — parallel would spawn multiple ~25 MB FFmpeg
              // WASM instances and risk OOM on mobile devices.
              const compressed: File[] = [];
              for (const f of newVideoFiles) {
                compressed.push(await compressVideoForUpload(f));
              }
              compressedVideoFileRef = compressed[0] ?? null;
              setSubmitProgress("Uploading media...");
              const result = await Promise.all(
                compressed.map(async (file) => {
                  const urlRes = await fetchWithRetry("/api/media/upload-url", {
                    method: "POST",
                    headers: withCsrfHeaders({ "Content-Type": "application/json" }),
                    body: JSON.stringify({
                      filename: file.name,
                      contentType: file.type,
                      size: file.size,
                      area: "promotion",
                    }),
                  });
                  if (!urlRes.ok) {
                    throw new Error(
                      await readUploadError(urlRes, "Failed to get video upload URL")
                    );
                  }
                  const { uploadUrl, publicUrl } = await urlRes.json();
                  const putRes = await fetchWithRetry(uploadUrl, {
                    method: "PUT",
                    headers: { "Content-Type": file.type },
                    body: file,
                  });
                  if (!putRes.ok) {
                    throw new Error(`Failed to upload video (HTTP ${putRes.status})`);
                  }
                  return publicUrl as string;
                })
              );
              setUploadStatuses((c) => ({ ...c, videos: "done" }));
              return result;
            })()
          : Promise.resolve([] as string[]),
      ]);

      const allImages = [...existingImages, ...newImageUrls];
      const allVideos = [...existingVideos, ...newVideoUrls];
      const primaryMediaFile =
        compressedVideoFileRef ?? newVideoFiles[0] ?? newPhotoFiles[0] ?? null;
      const mediaDimensions = primaryMediaFile ? await readMediaDimensions(primaryMediaFile) : null;

      // Upload logo if a new one was selected
      let uploadedLogoUrl: string | undefined;
      if (newLogoFile[0]) {
        const logoData = new FormData();
        logoData.append("area", "promotion");
        logoData.append("files", newLogoFile[0]);
        const logoRes = await fetchWithRetry("/api/media/upload", {
          method: "POST",
          headers: withCsrfHeaders(),
          body: logoData,
        });
        if (!logoRes.ok) {
          throw new Error(await readUploadError(logoRes, "Failed to upload logo"));
        }
        const logoJson = await logoRes.json();
        uploadedLogoUrl = (logoJson.urls as string[])?.[0];
        setUploadStatuses((c) => ({ ...c, logo: "done" }));
      }

      setSubmitProgress("Saving promotion...");
      setUploadStatuses((c) => ({ ...c, saving: "uploading" }));

      const body = {
        title,
        description,
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
        logo_url: uploadedLogoUrl || existingLogoUrl || undefined,
        images: allImages,
        videos: allVideos,
        video_thumbnail: videoThumbnail || undefined,
        media_width: mediaDimensions?.width,
        media_height: mediaDimensions?.height,
        focal_x: focalPoint.x,
        focal_y: focalPoint.y,
        start_date: startDate ? new Date(startDate).toISOString() : undefined,
        end_date: endDate ? new Date(endDate).toISOString() : undefined,
        business_id: businessId || undefined,
        event_details: {
          event_type: eventType || undefined,
          venue_name: venueName || undefined,
          venue_capacity: venueCapacity ? parseInt(venueCapacity, 10) : undefined,
          ticket_tiers: ticketTiers.length > 0 ? ticketTiers : undefined,
          tickets_url: ticketsUrl || undefined,
          age_restriction: ageRestriction || undefined,
          dress_code: dressCode || undefined,
          lineup: lineup || undefined,
          parking_available: parkingAvailable,
          accessibility: accessibility.length > 0 ? accessibility : undefined,
          food_drinks_available: foodDrinksAvailable,
          bring_your_own: bringYourOwn || undefined,
        },
      };

      const res = await fetch(`/api/promotions/${promotionId}`, {
        method: "PUT",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to update tourism and events listing");
        if (data?.details && typeof data.details === "object") {
          setFieldErrors(data.details as Record<string, string>);
        }
        return;
      }

      toast({ title: "Tourism & Events listing updated!", variant: "success" });
      setUploadStatuses((c) => ({ ...c, saving: "done" }));
      router.push("/dashboard/listings?area=PROMOTIONS_EVENTS&updated=promotion");
    } catch (error: unknown) {
      setError(normalizeCreatePostRuntimeError(error, "Something went wrong. Please try again."));
    } finally {
      setIsSubmitting(false);
      setSubmitProgress(null);
      setUploadStatuses({ logo: "idle", photos: "idle", videos: "idle", saving: "idle" });
    }
  }

  const totalImages = existingImages.length + newPhotoFiles.length;
  const previewImages = previewPhotoUrls.length > 0 ? previewPhotoUrls : existingImages;
  const previewVideos = previewVideoUrls.length > 0 ? previewVideoUrls : existingVideos;
  const linkedBusiness = businessId
    ? (myBusinesses.find((item) => item.id === businessId) ?? null)
    : null;

  if (isLoading) {
    return (
      <div className="flex min-h-screen flex-col">
        <Header isAuthenticated />
        <main className="flex-1 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header isAuthenticated />

      <main className="flex-1">
        <div className="container-page py-4 space-y-4 max-w-3xl">
          <PageHeader
            title="Edit Event"
            breadcrumbs={[
              { label: "Dashboard", href: "/dashboard" },
              { label: "Tourism & Events", href: "/dashboard/tourism-events" },
              { label: "Edit" },
            ]}
          />

          {error && (
            <div className="bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400 p-4 rounded-lg text-sm">
              {error}
            </div>
          )}

          <Card>
            <CardContent className="p-5 space-y-5">
              <div className="space-y-2">
                <Label htmlFor="title">Event Title</Label>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={120}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={6}
                  maxLength={5000}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="category_key">Category</Label>
                <select
                  id="category_key"
                  aria-label="Canonical category"
                  className={selectClass}
                  value={categoryKey}
                  onChange={(e) => setCategoryKey(e.target.value as BusinessCategory | "")}
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
                  onChange={(e) => setCategory(e.target.value)}
                  maxLength={100}
                />
              </div>

              {/* Link to Business */}
              {myBusinesses.length > 0 && (
                <div className="space-y-2">
                  <Label htmlFor="business_id" className="flex items-center gap-1.5">
                    <Building2 className="h-4 w-4 text-brand-blue" />
                    Link to Business (optional)
                  </Label>
                  <select
                    id="business_id"
                    aria-label="Link to Business"
                    className={selectClass}
                    value={businessId}
                    onChange={(e) => setBusinessId(e.target.value)}
                  >
                    <option value="">No linked business</option>
                    {myBusinesses.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.business_name}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Links this promotion to a business profile.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="price">Price (ZAR, optional)</Label>
                  <Input
                    id="price"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={priceZar}
                    onChange={(e) => setPriceZar(e.target.value)}
                  />
                </div>
                <div className="flex items-end pb-2">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={negotiable}
                      onChange={(e) => setNegotiable(e.target.checked)}
                      className="rounded"
                    />
                    Negotiable
                  </label>
                </div>
              </div>

              <LocationSelector
                value={{
                  province,
                  city,
                  town: locationTown,
                  address: locationAddress,
                }}
                onChange={(newLocation) => {
                  setProvince(newLocation.province);
                  setCity(newLocation.city);
                  setLocationTown(newLocation.town || "");
                  setLocationAddress(newLocation.address || "");
                }}
                showTown={true}
                showAddress={true}
                errors={fieldErrors}
              />

              <div className="space-y-2">
                <Label>Contact Methods</Label>
                <div className="flex flex-wrap gap-3">
                  {(["call", "whatsapp", "form"] as const).map((method) => (
                    <label key={method} className="flex items-center gap-2 text-sm cursor-pointer">
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
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="start_date">Start Date</Label>
                  <Input
                    id="start_date"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="end_date">End Date</Label>
                  <Input
                    id="end_date"
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>
              </div>

              {/* ── Event Details ─────────────────────────── */}
              <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
                <p className="text-sm font-medium">Event Details (optional)</p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label htmlFor="event_type">Event Type</Label>
                    <p className="text-xs text-muted-foreground">
                      Category that best describes your event.
                    </p>
                    <select
                      id="event_type"
                      className={selectClass}
                      aria-label="Event Type"
                      value={eventType}
                      onChange={(e) => setEventType(e.target.value)}
                    >
                      <option value="">Select type…</option>
                      {EVENT_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="age_restriction">Age Restriction</Label>
                    <p className="text-xs text-muted-foreground">
                      Minimum age for attendees, if any.
                    </p>
                    <select
                      id="age_restriction"
                      className={selectClass}
                      aria-label="Age Restriction"
                      value={ageRestriction}
                      onChange={(e) => setAgeRestriction(e.target.value)}
                    >
                      <option value="">No restriction</option>
                      {EVENT_AGE_RESTRICTIONS.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label htmlFor="venue_name">Venue Name</Label>
                    <p className="text-xs text-muted-foreground">
                      Name of the venue or location hosting the event.
                    </p>
                    <Input
                      id="venue_name"
                      value={venueName}
                      onChange={(e) => setVenueName(e.target.value)}
                      maxLength={200}
                      placeholder="e.g. Sun Arena, Pretoria"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="venue_capacity">Venue Capacity</Label>
                    <p className="text-xs text-muted-foreground">
                      Maximum number of attendees the venue can hold.
                    </p>
                    <Input
                      id="venue_capacity"
                      type="number"
                      min="0"
                      value={venueCapacity}
                      onChange={(e) => setVenueCapacity(e.target.value)}
                      placeholder="e.g. 500"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="dress_code">Dress Code</Label>
                  <p className="text-xs text-muted-foreground">Suggested attire for the event.</p>
                  <Input
                    id="dress_code"
                    value={dressCode}
                    onChange={(e) => setDressCode(e.target.value)}
                    maxLength={300}
                    placeholder="e.g. Smart casual"
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="lineup">Lineup / Performers</Label>
                  <p className="text-xs text-muted-foreground">
                    Key performers, speakers, or programme highlights.
                  </p>
                  <Textarea
                    id="lineup"
                    value={lineup}
                    onChange={(e) => setLineup(e.target.value)}
                    rows={3}
                    maxLength={2000}
                    placeholder="e.g. Artist 1, Artist 2, DJ Name…"
                  />
                </div>

                {/* Ticket tiers */}
                <div className="space-y-2">
                  <Label>Ticket Tiers</Label>
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
                        placeholder="Tier name"
                        className="flex-1"
                        maxLength={80}
                      />
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        value={tier.price_cents != null ? (tier.price_cents / 100).toString() : ""}
                        onChange={(e) => {
                          const next = [...ticketTiers];
                          next[i] = {
                            ...next[i],
                            price_cents: e.target.value
                              ? Math.round(parseFloat(e.target.value) * 100)
                              : null,
                          };
                          setTicketTiers(next);
                        }}
                        placeholder="Price (ZAR)"
                        className="w-28"
                      />
                      <button
                        type="button"
                        onClick={() => setTicketTiers((prev) => prev.filter((_, idx) => idx !== i))}
                        className="text-muted-foreground hover:text-destructive"
                        aria-label="Remove tier"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                  {ticketTiers.length < 10 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setTicketTiers((prev) => [...prev, { name: "", price_cents: null }])
                      }
                      className="gap-1"
                    >
                      <Plus className="h-3 w-3" /> Add Tier
                    </Button>
                  )}
                </div>

                <div className="space-y-1">
                  <Label htmlFor="tickets_url">Tickets URL</Label>
                  <p className="text-xs text-muted-foreground">
                    Link where attendees can purchase tickets online.
                  </p>
                  <Input
                    id="tickets_url"
                    type="url"
                    value={ticketsUrl}
                    onChange={(e) => setTicketsUrl(e.target.value)}
                    maxLength={2000}
                    placeholder="https://…"
                  />
                </div>

                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={parkingAvailable}
                      onChange={(e) => setParkingAvailable(e.target.checked)}
                      className="rounded"
                    />
                    Parking available
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={foodDrinksAvailable}
                      onChange={(e) => setFoodDrinksAvailable(e.target.checked)}
                      className="rounded"
                    />
                    Food & drinks available
                  </label>
                </div>

                <div className="space-y-1">
                  <Label>Accessibility</Label>
                  <p className="text-xs text-muted-foreground">
                    Select all accessibility features available at the venue.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {EVENT_ACCESSIBILITY_OPTIONS.map((opt) => {
                      const active = accessibility.includes(opt);
                      return (
                        <Badge
                          key={opt}
                          variant={active ? "default" : "outline"}
                          className="cursor-pointer"
                          onClick={() =>
                            setAccessibility((prev) =>
                              active ? prev.filter((a) => a !== opt) : [...prev, opt]
                            )
                          }
                        >
                          {opt}
                        </Badge>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="bring_your_own">What to Bring</Label>
                  <p className="text-xs text-muted-foreground">
                    Items attendees should bring along.
                  </p>
                  <Input
                    id="bring_your_own"
                    value={bringYourOwn}
                    onChange={(e) => setBringYourOwn(e.target.value)}
                    maxLength={500}
                    placeholder="e.g. Blankets, chairs, sunscreen"
                  />
                </div>
              </div>

              {/* Existing images preview */}
              {existingImages.length > 0 && (
                <div className="space-y-2">
                  <Label>Current Photos ({existingImages.length})</Label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {existingImages.map((url, i) => (
                      <div
                        key={i}
                        className="relative group aspect-square rounded-lg overflow-hidden border"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={normalizeMediaUrl(url)}
                          alt={`Photo ${i + 1}`}
                          className="w-full h-full bg-muted object-contain"
                        />
                        <button
                          type="button"
                          onClick={() => removeExistingImage(i)}
                          className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                          aria-label="Remove photo"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Add new photos */}
              <MediaUpload
                label={`Add Photos (${totalImages}/${maxPhotos})`}
                maxFiles={Math.max(0, maxPhotos - existingImages.length)}
                files={newPhotoFiles}
                onChange={setNewPhotoFiles}
                accept="image/*"
              />

              {/* Add new videos */}
              <MediaUpload
                label={`Add Videos (optional, max ${maxVideos})${!videoAllowed ? " — Upgrade to unlock" : ""}`}
                maxFiles={Math.max(0, maxVideos - existingVideos.length)}
                files={newVideoFiles}
                onChange={setNewVideoFiles}
                accept="video/*"
                disabled={!videoAllowed}
              />

              {/* Event logo */}
              <div className="space-y-2">
                <Label>Event Logo (optional)</Label>
                {existingLogoUrl && newLogoFile.length === 0 && (
                  <div className="relative group w-16 h-16 rounded-lg overflow-hidden border">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={normalizeMediaUrl(existingLogoUrl)}
                      alt="Current logo"
                      className="w-full h-full object-contain"
                    />
                    <button
                      type="button"
                      onClick={() => setExistingLogoUrl("")}
                      className="absolute top-0.5 right-0.5 bg-black/60 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                      aria-label="Remove logo"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                )}
                <MediaUpload
                  label="Upload Logo"
                  maxFiles={1}
                  files={newLogoFile}
                  onChange={setNewLogoFile}
                  accept="image/*"
                />
              </div>

              <div className="rounded-xl border border-dashed border-brand-green/30 bg-brand-green/5 p-4">
                <div className="mb-3 text-sm font-medium text-muted-foreground">
                  Promotion preview
                </div>
                <PromotionDetailContent
                  promotion={{
                    id: promotionId,
                    owner_id: "preview-seller",
                    business_id: businessId || null,
                    title: title || "Your promotion title",
                    description: description || "Your promotion description will appear here.",
                    promotion_type: promotionType,
                    category: category || null,
                    category_key: categoryKey || null,
                    photos: previewImages,
                    videos: previewVideos,
                    video_thumbnail: videoThumbnail || null,
                    logo_url: logoPreviewUrl,
                    price_cents: priceZar ? Math.round(parseFloat(priceZar || "0") * 100) : null,
                    price_negotiable: negotiable,
                    location_province: province || "South Africa",
                    location_city: city || "Online",
                    location_town: locationTown || null,
                    location_address: locationAddress || null,
                    contact_methods: contactMethods,
                    start_date: startDate ? new Date(startDate).toISOString() : null,
                    end_date: endDate ? new Date(endDate).toISOString() : null,
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
                    linkedBusiness
                      ? {
                          id: linkedBusiness.id,
                          business_name: linkedBusiness.business_name,
                          logo_url: null,
                        }
                      : null
                  }
                  showContactActions={false}
                  showContactSummary
                  trackView={false}
                  layoutMode="review"
                />
              </div>

              {!isSubmitting &&
                (totalImages === 0 ||
                  title.length < 5 ||
                  description.length < 20 ||
                  !province ||
                  !city) && (
                  <p className="text-xs text-destructive text-right">
                    {totalImages === 0
                      ? "At least one photo is required."
                      : title.length < 5
                        ? "Title must be at least 5 characters."
                        : description.length < 20
                          ? "Description must be at least 20 characters."
                          : !province || !city
                            ? "Province and city are required."
                            : null}
                  </p>
                )}
              <UploadProgressPanel
                visible={isSubmitting}
                slots={[
                  {
                    key: "logo",
                    label: "Uploading logo...",
                    doneLabel: "Logo uploaded",
                    status: newLogoFile.length > 0 ? uploadStatuses.logo : "skipped",
                  },
                  {
                    key: "photos",
                    label: "Uploading photos...",
                    doneLabel: "Photos uploaded",
                    status: newPhotoFiles.length > 0 ? uploadStatuses.photos : "skipped",
                  },
                  {
                    key: "videos",
                    label: "Uploading video...",
                    doneLabel: "Video uploaded",
                    status: newVideoFiles.length > 0 ? uploadStatuses.videos : "skipped",
                  },
                  {
                    key: "saving",
                    label: "Saving promotion...",
                    doneLabel: "Promotion saved",
                    status: uploadStatuses.saving,
                  },
                ]}
              />

              <div className="flex justify-between">
                <Button variant="outline" asChild className="h-11 gap-1">
                  <Link href="/dashboard/tourism-events">
                    <ArrowLeft className="h-4 w-4" />
                    Cancel
                  </Link>
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={
                    isSubmitting ||
                    totalImages === 0 ||
                    title.length < 5 ||
                    description.length < 20 ||
                    !province ||
                    !city
                  }
                  className="h-11 gap-1"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {submitProgress || "Saving..."}
                    </>
                  ) : (
                    <>
                      <Megaphone className="h-4 w-4" />
                      Save Changes
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>

      <Footer />
    </div>
  );
}
