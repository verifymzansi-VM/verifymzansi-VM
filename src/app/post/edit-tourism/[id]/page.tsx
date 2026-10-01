"use client";
import { EventDateFields } from "@/components/post/event-date-fields";
import { eventTimeToIso, eventTimeForInput } from "@/lib/forms/event-time";
import { PostSelect } from "@/components/post/post-select";

import { settleMediaUploads } from "@/app/post/_lib/settle-media-uploads";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { Loader2, X, Building2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PostLabel as Label } from "@/components/post/post-label";
import { Textarea } from "@/components/ui/textarea";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { PageHeader } from "@/components/layout/page-header";
import { MediaUpload } from "@/components/ui/media-upload";
import { OnlinePresenceFields } from "@/components/post/online-presence-fields";
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
  getPromotionMediaUploadErrorState,
  uploadPromotionVideoFiles,
} from "@/app/post/_lib/promotion-media-upload";
import {
  BUSINESS_CATEGORIES,
  EVENT_TYPES,
  EVENT_AGE_RESTRICTIONS,
  EVENT_ACCESSIBILITY_OPTIONS,
} from "@/lib/constants/categories";
import { PromotionDetailContent } from "@/components/listings/promotion-detail-content";
import { readMediaDimensions } from "@/lib/utils/media-metadata";
import { isValidUserEnteredUrl, normalizeUserEnteredUrl } from "@/lib/utils/external-url";
const selectClass =
  "flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 transition-shadow sm:h-10 sm:text-sm";

