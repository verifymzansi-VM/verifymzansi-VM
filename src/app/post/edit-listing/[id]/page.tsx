"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { Loader2, X, Phone, MessageCircle, Mail, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { PageHeader } from "@/components/layout/page-header";
import { useToast } from "@/hooks/use-toast";
import { createClient } from "@/lib/supabase/client";
import { CategoryPicker } from "@/components/listings/category-picker";
import { MediaUpload } from "@/components/ui/media-upload";
import { getProvinceNames, getCitiesForProvince } from "@/lib/constants/sa-provinces";
import type { ListingCategory, ListingCondition, UploadArea } from "@/types/enums";
import { mapListingCategory } from "@/lib/utils/enum-compat";
import { normalizeMediaUrls } from "@/lib/utils/media-url";
import { cn } from "@/lib/utils";
import { coerceListingAttributes, validateListingAttributes } from "@/lib/forms/listing-form";
import { normalizeCreatePostError } from "@/app/post/_lib/create-post-errors";
import { LISTING_CONDITIONS } from "@/lib/constants/listing-condition";
import { ListingDetailContent } from "@/components/listings/listing-detail-content";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("EditListingPage");

export default function EditListingPage() {
  const params = useParams();
  const id = params.id as string;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState<ListingCategory | "">("");
  const [condition, setCondition] = useState<ListingCondition | "">("");
  const [categoryAttributes, setCategoryAttributes] = useState<Record<string, string | boolean>>(
    {}
  );
  const [province, setProvince] = useState("");
  const [city, setCity] = useState("");
  const [town, setTown] = useState("");
  const [negotiable, setNegotiable] = useState(false);
  const [contactMethods, setContactMethods] = useState<string[]>(["call"]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loadFailed, setLoadFailed] = useState(false);
  const [existingPhotos, setExistingPhotos] = useState<string[]>([]);
  const [existingVideos, setExistingVideos] = useState<string[]>([]);
  const [existingVideoThumbnail, setExistingVideoThumbnail] = useState<string | null>(null);
  const [newPhotoFiles, setNewPhotoFiles] = useState<File[]>([]);
  const [newVideoFile, setNewVideoFile] = useState<File[]>([]);
  const [newVideoCoverFile, setNewVideoCoverFile] = useState<File[]>([]);
  const router = useRouter();
  const { toast } = useToast();
  const provinces = getProvinceNames();
  const cities = province ? getCitiesForProvince(province) : [];
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
              | ListingCondition
              | undefined) ??
            "") as ListingCondition | ""
        );
        setCategoryAttributes((data.attributes as Record<string, string | boolean>) || {});
        setProvince(data.location_province || "");
        setCity(data.location_city || "");
        setTown(((data as Record<string, unknown>).location_suburb as string) || "");
        setNegotiable(data.price_negotiable ?? false);
        setContactMethods(
          Array.isArray(data.contact_methods) && data.contact_methods.length > 0
            ? (data.contact_methods as string[])
            : ["call"]
        );
        setExistingVideoThumbnail(
          ((data as Record<string, unknown>).video_thumbnail as string | null) ?? null
        );
        setExistingPhotos(
          normalizeMediaUrls(Array.isArray(data.photos) ? (data.photos as string[]) : [])
        );
        setExistingVideos(
          normalizeMediaUrls(Array.isArray(data.videos) ? (data.videos as string[]) : [])
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
    load();

    return () => {
      cancelled = true;
    };
  }, [id, router, toast]);

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

  function handleCategoryChange(cat: ListingCategory) {
    setCategory(cat);
    setCategoryAttributes({});
    setFieldErrors((current) => {
      const next = { ...current };
      delete next.category;
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
  }

  function handleAttributeChange(name: string, value: string | boolean) {
    setCategoryAttributes((prev) => ({ ...prev, [name]: value }));
    setFieldErrors((current) => {
      const next = { ...current };
      delete next[`attributes.${name}`];
      return next;
    });
  }

  const normalizedPreviewAttributes = category
    ? coerceListingAttributes(category, categoryAttributes)
    : {};
  const previewPhotos = previewPhotoUrls.length > 0 ? previewPhotoUrls : existingPhotos;
  const previewVideos = previewVideoUrls.length > 0 ? previewVideoUrls : existingVideos;
  const previewVideoThumbnail = previewVideoCoverUrl ?? existingVideoThumbnail;

  async function uploadMedia(files: File[], area: UploadArea): Promise<string[]> {
    if (files.length === 0) return [];
    const uploadData = new FormData();
    uploadData.append("area", area);
    files.forEach((f) => uploadData.append("files", f));
    const uploadRes = await fetch("/api/media/upload", { method: "POST", body: uploadData });
    if (!uploadRes.ok) throw new Error("Upload failed");
    const uploadJson = await uploadRes.json();
    return uploadJson.urls || [];
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title || !description || !price || !category) {
      toast({ title: "Please fill in all required fields", variant: "destructive" });
      return;
    }

    const attributeErrors = validateListingAttributes(category, categoryAttributes);
    if (Object.keys(attributeErrors).length > 0) {
      setFieldErrors(attributeErrors);
      toast({
        title: "Please fix the highlighted listing details",
        description: Object.values(attributeErrors)[0],
        variant: "destructive",
      });
      return;
    }

    const numPrice = parseFloat(price);
    if (isNaN(numPrice) || numPrice < 0) {
      toast({ title: "Please enter a valid price", variant: "destructive" });
      return;
    }

    if (!province) {
      toast({ title: "Please select a province", variant: "destructive" });
      return;
    }
    if (!city) {
      toast({ title: "Please select a city", variant: "destructive" });
      return;
    }
    if (contactMethods.length === 0) {
      toast({ title: "Please select at least one contact method", variant: "destructive" });
      return;
    }

    setIsSubmitting(true);
    try {
      const normalizedAttributes = coerceListingAttributes(category, categoryAttributes);
      const newPhotoUrls = await uploadMedia(newPhotoFiles, "listing");
      const newVideoUrls = await uploadMedia(newVideoFile, "listing_video");
      const newCoverUrls = await uploadMedia(newVideoCoverFile, "listing");

      // Resolve video thumbnail: new upload > existing > null
      let videoThumbnail: string | null = existingVideoThumbnail;
      if (newCoverUrls.length > 0) {
        videoThumbnail = newCoverUrls[0];
      }

      const allPhotos = [...existingPhotos, ...newPhotoUrls];
      const allVideos = [...existingVideos, ...newVideoUrls];

      if (allPhotos.length === 0) {
        toast({ title: "At least one photo is required", variant: "destructive" });
        setIsSubmitting(false);
        return;
      }

      // Submit via server-side API route for full validation & ownership check
      const res = await fetch(`/api/listings/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
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
          images: allPhotos,
          videos: allVideos,
          videoThumbnail,
          contactMethods,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const normalized = normalizeCreatePostError(data, "Something went wrong");
        setFieldErrors(normalized.fieldErrors);
        toast({
          title: "Failed to update listing",
          description: normalized.formError,
          variant: "destructive",
        });
        return;
      }

      toast({ title: "Listing updated!", variant: "success" });
      router.push("/dashboard/listings");
    } catch {
      toast({ title: "Something went wrong", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
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
                  {/* ── Category Picker ────────────────────────── */}
                  <CategoryPicker
                    value={category}
                    onChange={handleCategoryChange}
                    attributes={categoryAttributes}
                    onAttributeChange={handleAttributeChange}
                    errors={fieldErrors}
                  />

                  <div className="space-y-2">
                    <Label htmlFor="condition">Condition</Label>
                    <select
                      id="condition"
                      aria-label="Condition"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
                      onChange={(e) => setTitle(e.target.value)}
                      required
                    />
                  </div>

                  {/* ── Description ────────────────────────────── */}
                  <div className="space-y-2">
                    <Label htmlFor="description">Description *</Label>
                    <textarea
                      id="description"
                      title="Listing description"
                      placeholder="Describe your listing..."
                      className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      required
                    />
                  </div>

                  {/* ── Price ──────────────────────────────────── */}
                  <div className="space-y-2">
                    <Label htmlFor="price">Price (ZAR) *</Label>
                    <div className="flex gap-3">
                      <Input
                        id="price"
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                        required
                        className="flex-1"
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
                  </div>

                  {/* ── Location: Province / City / Town ───────── */}
                  <div className="space-y-3">
                    <Label className="text-base font-semibold">Location</Label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="province">Province</Label>
                        <select
                          id="province"
                          aria-label="Province"
                          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
                          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          value={city}
                          onChange={(e) => setCity(e.target.value)}
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

                  {/* ── Existing Images ──────────────────────── */}
                  {existingPhotos.length > 0 && (
                    <div className="space-y-2">
                      <Label>Current Photos</Label>
                      <div className="grid grid-cols-3 gap-2">
                        {existingPhotos.map((url, i) => (
                          <div
                            key={url}
                            className="relative group rounded-md overflow-hidden border"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={url}
                              alt={`Photo ${i + 1}`}
                              className="aspect-square object-cover w-full"
                            />
                            <button
                              type="button"
                              title="Remove photo"
                              onClick={() =>
                                setExistingPhotos((prev) => prev.filter((_, idx) => idx !== i))
                              }
                              className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
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
                    label={`Add Photos (max ${8 - existingPhotos.length} more)`}
                    maxFiles={8 - existingPhotos.length}
                    files={newPhotoFiles}
                    onChange={setNewPhotoFiles}
                    accept="image/*"
                    disabled={existingPhotos.length >= 8}
                  />

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
                            <video src={url} className="aspect-video object-cover w-full" />
                            <button
                              type="button"
                              title="Remove video"
                              onClick={() =>
                                setExistingVideos((prev) => prev.filter((_, idx) => idx !== i))
                              }
                              className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
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
                      label="Add Video (max 1)"
                      maxFiles={1}
                      files={newVideoFile}
                      onChange={setNewVideoFile}
                      accept="video/*"
                    />
                  )}

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
                      className="grid grid-cols-3 gap-2"
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
                  </div>

                  <div className="space-y-3 rounded-xl border border-dashed border-brand-green/30 bg-brand-green/5 p-4">
                    <div className="text-sm font-medium text-muted-foreground">Listing preview</div>
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
                        phone: null,
                        masked_phone_public: null,
                      }}
                      similarItems={[]}
                      similarSellers={new Map()}
                      showContactActions={false}
                      showSimilarListings={false}
                    />
                  </div>

                  <div className="flex gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => router.back()}
                      className="flex-1"
                    >
                      Cancel
                    </Button>
                    <Button type="submit" className="flex-1" disabled={isSubmitting}>
                      {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Save Changes
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
