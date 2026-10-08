"use client";
import { PostSelect } from "@/components/post/post-select";

import { settleMediaUploads } from "@/app/post/_lib/settle-media-uploads";

import { useEffect, useMemo, useState, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { Loader2, X, Phone, MessageCircle, Inbox, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PostLabel as Label } from "@/components/post/post-label";
import { Textarea } from "@/components/ui/textarea";
import { PostEditActionBar, PostFormSection } from "@/components/post/post-form-scaffold";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { PageHeader } from "@/components/layout/page-header";
import { useToast } from "@/hooks/use-toast";
import { createClient } from "@/lib/supabase/client";
import { loadOwnListing } from "./load-own-listing";
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
import type { ListingCategory, ListingCondition } from "@/types/enums";
import { mapListingCategory } from "@/lib/utils/enum-compat";
import { normalizeMediaUrl, normalizeMediaUrls } from "@/lib/utils/media-url";
import { cn } from "@/lib/utils";
import {
  DEFAULT_LISTING_CONTACT_METHODS,
  coerceListingAttributes,
  validateListingAttributes,
  withListingEnquiry,
} from "@/lib/forms/listing-form";
import {
  normalizeCreatePostError,
  normalizeCreatePostRuntimeError,
} from "@/app/post/_lib/create-post-errors";
import {
  getListingMediaUploadErrorState,
  uploadListingImages,
  uploadListingVideoFiles,
} from "@/app/post/_lib/listing-media-upload";
import { LISTING_CONDITIONS } from "@/lib/constants/listing-condition";
import { ListingCard } from "@/components/listings/listing-card";
import { ListingDetailContent } from "@/components/listings/listing-detail-content";
import { createLogger } from "@/lib/utils/logger";
import { ensureCsrfTokenReady, withCsrfHeaders } from "@/lib/utils/csrf";
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
  const [contactMethods, setContactMethods] = useState<string[]>(DEFAULT_LISTING_CONTACT_METHODS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submissionInFlightRef = useRef(false);
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

        const { data, error } = await loadOwnListing(id);

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
        setCategory((data.category as ListingCategory) || "");
        setCondition(
          ((data.condition as ListingCondition | null) ??
            ((data.attributes as Record<string, unknown> | null)?.condition as
              ListingCondition | undefined) ??
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
            ? withListingEnquiry(data.contact_methods as string[])
            : DEFAULT_LISTING_CONTACT_METHODS
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

  // Answers for each category are kept while the owner compares categories, so
  // switching back restores them. Only the selected category's answers are saved.
  const categoryAnswers = useRef<Record<string, typeof categoryAttributes>>({});

  function handleCategoryChange(cat: ListingCategory) {
    if (category) categoryAnswers.current[category] = categoryAttributes;
    setCategory(cat);
    setCategoryAttributes(categoryAnswers.current[cat] ?? {});
    clearErrors("category");
    setFieldErrors((current) => {
      const next = { ...current };
      Object.keys(next)
        .filter((key) => key.startsWith("attributes."))
        .forEach((key) => delete next[key]);
      return next;
    });
  }

  /** Private enquiry is always on (see withListingEnquiry); its tile is shown locked. */
  const CONTACT_OPTIONS = [
    { id: "call", label: "Phone call", icon: Phone },
    { id: "whatsapp", label: "WhatsApp", icon: MessageCircle },
    { id: "in_app", label: "Private enquiry", icon: Inbox },
  ] as const;

  function toggleContact(id: string) {
    if (id === "in_app") return;
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

    if (
      (category !== "jobs_services" || price) &&
      (!price || Number.isNaN(parseFloat(price)) || parseFloat(price) < 0)
    ) {
      errors.price_zar = "Enter a valid price.";
    }
    if (!province) errors.province = "Select a province.";
    if (!city) errors.city = "Select a city.";
    if (contactMethods.length === 0) {
      errors.contactMethods = "Choose at least one contact method.";
    }

    const totalPhotos = existingPhotos.length + newPhotoFiles.length;
    if (category !== "jobs_services" && totalPhotos === 0)
      errors.images = "Upload at least one photo.";
    if (totalPhotos > maxPhotos) {
      errors.images = `You can upload up to ${maxPhotos} photos on this plan.`;
    }

    const totalVideos =
      Math.max(maxVideos, existingVideos.length) === 1 && newVideoFile.length > 0
        ? newVideoFile.length
        : existingVideos.length + newVideoFile.length;
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
    if (submissionInFlightRef.current) return;
    const errors = validateForm();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setFormError("Please fix the highlighted fields.");
      return;
    }

    clearErrors();
    submissionInFlightRef.current = true;
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

      const numPrice = price ? parseFloat(price) : 0;
      const normalizedAttributes = category
        ? coerceListingAttributes(category, categoryAttributes)
        : {};

      // Upload photos, video, and video cover in parallel
      const [newLogoUrls, newPhotoUrls, newVideoUrl, newCoverUrls] = await settleMediaUploads([
        uploadListingImages({ files: newLogoFile, area: "listing_logo", field: "logo_url" }).then(
          (urls) => {
            if (newLogoFile.length > 0) setUploadStatuses((c) => ({ ...c, logo: "done" }));
            return urls;
          }
        ),
        uploadListingImages({ files: newPhotoFiles, area: "listing", field: "images" }).then(
          (urls) => {
            if (newPhotoFiles.length > 0) setUploadStatuses((c) => ({ ...c, photos: "done" }));
            return urls;
          }
        ),
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
        uploadListingImages({ files: newVideoCoverFile, area: "listing", field: "videoThumbnail" }),
      ]);

      // Resolve video thumbnail: new upload > existing > null
      let videoThumbnail: string | null = existingVideoThumbnail;
      if (newCoverUrls.length > 0) {
        videoThumbnail = newCoverUrls[0];
      }
      const finalLogoUrl = newLogoUrls[0] || existingLogo || null;

      const allPhotos = [...existingPhotos, ...newPhotoUrls];
      // A one-video slot swaps the saved video for the new pick instead of adding to it.
      const allVideos = newVideoUrl
        ? Math.max(maxVideos, existingVideos.length) === 1
          ? [newVideoUrl]
          : [...existingVideos, newVideoUrl]
        : existingVideos;
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
          condition:
            category === "jobs_services" || category === "auto_parts"
              ? undefined
              : condition || undefined,
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

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409) {
          if (data?.code === "edit_limit_reached") {
            setFormError("This listing has already used its two approved edit chances.");
            return;
          }
          if (data?.code === "pending_edit_exists") {
            setFormError(
              "Your latest changes were not submitted. An earlier edit is still awaiting admin review. Please wait for that review before submitting again."
            );
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
        title: data?.pendingReview === true ? "Edit submitted for review" : "Listing updated!",
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
      submissionInFlightRef.current = false;
      setIsSubmitting(false);
      setSubmitProgress(null);
      setUploadStatuses({ logo: "idle", photos: "idle", video: "idle", saving: "idle" });
    }
  }

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
          <p className="text-sm text-muted-foreground">Loading your listing…</p>
        </main>
      </div>
    );
  }

  if (loadFailed) {
    return (
      <div className="flex min-h-screen flex-col">
        <Header isAuthenticated />
        <main id="main-content" className="flex flex-1 items-center justify-center px-4">
          <div className="surface-card w-full max-w-md space-y-4 p-6 text-center">
            <span className="empty-state-icon">
              <X className="h-6 w-6" aria-hidden="true" />
            </span>
            <h1 className="font-display text-xl font-bold">Unable to load listing</h1>
            <p className="text-sm text-muted-foreground">Please reopen it from your dashboard.</p>
            <Button
              variant="trust-verified"
              className="h-11 rounded-full px-6"
              onClick={() => router.push("/dashboard/listings")}
            >
              Back to listings
            </Button>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header isAuthenticated />

      <main id="main-content" className="flex-1">
        <div className="container-page py-6">
          <div className="mx-auto max-w-3xl space-y-5">
            <PageHeader
              title="Edit listing"
              breadcrumbs={[
                { label: "Dashboard", href: "/dashboard" },
                { label: "My Listings", href: "/dashboard/listings" },
                { label: "Edit" },
              ]}
            />

            <form noValidate onSubmit={handleSubmit} className="space-y-4">
              <div className="surface-card space-y-6 p-4 sm:p-6">
                <span className="inline-flex items-center rounded-full border border-brand-green-200 bg-brand-green-50 px-2.5 py-0.5 text-xs font-semibold text-brand-green-800 dark:border-brand-green-800 dark:bg-brand-green-950/60 dark:text-brand-green-200">
                  Mzansi Market
                </span>
                {formError && (
                  <div
                    role="alert"
                    className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
                  >
                    {formError}
                  </div>
                )}

                <PostFormSection title="Details">
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

                  {category !== "jobs_services" && category !== "auto_parts" && (
                    <div className="space-y-2">
                      <Label htmlFor="condition">Condition</Label>
                      <PostSelect
                        id="condition"
                        aria-label="Condition"
                        className="flex h-11 w-full rounded-xl border border-input bg-card px-3.5 py-2 text-base shadow-xs transition-colors hover:border-foreground/30 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 sm:h-10 sm:text-sm"
                        value={condition}
                        onChange={(e) => setCondition(e.target.value as ListingCondition | "")}
                      >
                        <option value="">Condition not specified</option>
                        {LISTING_CONDITIONS.map((item) => (
                          <option key={item.value} value={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </PostSelect>
                    </div>
                  )}

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
                </PostFormSection>

                <PostFormSection
                  title={category === "jobs_services" ? "Salary and area" : "Price and area"}
                >
                  {/* ── Price ──────────────────────────────────── */}
                  <div className="space-y-2">
                    <Label htmlFor="price" required={category !== "jobs_services"}>
                      {category === "property" && categoryAttributes.listing_intent === "rent"
                        ? "Monthly Rent (ZAR) *"
                        : category === "jobs_services"
                          ? "Salary (ZAR) (Optional)"
                          : "Asking price (ZAR) *"}
                    </Label>
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
                        required={category !== "jobs_services"}
                        className={cn("flex-1", fieldErrors.price_zar && "border-destructive")}
                        aria-invalid={!!fieldErrors.price_zar}
                      />
                      {category !== "jobs_services" && (
                        <button
                          type="button"
                          aria-pressed={negotiable}
                          onClick={() => setNegotiable((v) => !v)}
                          className={cn(
                            "flex min-h-11 items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                            negotiable
                              ? "border-brand-green-600 bg-brand-green-50 text-brand-green-800 dark:border-brand-green-400 dark:bg-brand-green-950/50 dark:text-brand-green-200"
                              : "border-input bg-card text-foreground/80 hover:border-foreground/30"
                          )}
                        >
                          {negotiable && <Check className="h-4 w-4" aria-hidden="true" />}
                          Negotiable
                        </button>
                      )}
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
                </PostFormSection>

                <PostFormSection title="Photos and video">
                  <MediaUpload
                    id="edit-listing-photos-input"
                    label="Photos"
                    description="Your first photo is the cover on cards."
                    maxFiles={maxPhotos}
                    files={newPhotoFiles}
                    existing={existingPhotos.map((url, i) => ({
                      url: displayExistingPhotos[i] || normalizeMediaUrl(url),
                      label: `Photo ${i + 1}`,
                    }))}
                    onRemoveExisting={(index) => {
                      if (!window.confirm("Remove this photo?")) return;
                      setExistingPhotos((prev) => prev.filter((_, i) => i !== index));
                      clearErrors("images");
                    }}
                    error={fieldErrors.images}
                    onChange={(files) => {
                      setNewPhotoFiles(files);
                      clearErrors("images");
                    }}
                    accept="image/*"
                  />

                  {/* ── Focal Point Picker ────────────────────── */}
                  {existingPhotos.length > 0 && (
                    <FocalPointPicker
                      src={normalizeMediaUrl(existingPhotos[0])}
                      alt="Set focal point for primary photo"
                      value={focalPoint}
                      onChange={setFocalPoint}
                    />
                  )}

                  <MediaUpload
                    id="edit-listing-video-input"
                    label={`Video (max ${maxVideos})${!videoAllowed ? " — Upgrade to unlock" : ""}`}
                    maxFiles={Math.max(maxVideos, existingVideos.length)}
                    files={newVideoFile}
                    existing={existingVideos.map((url, i) => ({
                      url: displayExistingVideos[i] || normalizeMediaUrl(url),
                      isVideo: true,
                      label: `Video ${i + 1}`,
                    }))}
                    onRemoveExisting={(index) => {
                      if (!window.confirm("Remove this video?")) return;
                      setExistingVideos((prev) => prev.filter((_, i) => i !== index));
                      clearErrors("videos");
                    }}
                    error={fieldErrors.videos}
                    onChange={(files) => {
                      setNewVideoFile(files);
                      if (files.length === 0) {
                        setNewVideoCoverFile([]);
                      }
                      clearErrors("videos");
                    }}
                    accept="video/*"
                    disabled={!videoAllowed}
                    previewShape="wide"
                  />

                  <MediaUpload
                    id="edit-listing-logo-input"
                    label="Listing logo (optional)"
                    description="Shown on listing cards."
                    maxFiles={1}
                    files={newLogoFile}
                    existing={
                      existingLogo
                        ? [{ url: normalizeMediaUrl(existingLogo), label: "Current logo" }]
                        : []
                    }
                    onRemoveExisting={() => {
                      if (!window.confirm("Remove the logo?")) return;
                      setExistingLogo(null);
                    }}
                    error={fieldErrors.logo_url}
                    onChange={(files) => {
                      setNewLogoFile(files);
                      clearErrors("logo_url");
                    }}
                    accept="image/*"
                    recommendedAspect="Recommended: square image, at least 96 x 96."
                  />

                  {/* ── Video Cover Image ────────────────────── */}
                  {(existingVideos.length > 0 || newVideoFile.length > 0) && (
                    <MediaUpload
                      label="Video Cover Image (1 max) — Shown before video plays"
                      maxFiles={1}
                      files={newVideoCoverFile}
                      error={fieldErrors.videoThumbnail}
                      onChange={(files) => {
                        setNewVideoCoverFile(files);
                        clearErrors("videoThumbnail");
                      }}
                      accept="image/*"
                    />
                  )}
                </PostFormSection>

                {/* ── Contact Methods ──────────────────────── */}
                <PostFormSection title="How buyers reach you *">
                  <div role="group" aria-label="Contact methods" className="grid grid-cols-3 gap-2">
                    {CONTACT_OPTIONS.map((opt) => {
                      const Icon = opt.icon;
                      const isSelected = contactMethods.includes(opt.id);
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          aria-pressed={isSelected}
                          disabled={opt.id === "in_app"}
                          onClick={() => toggleContact(opt.id)}
                          className={cn(
                            "flex min-h-[4.5rem] flex-col items-center justify-center gap-1.5 rounded-2xl border p-3 text-center text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                            isSelected
                              ? "border-brand-green-600 bg-brand-green-50 text-brand-green-800 ring-1 ring-brand-green-600 dark:border-brand-green-400 dark:bg-brand-green-950/50 dark:text-brand-green-200 dark:ring-brand-green-400"
                              : "border-border bg-card text-foreground/80 hover:border-foreground/25 hover:bg-muted/50"
                          )}
                        >
                          <Icon className="h-5 w-5" aria-hidden="true" />
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                  {fieldErrors.contactMethods && (
                    <p className="inline-form-error">{fieldErrors.contactMethods}</p>
                  )}
                </PostFormSection>
              </div>

              <section
                aria-labelledby="edit-listing-preview-heading"
                className="space-y-3 rounded-2xl border border-dashed border-border bg-muted/30 p-4"
              >
                <h2
                  id="edit-listing-preview-heading"
                  className="text-base font-semibold text-foreground"
                >
                  Listing preview
                </h2>
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
              </section>

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
                    label: "Preparing and verifying video...",
                    doneLabel: "Video verified",
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

              <PostEditActionBar
                onCancel={() => router.back()}
                isSubmitting={isSubmitting}
                submittingLabel={submitProgress || "Saving..."}
              />
            </form>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