export default function EditPromotionPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const promotionId = params.id;

  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submissionInFlightRef = useRef(false);
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
  const [website, setWebsite] = useState("");
  const [mapDirections, setMapDirections] = useState("");
  const [socialFacebook, setSocialFacebook] = useState("");
  const [socialInstagram, setSocialInstagram] = useState("");
  const [socialTwitter, setSocialTwitter] = useState("");
  const [socialTiktok, setSocialTiktok] = useState("");
  const [recurring, setRecurring] = useState("");
  const [rainPolicy, setRainPolicy] = useState("");
  const [earlyBirdDeadline, setEarlyBirdDeadline] = useState("");
  const [groupDiscountAvailable, setGroupDiscountAvailable] = useState(false);
  const [newVideoThumbnailFile, setNewVideoThumbnailFile] = useState<File[]>([]);

  const maxPhotos = usePlanMaxPhotos("PROMOTIONS_EVENTS");
  const maxVideos = usePlanMaxVideos("PROMOTIONS_EVENTS");
  const videoAllowed = usePlanVideoAllowed("PROMOTIONS_EVENTS");
  const effectiveMaxVideos = Math.max(maxVideos, existingVideos.length);
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
        // A stored 0 is free entry; a missing price stays blank so the owner chooses.
        setPriceZar(p.price_cents != null ? (p.price_cents / 100).toString() : "");
        setNegotiable(p.price_negotiable || false);
        setProvince(p.location_province || "");
        setCity(p.location_city || "");
        setLocationTown(p.location_town || "");
        setLocationAddress(p.location_address || "");
        setContactMethods(p.contact_methods || ["call"]);
        setStartDate(p.start_date ? eventTimeForInput(p.start_date) : "");
        setEndDate(p.end_date ? eventTimeForInput(p.end_date) : "");
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
          setWebsite(ed.website || "");
          setMapDirections(ed.map_directions || "");
          setSocialFacebook(ed.social_links?.facebook || "");
          setSocialInstagram(ed.social_links?.instagram || "");
          setSocialTwitter(ed.social_links?.twitter || "");
          setSocialTiktok(ed.social_links?.tiktok || "");
          setRecurring(ed.recurring || "");
          setRainPolicy(ed.rain_policy || "");
          setEarlyBirdDeadline(ed.early_bird_deadline || "");
          setGroupDiscountAvailable(!!ed.group_discount_available);
        }
      } catch {
        setError("Failed to load Tourism & Events post");
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
    if (submissionInFlightRef.current) return;
    submissionInFlightRef.current = true;
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
      if (!startDate || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(startDate))
        validationErrors.start_date = "Choose a start date and time (SAST).";
      if (!priceZar.trim())
        validationErrors.price_zar = "Choose free entry or enter a starting entry price.";
      if (!eventType) validationErrors.event_type = "Choose an event category.";
      if (!title.trim()) validationErrors.title = "Enter an event title.";
      else if (title.trim().length < 5)
        validationErrors.title = "Title must be at least 5 characters.";
      else if (title.trim().length > 120)
        validationErrors.title = "Title must be 120 characters or fewer.";

      if (!description.trim()) {
        validationErrors.description = "Enter event details.";
      } else if (description.trim().length < 20) {
        validationErrors.description = "Description must be at least 20 characters.";
      } else if (description.trim().length > 5000) {
        validationErrors.description = "Description must be 5000 characters or fewer.";
      }

      if (!province) validationErrors.province = "Select a province.";
      if (contactMethods.length === 0)
        validationErrors.contact_methods = "Choose at least one contact method.";
      if (!city) validationErrors.city = "Select a city.";
      if (province.trim().length > 50) {
        validationErrors.province = "Province must be 50 characters or fewer.";
      }
      if (city.trim().length > 80) {
        validationErrors.city = "City must be 80 characters or fewer.";
      }
      if (locationTown.trim().length > 120) {
        validationErrors.location_town = "Town / suburb must be 120 characters or fewer.";
      }
      if (locationAddress.trim().length > 300) {
        validationErrors.location_address = "Address must be 300 characters or fewer.";
      }
      if (ticketsUrl.trim() && !isValidUserEnteredUrl(ticketsUrl)) {
        validationErrors.tickets_url = "Enter a valid ticketing URL.";
      }
      for (const [key, value, message] of [
        ["website", website, "Enter a valid website URL."],
        ["map_directions", mapDirections, "Enter a valid map link, e.g. a Google Maps share link."],
        ["socialFacebook", socialFacebook, "Enter a valid Facebook URL."],
        ["socialInstagram", socialInstagram, "Enter a valid Instagram URL."],
        ["socialTwitter", socialTwitter, "Enter a valid X / Twitter URL."],
        ["socialTiktok", socialTiktok, "Enter a valid TikTok URL."],
      ] as const) {
        if (value.trim() && !isValidUserEnteredUrl(value)) validationErrors[key] = message;
      }

      const totalImageCount = existingImages.length + newPhotoFiles.length;
      const totalVideoCount =
        effectiveMaxVideos === 1 && newVideoFiles.length > 0
          ? newVideoFiles.length
          : existingVideos.length + newVideoFiles.length;
      if (totalImageCount === 0 && totalVideoCount === 0) {
        validationErrors.images = "Upload at least one photo or video.";
      }
      if (totalImageCount > maxPhotos) {
        validationErrors.images = `You can upload up to ${maxPhotos} photos on this plan.`;
      }
      if (!videoAllowed && newVideoFiles.length > 0) {
        validationErrors.videos = "Video upload is not available on your current plan.";
      } else if (totalVideoCount > effectiveMaxVideos) {
        validationErrors.videos = `You can upload up to ${effectiveMaxVideos} videos on this plan.`;
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
      const [newImageUrls, newVideoUrls] = await settleMediaUploads([
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

        // Videos via shared fast path with validated server fallback.
        newVideoFiles.length > 0
          ? (async () => {
              setSubmitProgress("Uploading media...");
              const result = await uploadPromotionVideoFiles({
                files: newVideoFiles,
                area: "promotion",
              });
              setUploadStatuses((c) => ({ ...c, videos: "done" }));
              return result;
            })()
          : Promise.resolve([] as string[]),
      ]);

      const allImages = [...existingImages, ...newImageUrls];
      // A one-video slot swaps the saved video for the new pick instead of adding to it.
      const allVideos =
        effectiveMaxVideos === 1 && newVideoUrls.length > 0
          ? newVideoUrls
          : [...existingVideos, ...newVideoUrls];
      const primaryMediaFile = newVideoFiles[0] ?? newPhotoFiles[0] ?? null;
      const mediaDimensions = primaryMediaFile ? await readMediaDimensions(primaryMediaFile) : null;

      // Upload a new video thumbnail if one was selected
      let uploadedVideoThumbnailUrl: string | undefined;
      if (newVideoThumbnailFile[0] && allVideos.length > 0) {
        const thumbData = new FormData();
        thumbData.append("area", "promotion");
        thumbData.append("files", newVideoThumbnailFile[0]);
        const thumbRes = await fetchWithRetry("/api/media/upload", {
          method: "POST",
          headers: withCsrfHeaders(),
          body: thumbData,
        });
        if (!thumbRes.ok) {
          throw new Error(await readUploadError(thumbRes, "Failed to upload video thumbnail"));
        }
        const thumbJson = await thumbRes.json();
        uploadedVideoThumbnailUrl = (thumbJson.urls as string[])?.[0];
      }

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

      setSubmitProgress("Saving Tourism & Events post...");
      setUploadStatuses((c) => ({ ...c, saving: "uploading" }));

      const socialEntries = Object.entries({
        facebook: socialFacebook,
        instagram: socialInstagram,
        twitter: socialTwitter,
        tiktok: socialTiktok,
      })
        .map(([key, value]) => [key, normalizeUserEnteredUrl(value)] as const)
        .filter(([, value]) => value.length > 0);
      const eventSocialLinks =
        socialEntries.length > 0 ? Object.fromEntries(socialEntries) : undefined;

      const body = {
        form_version: 2,
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
        logo_url: uploadedLogoUrl || existingLogoUrl || undefined,
        images: allImages,
        videos: allVideos,
        // No video left means no poster; a new pick replaces the saved one.
        video_thumbnail:
          allVideos.length === 0
            ? undefined
            : uploadedVideoThumbnailUrl || videoThumbnail || undefined,
        media_width: mediaDimensions?.width,
        media_height: mediaDimensions?.height,
        focal_x: focalPoint.x,
        focal_y: focalPoint.y,
        start_date: startDate ? eventTimeToIso(startDate) : undefined,
        end_date: endDate ? eventTimeToIso(endDate, true) : undefined,
        business_id: businessId || undefined,
        event_details: {
          event_type: eventType || undefined,
          venue_name: venueName || undefined,
          venue_capacity: venueCapacity ? parseInt(venueCapacity, 10) : undefined,
          ticket_tiers: ticketTiers.length > 0 ? ticketTiers : undefined,
          tickets_url: ticketsUrl ? normalizeUserEnteredUrl(ticketsUrl) : undefined,
          age_restriction: ageRestriction || undefined,
          dress_code: dressCode || undefined,
          lineup: lineup || undefined,
          parking_available: parkingAvailable || undefined,
          accessibility: accessibility.length > 0 ? accessibility : undefined,
          food_drinks_available: foodDrinksAvailable || undefined,
          bring_your_own: bringYourOwn || undefined,
          recurring: recurring || undefined,
          rain_policy: rainPolicy || undefined,
          early_bird_deadline: earlyBirdDeadline.trim() || undefined,
          group_discount_available: groupDiscountAvailable || undefined,
          website: website.trim() ? normalizeUserEnteredUrl(website) : undefined,
          map_directions: mapDirections.trim() ? normalizeUserEnteredUrl(mapDirections) : undefined,
          social_links: eventSocialLinks,
        },
      };

      const res = await fetch(`/api/promotions/${promotionId}`, {
        method: "PUT",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data?.code === "edit_limit_reached") {
          setError("This tourism and events post has already used its two approved edit chances.");
        } else if (data?.code === "pending_edit_exists") {
          setError(
            "Your latest changes were not submitted. An earlier edit is still awaiting admin review. Please wait for that review before submitting again."
          );
        } else {
          setError(data.error || "Failed to update tourism and events listing");
        }
        if (data?.details && typeof data.details === "object") {
          setFieldErrors(data.details as Record<string, string>);
        }
        return;
      }

      toast({
        title: data?.pendingReview
          ? "Edit submitted for review"
          : "Tourism & Events listing updated!",
        variant: "success",
      });
      setUploadStatuses((c) => ({ ...c, saving: "done" }));
      router.push(
        `/dashboard/listings?area=PROMOTIONS_EVENTS&updated=promotion${data?.pendingReview === true ? "&review=pending" : ""}`
      );
    } catch (error: unknown) {
      const uploadFailure = getPromotionMediaUploadErrorState(error);
      if (uploadFailure) {
        setFieldErrors(uploadFailure.fieldErrors);
        setError(uploadFailure.formError);
        return;
      }
      setError(normalizeCreatePostRuntimeError(error, "Something went wrong. Please try again."));
    } finally {
      submissionInFlightRef.current = false;
      setIsSubmitting(false);
      setSubmitProgress(null);
      setUploadStatuses({ logo: "idle", photos: "idle", videos: "idle", saving: "idle" });
    }
  }

  const totalImages = existingImages.length + newPhotoFiles.length;
  const totalVideos = existingVideos.length + newVideoFiles.length;
  const hasAnyMedia = totalImages > 0 || totalVideos > 0;
  // Preview must mirror the submitted media order: existing items first, then
  // newly selected files (allImages/allVideos in handleSubmit).
  const previewImages = [...existingImages, ...previewPhotoUrls];
  const previewVideos =
    effectiveMaxVideos === 1 && previewVideoUrls.length > 0
      ? previewVideoUrls
      : [...existingVideos, ...previewVideoUrls];
  const linkedBusiness = businessId
    ? (myBusinesses.find((item) => item.id === businessId) ?? null)
    : null;

  if (isLoading) {
    return (
      <div className="flex min-h-screen flex-col">
        <Header isAuthenticated />
        <main
          id="main-content"
          aria-busy="true"
          className="flex flex-1 flex-col items-center justify-center gap-3"
        >
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">Loading your post…</p>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header isAuthenticated />

      <main id="main-content" className="flex-1">
        <div className="container-page max-w-3xl space-y-5 py-6">
          <PageHeader
            title="Edit event"
            breadcrumbs={[
              { label: "Dashboard", href: "/dashboard" },
              { label: "Tourism & Events", href: "/dashboard/tourism-events" },
              { label: "Edit" },
            ]}
          />

          {error && (
            <div
              role="alert"
              className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
            >
              {error}
            </div>
          )}

          <div className="surface-card">
            <div className="space-y-5 p-4 sm:p-6">
              <div className="space-y-2">
                <Label htmlFor="title">Event name *</Label>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={120}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description *</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={6}
                  maxLength={5000}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="category_key">Directory category (optional)</Label>
                <PostSelect
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
                </PostSelect>
              </div>

              <div className="space-y-2">
                <Label htmlFor="category">Custom label (optional)</Label>
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
                  <PostSelect
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
                  </PostSelect>
                  <p className="text-xs text-muted-foreground">
                    Links this event to a business profile.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <fieldset className="space-y-1">
                  <legend className="text-sm font-medium">Entry (Required)</legend>
                  <p className="text-xs text-muted-foreground">
                    Free entry means visitors do not pay to attend. This is separate from posting
                    being free.
                  </p>
                  <label className="flex min-h-11 items-center gap-2">
                    <input
                      type="radio"
                      name="entry"
                      checked={priceZar === "0"}
                      onChange={() => {
                        setPriceZar("0");
                        setNegotiable(false);
                      }}
                    />
                    Free entry
                  </label>
                  <label className="flex min-h-11 items-center gap-2">
                    <input
                      type="radio"
                      name="entry"
                      checked={priceZar !== "0"}
                      onChange={() => {
                        setPriceZar("");
                        setNegotiable(false);
                      }}
                    />
                    Paid entry
                  </label>
                </fieldset>
                {priceZar !== "0" && (
                  <div className="space-y-2">
                    <Label htmlFor="price" required>
                      Starting entry price (ZAR)
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      The lowest ticket price. Add ticket tiers below if prices vary.
                    </p>
                    <Input
                      id="price"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      value={priceZar}
                      onChange={(e) => setPriceZar(e.target.value)}
                      aria-invalid={!!fieldErrors.price_zar}
                    />
                    {fieldErrors.price_zar && (
                      <p className="inline-form-error">{fieldErrors.price_zar}</p>
                    )}
                  </div>
                )}
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

              <OnlinePresenceFields
                values={{
                  website,
                  mapDirections,
                  socialFacebook,
                  socialInstagram,
                  socialTwitter,
                  socialTiktok,
                }}
                onChange={(field, value) => {
                  ({
                    website: setWebsite,
                    mapDirections: setMapDirections,
                    socialFacebook: setSocialFacebook,
                    socialInstagram: setSocialInstagram,
                    socialTwitter: setSocialTwitter,
                    socialTiktok: setSocialTiktok,
                  })[field](value);
                  const errorKey = field === "mapDirections" ? "map_directions" : field;
                  setFieldErrors((current) => {
                    const next = { ...current };
                    delete next[errorKey];
                    return next;
                  });
                }}
                errors={fieldErrors}
                description="Optional. Help people check your event online and find the venue on a map."
                mapPinHint="Open Google Maps, drop a pin on the venue, tap Share and paste the link here."
              />

              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">
                  How should people contact you? (Required)
                </legend>
                <p className="text-sm text-muted-foreground">
                  Choose at least one. Phone and WhatsApp use the number on your VerifyMzansi
                  account. Contact form enquiries go to your VerifyMzansi inbox.
                </p>
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
                {fieldErrors.contact_methods && (
                  <p className="inline-form-error">{fieldErrors.contact_methods}</p>
                )}
              </fieldset>

              <EventDateFields
                start={startDate}
                end={endDate}
                onStart={setStartDate}
                onEnd={setEndDate}
              />

              {/* ── Event Details ─────────────────────────── */}
              <div className="space-y-4 rounded-2xl border border-border bg-muted/30 p-4">
                <p className="text-sm font-medium">Event details</p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label htmlFor="eventType">Event category (Required)</Label>
                    <p className="text-xs text-muted-foreground">
                      Category that best describes your event.
                    </p>
                    <PostSelect
                      id="eventType"
                      className={selectClass}
                      aria-label="Event type"
                      value={eventType}
                      onChange={(e) => setEventType(e.target.value)}
                    >
                      <option value="">Select type…</option>
                      {EVENT_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </PostSelect>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="age_restriction">Age restriction</Label>
                    <p className="text-xs text-muted-foreground">
                      Minimum age for attendees, if any.
                    </p>
                    <PostSelect
                      id="age_restriction"
                      className={selectClass}
                      aria-label="Age restriction"
                      value={ageRestriction}
                      onChange={(e) => setAgeRestriction(e.target.value)}
                    >
                      <option value="">No restriction</option>
                      {EVENT_AGE_RESTRICTIONS.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </PostSelect>
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
                    onChange={(e) => {
                      setTicketsUrl(e.target.value);
                      setFieldErrors((current) => {
                        const next = { ...current };
                        delete next.tickets_url;
                        return next;
                      });
                    }}
                    maxLength={2000}
                    placeholder="https://…"
                    className={fieldErrors.tickets_url ? "border-destructive" : undefined}
                  />
                  {fieldErrors.tickets_url && (
                    <p className="inline-form-error">{fieldErrors.tickets_url}</p>
                  )}
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

                  <div className="flex flex-wrap gap-2">
                    {EVENT_ACCESSIBILITY_OPTIONS.map((opt) => {
                      const active = accessibility.includes(opt);
                      return (
                        <button
                          key={opt}
                          type="button"
                          aria-pressed={active}
                          className={
                            active
                              ? "inline-flex min-h-9 items-center rounded-full border border-teal-600 bg-teal-50 px-3 text-xs font-semibold text-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-teal-400 dark:bg-teal-950/40 dark:text-teal-200"
                              : "inline-flex min-h-9 items-center rounded-full border border-border bg-card px-3 text-xs font-medium text-foreground/80 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          }
                          onClick={() =>
                            setAccessibility((prev) =>
                              active ? prev.filter((a) => a !== opt) : [...prev, opt]
                            )
                          }
                        >
                          {opt}
                        </button>
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

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="recurring">Recurring</Label>
                    <PostSelect
                      id="recurring"
                      aria-label="Recurring"
                      className="w-full rounded-md border px-3 py-2 text-sm"
                      value={recurring}
                      onChange={(e) => setRecurring(e.target.value)}
                    >
                      <option value="">Select…</option>
                      <option value="one_off">One-off</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                      <option value="annual">Annual</option>
                    </PostSelect>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="rainPolicy">Rain Policy</Label>
                    <PostSelect
                      id="rainPolicy"
                      aria-label="Rain policy"
                      className="w-full rounded-md border px-3 py-2 text-sm"
                      value={rainPolicy}
                      onChange={(e) => setRainPolicy(e.target.value)}
                    >
                      <option value="">Select…</option>
                      <option value="outdoor_rain_or_shine">Outdoor — Rain or Shine</option>
                      <option value="moved_indoors">Moved Indoors</option>
                      <option value="postponed">Postponed</option>
                      <option value="refunded">Refunded</option>
                    </PostSelect>
                  </div>
                </div>

                {Number(priceZar) > 0 && (
                  <>
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
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={groupDiscountAvailable}
                        onChange={(e) => setGroupDiscountAvailable(e.target.checked)}
                        className="rounded"
                      />
                      Group discounts available
                    </label>
                  </>
                )}
              </div>

              <MediaUpload
                id="edit-event-photos-input"
                label="Photos"
                description="Your first photo is the cover on cards."
                maxFiles={maxPhotos}
                files={newPhotoFiles}
                existing={existingImages.map((url, i) => ({
                  url: normalizeMediaUrl(url),
                  label: `Photo ${i + 1}`,
                }))}
                onRemoveExisting={removeExistingImage}
                error={fieldErrors.images}
                onChange={setNewPhotoFiles}
                accept="image/*"
              />

              <MediaUpload
                id="edit-event-videos-input"
                label={`Videos (optional)${!videoAllowed ? " — Upgrade to unlock" : ""}`}
                maxFiles={effectiveMaxVideos}
                files={newVideoFiles}
                existing={existingVideos.map((url, i) => ({
                  url: normalizeMediaUrl(url),
                  isVideo: true,
                  label: `Video ${i + 1}`,
                }))}
                onRemoveExisting={(index) => {
                  if (!window.confirm("Remove this video?")) return;
                  setExistingVideos((prev) => prev.filter((_, i) => i !== index));
                }}
                onChange={setNewVideoFiles}
                accept="video/*"
                disabled={!videoAllowed}
                previewShape="wide"
              />

              {(existingVideos.length > 0 || newVideoFiles.length > 0) && (
                <MediaUpload
                  id="edit-event-video-thumbnail-input"
                  label="Video thumbnail (optional)"
                  description="Poster shown before the video plays."
                  maxFiles={1}
                  files={newVideoThumbnailFile}
                  existing={
                    videoThumbnail
                      ? [
                          {
                            url: normalizeMediaUrl(videoThumbnail),
                            label: "Current video thumbnail",
                          },
                        ]
                      : []
                  }
                  onRemoveExisting={() => setVideoThumbnail("")}
                  onChange={setNewVideoThumbnailFile}
                  accept="image/*"
                  recommendedAspect=""
                  previewShape="wide"
                />
              )}

              <MediaUpload
                id="edit-event-logo-input"
                label="Event logo (optional)"
                maxFiles={1}
                files={newLogoFile}
                existing={
                  existingLogoUrl
                    ? [{ url: normalizeMediaUrl(existingLogoUrl), label: "Current logo" }]
                    : []
                }
                onRemoveExisting={() => setExistingLogoUrl("")}
                onChange={setNewLogoFile}
                accept="image/*"
                recommendedAspect="Recommended: square image, at least 96 x 96."
              />

              <div className="rounded-xl border border-dashed border-brand-green/30 bg-brand-green/5 p-4">
                <div className="mb-3 text-sm font-medium text-muted-foreground">Event preview</div>
                <PromotionDetailContent
                  promotion={{
                    id: promotionId,
                    owner_id: "preview-seller",
                    business_id: businessId || null,
                    title: title || "Your event title",
                    description: description || "Your event description will appear here.",
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
                    start_date: startDate ? eventTimeToIso(startDate) : null,
                    end_date: endDate ? eventTimeToIso(endDate, true) : null,
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
                (!hasAnyMedia ||
                  title.length < 5 ||
                  description.length < 20 ||
                  !province ||
                  !city) && (
                  <p className="text-xs text-destructive text-right">
                    {!hasAnyMedia
                      ? "At least one photo or video is required."
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
                    label: "Preparing and verifying video...",
                    doneLabel: "Video verified",
                    status: newVideoFiles.length > 0 ? uploadStatuses.videos : "skipped",
                  },
                  {
                    key: "saving",
                    label: "Saving Tourism & Events post...",
                    doneLabel: "Tourism & Events post saved",
                    status: uploadStatuses.saving,
                  },
                ]}
              />
            </div>
          </div>

          <div className="sticky bottom-0 z-30 -mx-4 flex items-center gap-3 border-t border-border/70 bg-background/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur supports-[backdrop-filter]:bg-background/85 sm:bottom-4 sm:mx-0 sm:rounded-2xl sm:border sm:bg-card/95 sm:py-3 sm:elev-md">
            <Button variant="outline" asChild className="h-11 rounded-full px-5">
              <Link href="/dashboard/tourism-events">Cancel</Link>
            </Button>
            <p className="hidden flex-1 text-sm text-muted-foreground sm:block">
              Changes are checked before they go live.
            </p>
            <Button
              onClick={handleSubmit}
              disabled={
                isSubmitting ||
                !hasAnyMedia ||
                title.trim().length < 5 ||
                title.trim().length > 120 ||
                description.trim().length < 20 ||
                description.trim().length > 5000 ||
                !province ||
                !city
              }
              variant="trust-verified"
              aria-busy={isSubmitting}
              className="h-11 min-w-36 flex-1 gap-2 rounded-full px-6 font-semibold sm:flex-none"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  {submitProgress || "Saving..."}
                </>
              ) : (
                "Save changes"
              )}
            </Button>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
