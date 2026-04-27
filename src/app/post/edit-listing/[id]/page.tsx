"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { Loader2, X, Phone, MessageCircle, Mail, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { PageHeader } from "@/components/layout/page-header";
import { useToast } from "@/hooks/use-toast";
import { createClient } from "@/lib/supabase/client";
import { CategoryPicker } from "@/components/listings/category-picker";
import { MediaUpload } from "@/components/ui/media-upload";
import { UploadProgressPanel, type UploadSlotStatus } from "@/components/ui/upload-progress-panel";
import { FocalPointPicker, type FocalPoint } from "@/components/ui/focal-point-picker";
import {
  usePlanMaxPhotos,
  usePlanMaxVideos,
  usePlanVideoAllowed,
} from "@/components/billing/plan-gate";
import { LocationSelector } from "@/components/ui/location-selector";
import type { ListingCategory, ListingCondition, UploadArea } from "@/types/enums";
import { mapListingCategory } from "@/lib/utils/enum-compat";
import { normalizeMediaUrl, normalizeMediaUrls } from "@/lib/utils/media-url";
import { cn } from "@/lib/utils";
import { coerceListingAttributes, validateListingAttributes } from "@/lib/forms/listing-form";
import {
  normalizeCreatePostError,
  normalizeCreatePostRuntimeError,
} from "@/app/post/_lib/create-post-errors";
import {
  getListingMediaUploadErrorState,
  uploadListingVideoFiles,
} from "@/app/post/_lib/listing-media-upload";
import { LISTING_CONDITIONS } from "@/lib/constants/listing-condition";
import { ListingCard } from "@/components/listings/listing-card";
import { ListingDetailContent } from "@/components/listings/listing-detail-content";
import { createLogger } from "@/lib/utils/logger";
import { ensureCsrfTokenReady, withCsrfHeaders } from "@/lib/utils/csrf";
import { fetchWithRetry } from "@/lib/utils/fetch-retry";
import { readMediaDimensions } from "@/lib/utils/media-metadata";

const log = createLogger("EditListingPage");
const TITLE_MAX = 100;
const DESC_MAX = 5000;

