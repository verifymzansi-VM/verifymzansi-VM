"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { Megaphone, ArrowLeft, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { PageHeader } from "@/components/layout/page-header";
import { MediaUpload } from "@/components/ui/media-upload";
import { getProvinceNames, getCitiesForProvince } from "@/lib/constants/sa-provinces";
import { PROMOTION_TYPE_LABELS, type PromotionType } from "@/types/enums";
import { normalizeMediaUrl } from "@/lib/utils/media-url";

const PROMOTION_TYPES = Object.entries(PROMOTION_TYPE_LABELS) as [PromotionType, string][];
const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 transition-shadow";

export default function EditPromotionPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const promotionId = params.id;

  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
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
  // Existing URLs loaded from API
  const [existingImages, setExistingImages] = useState<string[]>([]);
  const [existingVideos, setExistingVideos] = useState<string[]>([]);
  const [videoThumbnail, setVideoThumbnail] = useState("");
  // New files to upload
  const [newPhotoFiles, setNewPhotoFiles] = useState<File[]>([]);
  const [newVideoFiles, setNewVideoFiles] = useState<File[]>([]);

  const provinces = getProvinceNames();
  const cities = province ? getCitiesForProvince(province) : [];

  // Load existing data
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/promotions/${promotionId}`);
        if (!res.ok) {
          setError("Promotion not found");
          return;
        }
        const data = await res.json();
        const p = data.promotion;

        setPromotionType(p.promotion_type || "general");
        setTitle(p.title || "");
        setDescription(p.description || "");
        setCategory(p.category || "");
        setPriceZar(p.price_cents ? (p.price_cents / 100).toString() : "");
        setNegotiable(p.price_negotiable || false);
        setProvince(p.location_province || "");
        setCity(p.location_city || "");
        setContactMethods(p.contact_methods || ["call"]);
        setStartDate(p.start_date ? p.start_date.split("T")[0] : "");
        setEndDate(p.end_date ? p.end_date.split("T")[0] : "");
        setExistingImages(p.photos || []);
        setExistingVideos(p.videos || []);
        setVideoThumbnail(p.video_thumbnail || "");
      } catch {
        setError("Failed to load promotion");
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, [promotionId]);

  function toggleContact(method: string) {
    setContactMethods((prev) =>
      prev.includes(method) ? prev.filter((m) => m !== method) : [...prev, method]
    );
  }

  function removeExistingImage(index: number) {
    setExistingImages((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit() {
    setIsSubmitting(true);
    setError(null);

    try {
      // Upload new photos if any
      let newImageUrls: string[] = [];
      if (newPhotoFiles.length > 0) {
        const uploadData = new FormData();
        uploadData.append("area", "promotion");
        for (const f of newPhotoFiles) uploadData.append("files", f);
        const uploadRes = await fetch("/api/media/upload", { method: "POST", body: uploadData });
        if (!uploadRes.ok) throw new Error("Failed to upload photos");
        const uploadJson = await uploadRes.json();
        if (uploadJson.urls) newImageUrls = uploadJson.urls;
      }

      // Upload new videos if any
      let newVideoUrls: string[] = [];
      if (newVideoFiles.length > 0) {
        const uploadData = new FormData();
        uploadData.append("area", "promotion");
        for (const f of newVideoFiles) uploadData.append("files", f);
        const uploadRes = await fetch("/api/media/upload", { method: "POST", body: uploadData });
        if (!uploadRes.ok) throw new Error("Failed to upload video");
        const uploadJson = await uploadRes.json();
        if (uploadJson.urls) newVideoUrls = uploadJson.urls;
      }

      const allImages = [...existingImages, ...newImageUrls];
      const allVideos = [...existingVideos, ...newVideoUrls];

      const body = {
        title,
        description,
        promotion_type: promotionType,
        category: category || undefined,
        price_zar: priceZar ? parseFloat(priceZar) : undefined,
        negotiable,
        province,
        city,
        contact_methods: contactMethods,
        images: allImages,
        videos: allVideos,
        video_thumbnail: videoThumbnail || undefined,
        start_date: startDate ? new Date(startDate).toISOString() : undefined,
        end_date: endDate ? new Date(endDate).toISOString() : undefined,
      };

      const res = await fetch(`/api/promotions/${promotionId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to update promotion");
        return;
      }

      router.push("/dashboard/promotions?updated=true");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const totalImages = existingImages.length + newPhotoFiles.length;

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
        <div className="container-page py-6 space-y-6 max-w-3xl">
          <PageHeader
            title="Edit Promotion"
            breadcrumbs={[
              { label: "Dashboard", href: "/dashboard" },
              { label: "Promotions", href: "/dashboard/promotions" },
              { label: "Edit" },
            ]}
          />

          {error && (
            <div className="bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400 p-4 rounded-lg text-sm">
              {error}
            </div>
          )}

          <Card>
            <CardContent className="p-6 space-y-6">
              <div className="space-y-2">
                <Label htmlFor="promotion_type">Promotion Type</Label>
                <select
                  id="promotion_type"
                  className={selectClass}
                  value={promotionType}
                  onChange={(e) => setPromotionType(e.target.value as PromotionType)}
                >
                  {PROMOTION_TYPES.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="title">Title</Label>
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
                <Label htmlFor="category">Category (optional)</Label>
                <Input
                  id="category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  maxLength={100}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="price">Price (ZAR, optional)</Label>
                  <Input
                    id="price"
                    type="number"
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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="province">Province</Label>
                  <select
                    id="province"
                    className={selectClass}
                    value={province}
                    onChange={(e) => {
                      setProvince(e.target.value);
                      setCity("");
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
                <div className="space-y-2">
                  <Label htmlFor="city">City / Town</Label>
                  <select
                    id="city"
                    className={selectClass}
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
              </div>

              <div className="space-y-2">
                <Label>Contact Methods</Label>
                <div className="flex gap-3">
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

              {/* Existing images preview */}
              {existingImages.length > 0 && (
                <div className="space-y-2">
                  <Label>Current Photos ({existingImages.length})</Label>
                  <div className="grid grid-cols-4 gap-2">
                    {existingImages.map((url, i) => (
                      <div
                        key={i}
                        className="relative group aspect-square rounded-lg overflow-hidden border"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={normalizeMediaUrl(url)}
                          alt={`Photo ${i + 1}`}
                          className="w-full h-full object-cover"
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
                label={`Add Photos (${totalImages}/10)`}
                maxFiles={Math.max(0, 10 - existingImages.length)}
                files={newPhotoFiles}
                onChange={setNewPhotoFiles}
                accept="image/*"
              />

              {/* Add new videos */}
              <MediaUpload
                label="Add Videos (optional)"
                maxFiles={Math.max(0, 3 - existingVideos.length)}
                files={newVideoFiles}
                onChange={setNewVideoFiles}
                accept="video/*"
              />

              <div className="flex justify-between">
                <Button
                  variant="outline"
                  onClick={() => router.push("/dashboard/promotions")}
                  className="gap-1"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Cancel
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
                  className="gap-1"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Saving...
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