export default function EditListingPage() {
  const params = useParams();
  const id = params.id as string;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState<ListingCategory | "">("");
  const [condition, setCondition] = useState<ListingCondition | "">("");
  const [categoryAttributes, setCategoryAttributes] = useState<
    Record<string, string | boolean | string[]>
  >({});
  const [province, setProvince] = useState("");
  const [city, setCity] = useState("");
  const [town, setTown] = useState("");
  const [locationAddress, setLocationAddress] = useState("");
  const [negotiable, setNegotiable] = useState(false);
  const [contactMethods, setContactMethods] = useState<string[]>(["call"]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitProgress, setSubmitProgress] = useState<string | null>(null);
  const [uploadStatuses, setUploadStatuses] = useState<Record<string, UploadSlotStatus>>({
    logo: "idle",
    photos: "idle",
    video: "idle",
    saving: "idle",
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [existingStatus, setExistingStatus] = useState<string | null>(null);
  const [existingLogo, setExistingLogo] = useState<string | null>(null);
  const [existingPhotos, setExistingPhotos] = useState<string[]>([]);
  const [existingVideos, setExistingVideos] = useState<string[]>([]);
  const [existingVideoThumbnail, setExistingVideoThumbnail] = useState<string | null>(null);
  const [listingUpdatedAt, setListingUpdatedAt] = useState<string | null>(null);
  const [newLogoFile, setNewLogoFile] = useState<File[]>([]);
  const [newPhotoFiles, setNewPhotoFiles] = useState<File[]>([]);
  const [newVideoFile, setNewVideoFile] = useState<File[]>([]);
  const [newVideoCoverFile, setNewVideoCoverFile] = useState<File[]>([]);
  const [focalPoint, setFocalPoint] = useState<FocalPoint>({ x: 0.5, y: 0.5 });
  const router = useRouter();
  const { toast } = useToast();
  const maxPhotos = usePlanMaxPhotos("MZANSI_MARKET");
  const maxVideos = usePlanMaxVideos("MZANSI_MARKET");
  const videoAllowed = usePlanVideoAllowed("MZANSI_MARKET");
  const previewLogoUrl = useMemo(
    () => (newLogoFile.length > 0 ? URL.createObjectURL(newLogoFile[0]) : null),
    [newLogoFile]
  );
  const previewPhotoUrls = useMemo(
    () => newPhotoFiles.map((file) => URL.createObjectURL(file)),
    [newPhotoFiles]
  );
  const previewVideoUrls = useMemo(
    () => newVideoFile.map((file) => URL.createObjectURL(file)),
    [newVideoFile]
  );
  const previewVideoCoverUrl = useMemo(
    () => (newVideoCoverFile.length > 0 ? URL.createObjectURL(newVideoCoverFile[0]) : null),
    [newVideoCoverFile]
  );

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

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          router.push("/login");
          return;
        }

        const { data, error } = await supabase
          .from("listings")
          .select("*")
          .eq("id", id)
          .maybeSingle();

        if (error) {
          log.error("Failed to load listing", {
            listingId: id,
            code: error.code,
            error: error.message,
          });

          if (!cancelled) {
            setLoadFailed(true);
            toast({
              title: "Unable to load listing",
              description: "Please reopen it from your dashboard.",
              variant: "destructive",
            });
            router.push("/dashboard/listings");
          }
          return;
        }

        if (!data) {
          if (!cancelled) {
            setLoadFailed(true);
            toast({ title: "Listing not found", variant: "destructive" });
            router.push("/dashboard/listings");
          }
          return;
        }

        // Defense-in-depth: verify current user is the listing owner
        const ownerId =
          (data as Record<string, unknown>).seller_id ?? (data as Record<string, unknown>).owner_id;
        if (ownerId !== user.id) {
          if (!cancelled) {
            setLoadFailed(true);
            toast({ title: "You are not the owner of this listing", variant: "destructive" });
            router.push("/dashboard/listings");
          }
          return;
        }

        if (cancelled) {
          return;
        }

        setTitle(data.title || "");
        setDescription(data.description || "");
        setPrice(data.price_cents ? (data.price_cents / 100).toString() : "");
        setExistingStatus((data.status as string | null) ?? null);
        setCategory((data.category as ListingCategory) || "");
        setCondition(
          ((data.condition as ListingCondition | null) ??
            ((data.attributes as Record<string, unknown> | null)?.condition as
              | ListingCondition
              | undefined) ??
            "") as ListingCondition | ""
        );
        setCategoryAttributes(
          (data.attributes as Record<string, string | boolean | string[]>) || {}
        );
        setProvince(data.location_province || "");
        setCity(data.location_city || "");
        setTown(
          ((data as Record<string, unknown>).location_town as string) ||
            ((data as Record<string, unknown>).location_suburb as string) ||
            ""
        );
        setLocationAddress(((data as Record<string, unknown>).location_address as string) || "");
        setNegotiable(data.price_negotiable ?? false);
        setContactMethods(
          Array.isArray(data.contact_methods) && data.contact_methods.length > 0
            ? (data.contact_methods as string[])
            : ["call"]
        );
        setExistingLogo(((data as Record<string, unknown>).logo_url as string | null) ?? null);
        setExistingVideoThumbnail(
          ((data as Record<string, unknown>).video_thumbnail as string | null) ?? null
        );
        setExistingPhotos(Array.isArray(data.photos) ? (data.photos as string[]) : []);
        setExistingVideos(Array.isArray(data.videos) ? (data.videos as string[]) : []);
        setFocalPoint({
          x:
            typeof (data as Record<string, unknown>).focal_x === "number"
              ? ((data as Record<string, unknown>).focal_x as number)
              : 0.5,
          y:
            typeof (data as Record<string, unknown>).focal_y === "number"
              ? ((data as Record<string, unknown>).focal_y as number)
              : 0.5,
        });
        setListingUpdatedAt(
          ((data as Record<string, unknown>).updated_at as string | null) ?? null
        );
      } catch (error) {
        log.error("Listing load threw unexpectedly", {
          listingId: id,
          error: error instanceof Error ? error.message : "Unknown error",
        });

        if (!cancelled) {
          setLoadFailed(true);
          toast({
            title: "Unable to load listing",
            description: "Please reopen it from your dashboard.",
            variant: "destructive",
          });
          router.push("/dashboard/listings");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }
    void load();

    return () => {
      cancelled = true;
    };
  }, [id, router, toast]);

  useEffect(() => {
    void ensureCsrfTokenReady();
  }, []);

  useEffect(
    () => () => {
      if (previewLogoUrl) URL.revokeObjectURL(previewLogoUrl);
    },
    [previewLogoUrl]
  );

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

  useEffect(
    () => () => {
      if (previewVideoCoverUrl) URL.revokeObjectURL(previewVideoCoverUrl);
    },
    [previewVideoCoverUrl]
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

  function handleCategoryChange(cat: ListingCategory) {
    setCategory(cat);
    setCategoryAttributes({});
    clearErrors("category");
    setFieldErrors((current) => {
      const next = { ...current };
      Object.keys(next)
        .filter((key) => key.startsWith("attributes."))
        .forEach((key) => delete next[key]);
      return next;
    });
  }

  const CONTACT_OPTIONS = [
    { id: "call", label: "Phone Call", icon: Phone },
    { id: "whatsapp", label: "WhatsApp", icon: MessageCircle },
    { id: "form", label: "Contact Form", icon: Mail },
  ] as const;

  function toggleContact(id: string) {
    setContactMethods((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]));
    clearErrors("contactMethods");
  }

  function handleAttributeChange(name: string, value: string | boolean | string[]) {
    setCategoryAttributes((prev) => ({ ...prev, [name]: value }));
    clearErrors(`attributes.${name}`);
  }

  const normalizedPreviewAttributes = category
    ? coerceListingAttributes(category, categoryAttributes)
    : {};
  const displayExistingPhotos = useMemo(() => normalizeMediaUrls(existingPhotos), [existingPhotos]);
  const displayExistingVideos = useMemo(() => normalizeMediaUrls(existingVideos), [existingVideos]);
  const previewPhotos = previewPhotoUrls.length > 0 ? previewPhotoUrls : existingPhotos;
  const previewVideos = previewVideoUrls.length > 0 ? previewVideoUrls : existingVideos;
  const previewVideoThumbnail = previewVideoCoverUrl ?? existingVideoThumbnail;
  const previewLogo = previewLogoUrl ?? existingLogo;

  async function uploadMedia(files: File[], area: UploadArea): Promise<string[]> {
    if (files.length === 0) return [];
    const uploadData = new FormData();
    uploadData.append("area", area);
    files.forEach((f) => uploadData.append("files", f));
    const uploadRes = await fetchWithRetry("/api/media/upload", {
      method: "POST",
      headers: withCsrfHeaders(),
      body: uploadData,
    });
    if (!uploadRes.ok) throw new Error(await readUploadError(uploadRes, "Upload failed"));
    const uploadJson = await uploadRes.json();
    return uploadJson.urls || [];
  }

  function validateForm() {
    const errors: Record<string, string> = {};

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

    if (!price || Number.isNaN(parseFloat(price)) || parseFloat(price) < 0) {
      errors.price_zar = "Enter a valid price.";
    }
    if (!province) errors.province = "Select a province.";
    if (!city) errors.city = "Select a city.";
    if (contactMethods.length === 0) {
      errors.contactMethods = "Choose at least one contact method.";
    }

    const totalPhotos = existingPhotos.length + newPhotoFiles.length;
    if (totalPhotos === 0) errors.images = "Upload at least one photo.";
    if (totalPhotos > maxPhotos) {
      errors.images = `You can upload up to ${maxPhotos} photos on this plan.`;
    }

    const totalVideos = existingVideos.length + newVideoFile.length;
    if (totalVideos > 0 && !videoAllowed) {
      errors.videos = "Video upload is not available on your current plan.";
    }
    if (totalVideos > maxVideos) {
      errors.videos = `You can upload up to ${maxVideos} videos on this plan.`;
    }

    return errors;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errors = validateForm();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setFormError("Please fix the highlighted fields.");
      return;
    }

    clearErrors();
    setIsSubmitting(true);
    setSubmitProgress("Uploading media...");
    setUploadStatuses({
      logo: newLogoFile.length > 0 ? "uploading" : "skipped",
      photos: newPhotoFiles.length > 0 ? "uploading" : "skipped",
      video: newVideoFile.length > 0 ? "uploading" : "skipped",
      saving: "idle",
    });
    try {
      const csrfToken = await ensureCsrfTokenReady();
      if (!csrfToken) {
        setFormError("Security check failed. Please refresh the page and try again.");
        return;
      }

      const numPrice = parseFloat(price);
      const normalizedAttributes = category
        ? coerceListingAttributes(category, categoryAttributes)
        : {};

      // Upload photos, video, and video cover in parallel
      const [newLogoUrls, newPhotoUrls, newVideoUrl, newCoverUrls] = await Promise.all([
        uploadMedia(newLogoFile, "listing_logo").then((urls) => {
          if (newLogoFile.length > 0) setUploadStatuses((c) => ({ ...c, logo: "done" }));
          return urls;
        }),
        uploadMedia(newPhotoFiles, "listing").then((urls) => {
          if (newPhotoFiles.length > 0) setUploadStatuses((c) => ({ ...c, photos: "done" }));
          return urls;
        }),
        newVideoFile.length > 0
          ? (async () => {
              setSubmitProgress("Uploading media...");
              const urls = await uploadListingVideoFiles({
                files: newVideoFile,
                area: "listing_video",
              });
              const publicUrl = urls[0] ?? null;
              if (!publicUrl) {
                throw new Error("Failed to upload video");
              }
              setUploadStatuses((c) => ({ ...c, video: "done" }));
              return publicUrl;
            })()
          : Promise.resolve(null as string | null),
        uploadMedia(newVideoCoverFile, "listing"),
      ]);

      // Resolve video thumbnail: new upload > existing > null
      let videoThumbnail: string | null = existingVideoThumbnail;
      if (newCoverUrls.length > 0) {
        videoThumbnail = newCoverUrls[0];
      }
      const finalLogoUrl = newLogoUrls[0] || existingLogo || null;

      const allPhotos = [...existingPhotos, ...newPhotoUrls];
      const allVideos = [...existingVideos, ...(newVideoUrl ? [newVideoUrl] : [])];
      const primaryMediaFile = newVideoFile[0] ?? newPhotoFiles[0] ?? null;
      const mediaDimensions = primaryMediaFile ? await readMediaDimensions(primaryMediaFile) : null;

      setSubmitProgress("Saving listing...");
      setUploadStatuses((c) => ({ ...c, saving: "uploading" }));

      // Submit via server-side API route for full validation & ownership check
      const res = await fetch(`/api/listings/${id}`, {
        method: "PUT",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          price_zar: numPrice,
          negotiable,
          category: mapListingCategory(category),
          condition: condition || undefined,
          attributes: normalizedAttributes,
          province: province || "",
          city: city || "",
          town: town || "",
          address: locationAddress || "",
          images: allPhotos,
          videos: allVideos,
          videoThumbnail,
          logo_url: finalLogoUrl,
          contactMethods,
          media_width: mediaDimensions?.width,
          media_height: mediaDimensions?.height,
          focal_x: focalPoint.x,
          focal_y: focalPoint.y,
          expected_updated_at: listingUpdatedAt,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 409) {
          if (data?.code === "edit_limit_reached") {
            setFormError("This listing has already used its two approved edit chances.");
            return;
          }
          if (data?.code === "pending_edit_exists") {
            setFormError("This listing already has an edit pending admin review.");
            return;
          }
          setFormError(
            "This listing was modified in another tab or session. Please reload the page and try again."
          );
          return;
        }
        const normalized = normalizeCreatePostError(data, "Something went wrong");
        setFieldErrors(normalized.fieldErrors);
        setFormError(normalized.formError);
        return;
      }

      toast({
        title: existingStatus === "live" ? "Edit submitted for review" : "Listing updated!",
        variant: "success",
      });
      setUploadStatuses((c) => ({ ...c, saving: "done" }));
      router.push("/dashboard/listings");
    } catch (error: unknown) {
      const uploadFailure = getListingMediaUploadErrorState(error);
      if (uploadFailure) {
        setFieldErrors(uploadFailure.fieldErrors);
        setFormError(uploadFailure.formError);
        return;
      }
      setFormError(normalizeCreatePostRuntimeError(error, "Something went wrong."));
    } finally {
      setIsSubmitting(false);
      setSubmitProgress(null);
      setUploadStatuses({ logo: "idle", photos: "idle", video: "idle", saving: "idle" });
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen flex-col">
        <Header isAuthenticated />
        <main className="flex-1 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </main>
      </div>
    );
  }

  if (loadFailed) {
    return (
      <div className="flex min-h-screen flex-col">
        <Header isAuthenticated />
        <main className="flex flex-1 items-center justify-center px-4">
          <Card className="w-full max-w-md">
            <CardContent className="space-y-3 p-6 text-center">
              <h1 className="text-lg font-semibold">Unable to load listing</h1>
              <p className="text-sm text-muted-foreground">
                We could not load this listing safely. Please reopen it from your dashboard.
              </p>
              <Button onClick={() => router.push("/dashboard/listings")}>Back to listings</Button>
            </CardContent>
          </Card>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header isAuthenticated />

      <main className="flex-1">
        <div className="container-page py-6">
          <div className="max-w-2xl mx-auto space-y-4">
            <PageHeader
              title="Edit Listing"
              breadcrumbs={[
                { label: "Dashboard", href: "/dashboard" },
                { label: "My Listings", href: "/dashboard/listings" },
                { label: "Edit" },
              ]}
            />

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Badge className="bg-brand-green text-white">Mzansi Market</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form noValidate onSubmit={handleSubmit} className="space-y-5">
                  {formError && (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                      {formError}
                    </div>
                  )}

                  {/* ── Category Picker ────────────────────────── */}
                  <CategoryPicker
                    value={category}
                    onChange={handleCategoryChange}
                    attributes={categoryAttributes}
                    onAttributeChange={handleAttributeChange}
                    errors={fieldErrors}
                  />
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
                      onChange={(e) => setCondition(e.target.value as ListingCondition | "")}
                    >
                      <option value="">Condition not specified</option>
                      {LISTING_CONDITIONS.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* ── Title ──────────────────────────────────── */}
                  <div className="space-y-2">
                    <Label htmlFor="title">Title *</Label>
                    <Input
                      id="title"
                      value={title}
                      onChange={(e) => {
                        setTitle(e.target.value.slice(0, TITLE_MAX));
                        clearErrors("title");
                      }}
                      required
                      maxLength={TITLE_MAX}
                      aria-invalid={!!fieldErrors.title}
                      className={cn(fieldErrors.title && "border-destructive")}
                    />
                    {fieldErrors.title && <p className="inline-form-error">{fieldErrors.title}</p>}
                  </div>

                  {/* ── Description ────────────────────────────── */}
                  <div className="space-y-2">
                    <Label htmlFor="description">Description *</Label>
                    <Textarea
                      id="description"
                      placeholder="Describe your listing..."
                      value={description}
                      onChange={(e) => {
                        setDescription(e.target.value.slice(0, DESC_MAX));
                        clearErrors("description");
                      }}
                      required
                      className={cn(
                        "min-h-[100px]",
                        fieldErrors.description && "border-destructive"
                      )}
                      aria-invalid={!!fieldErrors.description}
                    />
                    {fieldErrors.description && (
                      <p className="inline-form-error">{fieldErrors.description}</p>
                    )}
                  </div>

                  {/* ── Price ──────────────────────────────────── */}
                  <div className="space-y-2">
                    <Label htmlFor="price">Price (ZAR) *</Label>
                    <div className="flex flex-col xs:flex-row gap-3">
                      <Input
                        id="price"
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        value={price}
                        onChange={(e) => {
                          setPrice(e.target.value);
                          clearErrors("price_zar");
                        }}
                        required
                        className={cn("flex-1", fieldErrors.price_zar && "border-destructive")}
                        aria-invalid={!!fieldErrors.price_zar}
                      />
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
                    {fieldErrors.price_zar && (
                      <p className="inline-form-error">{fieldErrors.price_zar}</p>
                    )}
                  </div>

                  {/* ── Location: Province / City / Town / Address ───────── */}
                  <LocationSelector
                    value={{
                      province,
                      city,
                      town,
                      address: locationAddress,
                    }}
                    onChange={(newLocation) => {
                      setProvince(newLocation.province);
                      setCity(newLocation.city);
                      setTown(newLocation.town || "");
                      setLocationAddress(newLocation.address || "");
                      clearErrors("province", "city");
                    }}
                    showTown={true}
                    showAddress={true}
                    errors={fieldErrors}
                  />

                  <div className="space-y-2">
                    <Label>Listing Logo</Label>
                    {previewLogo ? (
                      <div className="flex items-start gap-3">
                        <div className="relative h-20 w-20 overflow-hidden rounded-2xl border bg-muted">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={normalizeMediaUrl(previewLogo)}
                            alt="Listing logo"
                            className="h-full w-full object-contain"
                          />
                        </div>
                        <div className="flex flex-col gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-11"
                            onClick={() => {
                              if (!window.confirm("Remove the logo?")) return;
                              setExistingLogo(null);
                              setNewLogoFile([]);
                            }}
                          >
                            Remove logo
                          </Button>
                          <p className="text-xs text-muted-foreground">
                            This logo is shown on listing cards across the marketplace.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">No listing logo uploaded.</p>
                    )}
                  </div>

                  <MediaUpload
                    label="Replace listing logo (optional)"
                    maxFiles={1}
                    files={newLogoFile}
                    onChange={setNewLogoFile}
                    accept="image/*"
                  />

                  {/* ── Existing Images ──────────────────────── */}
                  {existingPhotos.length > 0 && (
                    <div className="space-y-2">
                      <Label>Current Photos</Label>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {existingPhotos.map((url, i) => (
                          <div
                            key={url}
                            className="relative group rounded-md overflow-hidden border"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={displayExistingPhotos[i] || normalizeMediaUrl(url)}
                              alt={`Photo ${i + 1}`}
                              className="aspect-square w-full bg-muted object-contain"
                            />
                            <button
                              type="button"
                              title="Remove photo"
                              onClick={() => {
                                if (!window.confirm("Remove this photo?")) return;
                                setExistingPhotos((prev) => prev.filter((_, idx) => idx !== i));
                                clearErrors("images");
                              }}
                              className="absolute right-1 top-1 inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 max-lg:opacity-100"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ── New Photo Upload ──────────────────────── */}
                  <MediaUpload
                    label={`Add Photos (max ${Math.max(0, maxPhotos - existingPhotos.length)} more)`}
                    maxFiles={Math.max(0, maxPhotos - existingPhotos.length)}
                    files={newPhotoFiles}
                    onChange={(files) => {
                      setNewPhotoFiles(files);
                      clearErrors("images");
                    }}
                    accept="image/*"
                    disabled={existingPhotos.length >= maxPhotos}
                  />
                  {fieldErrors.images && <p className="inline-form-error">{fieldErrors.images}</p>}

                  {/* ── Focal Point Picker ────────────────────── */}
                  {existingPhotos.length > 0 && (
                    <FocalPointPicker
                      src={normalizeMediaUrl(existingPhotos[0])}
                      alt="Set focal point for primary photo"
                      value={focalPoint}
                      onChange={setFocalPoint}
                    />
                  )}

                  {/* ── Existing Videos ──────────────────────── */}
                  {existingVideos.length > 0 && (
                    <div className="space-y-2">
                      <Label>Current Video</Label>
                      <div className="flex gap-2">
                        {existingVideos.map((url, i) => (
                          <div
                            key={url}
                            className="relative group rounded-md overflow-hidden border w-48"
                          >
                            <video
                              src={displayExistingVideos[i] || normalizeMediaUrl(url)}
                              className="aspect-video w-full bg-black object-contain"
                            />
                            <button
                              type="button"
                              title="Remove video"
                              onClick={() => {
                                if (!window.confirm("Remove this video?")) return;
                                setExistingVideos((prev) => prev.filter((_, idx) => idx !== i));
                                clearErrors("videos");
                              }}
                              className="absolute right-1 top-1 inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 max-lg:opacity-100"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ── New Video Upload ──────────────────────── */}
                  {existingVideos.length === 0 && (
                    <MediaUpload
                      label={`Add Video (max ${maxVideos})${!videoAllowed ? " — Upgrade to unlock" : ""}`}
                      maxFiles={Math.max(0, maxVideos - existingVideos.length)}
                      files={newVideoFile}
                      onChange={(files) => {
                        setNewVideoFile(files);
                        if (files.length === 0) {
                          setNewVideoCoverFile([]);
                        }
                        clearErrors("videos");
                      }}
                      accept="video/*"
                      disabled={!videoAllowed || existingVideos.length >= maxVideos}
                    />
                  )}
                  {fieldErrors.videos && <p className="inline-form-error">{fieldErrors.videos}</p>}

                  {/* ── Video Cover Image ────────────────────── */}
                  {(existingVideos.length > 0 || newVideoFile.length > 0) && (
                    <MediaUpload
                      label="Video Cover Image (1 max) — Shown before video plays"
                      maxFiles={1}
                      files={newVideoCoverFile}
                      onChange={setNewVideoCoverFile}
                      accept="image/*"
                    />
                  )}

                  {/* ── Contact Methods ──────────────────────── */}
                  <div className="space-y-3">
                    <Label className="text-base font-semibold">Contact Methods *</Label>
                    <p className="text-xs text-muted-foreground">How can buyers reach you?</p>
                    <div
                      role="group"
                      aria-label="Contact methods"
                      className="grid grid-cols-1 xs:grid-cols-3 gap-2"
                    >
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
                    {fieldErrors.contactMethods && (
                      <p className="inline-form-error">{fieldErrors.contactMethods}</p>
                    )}
                  </div>

                  <div className="space-y-3 rounded-xl border border-dashed border-brand-green/30 bg-brand-green/5 p-4">
                    <div className="text-sm font-medium text-muted-foreground">Listing preview</div>
                    <div className="max-w-[264px]">
                      <ListingCard
                        id={id}
                        title={title || "Your listing title"}
                        price={price ? Math.round(parseFloat(price || "0") * 100) : 0}
                        imageUrl={previewVideos[0] || previewPhotos[0]}
                        posterUrl={previewVideoThumbnail || previewPhotos[0] || undefined}
                        isVideo={previewVideos.length > 0}
                        fitStrategy="contain"
                        logoUrl={previewLogo}
                        province={province || "Province"}
                        city={city || "City"}
                        category={category || "property"}
                        attributes={normalizedPreviewAttributes}
                        condition={condition || undefined}
                        createdAt={new Date().toISOString()}
                      />
                    </div>
                    <ListingDetailContent
                      listing={{
                        id,
                        owner_id: "preview-seller",
                        title: title || "Your listing title",
                        description: description || "Your listing description will appear here.",
                        price_cents: price ? Math.round(parseFloat(price || "0") * 100) : 0,
                        price_negotiable: negotiable,
                        category: category || null,
                        condition: condition || null,
                        attributes: normalizedPreviewAttributes,
                        photos: previewPhotos,
                        videos: previewVideos,
                        video_thumbnail: previewVideoThumbnail,
                        logo_url: previewLogo,
                        location_province: province || null,
                        location_city: city || null,
                        location_suburb: town || null,
                        location_address: locationAddress || null,
                        contact_methods: contactMethods,
                        created_at: new Date().toISOString(),
                      }}
                      seller={{
                        display_name: "You",
                        location_province: province || null,
                        location_city: city || null,
                        account_verification_status: null,
                        phone: null,
                        masked_phone_public: null,
                      }}
                      similarItems={[]}
                      similarSellers={new Map()}
                      showContactActions={false}
                      showSimilarListings={false}
                      photoCount={previewPhotos.length}
                      layoutMode="review"
                    />
                  </div>

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
                        key: "video",
                        label: "Uploading video...",
                        doneLabel: "Video uploaded",
                        status: newVideoFile.length > 0 ? uploadStatuses.video : "skipped",
                      },
                      {
                        key: "saving",
                        label: "Saving listing...",
                        doneLabel: "Listing saved",
                        status: uploadStatuses.saving,
                      },
                    ]}
                  />

                  <div className="flex gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => router.back()}
                      className="h-11 flex-1"
                    >
                      Cancel
                    </Button>
                    <Button type="submit" className="h-11 flex-1" disabled={isSubmitting}>
                      {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      {isSubmitting ? submitProgress || "Saving..." : "Save Changes"}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
