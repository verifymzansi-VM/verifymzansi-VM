"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Megaphone, ArrowLeft, ArrowRight, Loader2, Building2 } from "lucide-react";
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

type Step = 1 | 2 | 3;

const PROMOTION_TYPES = Object.entries(PROMOTION_TYPE_LABELS) as [PromotionType, string][];
const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 transition-shadow";

export default function CreatePromotionPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState<Step>(1);
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
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [videoFiles, setVideoFiles] = useState<File[]>([]);

  // Link to Business
  const [businessId, setBusinessId] = useState(searchParams.get("business_id") || "");
  const [myBusinesses, setMyBusinesses] = useState<{ id: string; business_name: string }[]>([]);

  useEffect(() => {
    async function loadBusinesses() {
      try {
        const res = await fetch("/api/businesses?mine=true&limit=50");
        if (res.ok) {
          const data = await res.json();
          setMyBusinesses(data.businesses ?? []);
        }
      } catch {
        // non-critical — user simply won't see the dropdown
      }
    }
    loadBusinesses();
  }, []);

  const provinces = getProvinceNames();
  const cities = province ? getCitiesForProvince(province) : [];

  function toggleContact(method: string) {
    setContactMethods((prev) =>
      prev.includes(method) ? prev.filter((m) => m !== method) : [...prev, method]
    );
  }

  async function handleSubmit() {
    setIsSubmitting(true);
    setError(null);

    try {
      // Upload photos
      let imageUrls: string[] = [];
      if (photoFiles.length > 0) {
        const uploadData = new FormData();
        uploadData.append("area", "promotion");
        for (const f of photoFiles) uploadData.append("files", f);
        const uploadRes = await fetch("/api/media/upload", { method: "POST", body: uploadData });
        if (!uploadRes.ok) throw new Error("Failed to upload photos");
        const uploadJson = await uploadRes.json();
        if (uploadJson.urls) imageUrls = uploadJson.urls;
      }

      // Upload videos
      let videoUrls: string[] = [];
      if (videoFiles.length > 0) {
        const uploadData = new FormData();
        uploadData.append("area", "promotion");
        for (const f of videoFiles) uploadData.append("files", f);
        const uploadRes = await fetch("/api/media/upload", { method: "POST", body: uploadData });
        if (!uploadRes.ok) throw new Error("Failed to upload video");
        const uploadJson = await uploadRes.json();
        if (uploadJson.urls) videoUrls = uploadJson.urls;
      }

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
        images: imageUrls,
        videos: videoUrls,
        start_date: startDate ? new Date(startDate).toISOString() : undefined,
        end_date: endDate ? new Date(endDate).toISOString() : undefined,
        business_id: businessId || undefined,
      };

      const res = await fetch("/api/promotions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to create promotion");
        return;
      }

      router.push("/dashboard/promotions?created=true");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header isAuthenticated />

      <main className="flex-1">
        <div className="container-page py-6 space-y-6 max-w-3xl">
          <PageHeader
            title="Create a Promotion"
            description="Advertise anything — products, services, events, or deals."
            breadcrumbs={[
              { label: "Dashboard", href: "/dashboard" },
              { label: "Create Post", href: "/post/create" },
              { label: "Promotion" },
            ]}
          />

          {/* Step indicator */}
          <div className="flex items-center gap-2">
            {[1, 2, 3].map((s) => (
              <div
                key={s}
                className={`flex-1 h-2 rounded-full transition-colors ${
                  s <= step ? "bg-brand-green" : "bg-warm-200 dark:bg-warm-700"
                }`}
              />
            ))}
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400 p-4 rounded-lg text-sm">
              {error}
            </div>
          )}

          {/* Step 1: Type, Title, Description */}
          {step === 1 && (
            <Card>
              <CardContent className="p-6 space-y-6">
                <div className="flex items-center gap-2 text-lg font-semibold">
                  <Megaphone className="h-5 w-5 text-brand-green" />
                  What are you advertising?
                </div>

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
                    placeholder="e.g. Fresh Produce Delivery in Soweto"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={120}
                  />
                  <p className="text-xs text-muted-foreground">{title.length}/120 characters</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    placeholder="Tell buyers what you're offering, why it's great, and how they can get it..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={6}
                    maxLength={5000}
                  />
                  <p className="text-xs text-muted-foreground">
                    {description.length}/5000 characters (min. 20)
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="category">Category (optional)</Label>
                  <Input
                    id="category"
                    placeholder="e.g. Food & Groceries"
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
                      Link this promotion to one of your businesses so it appears on their profile.
                    </p>
                  </div>
                )}

                <div className="flex justify-end">
                  <Button
                    onClick={() => setStep(2)}
                    disabled={title.length < 5 || description.length < 20}
                    className="gap-1"
                  >
                    Next
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Step 2: Price, Location, Contact, Dates */}
          {step === 2 && (
            <Card>
              <CardContent className="p-6 space-y-6">
                <div className="text-lg font-semibold">Pricing, Location & Contact</div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="price">Price (ZAR, optional)</Label>
                    <Input
                      id="price"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
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
                      Price is negotiable
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
                      <label
                        key={method}
                        className="flex items-center gap-2 text-sm cursor-pointer"
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
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="start_date">Start Date (optional)</Label>
                    <Input
                      id="start_date"
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="end_date">End Date (optional)</Label>
                    <Input
                      id="end_date"
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                    />
                  </div>
                </div>

                <div className="flex justify-between">
                  <Button variant="outline" onClick={() => setStep(1)} className="gap-1">
                    <ArrowLeft className="h-4 w-4" />
                    Back
                  </Button>
                  <Button
                    onClick={() => setStep(3)}
                    disabled={!province || !city || contactMethods.length === 0}
                    className="gap-1"
                  >
                    Next
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Step 3: Media & Submit */}
          {step === 3 && (
            <Card>
              <CardContent className="p-6 space-y-6">
                <div className="text-lg font-semibold">Photos & Media</div>

                <MediaUpload
                  label="Photos (max 10)"
                  maxFiles={10}
                  files={photoFiles}
                  onChange={setPhotoFiles}
                  accept="image/*"
                />

                <MediaUpload
                  label="Videos (max 3, optional)"
                  maxFiles={3}
                  files={videoFiles}
                  onChange={setVideoFiles}
                  accept="video/*"
                />

                {/* Preview summary */}
                <div className="bg-muted/50 rounded-lg p-4 space-y-2 text-sm">
                  <h4 className="font-medium">Review</h4>
                  <div className="grid grid-cols-2 gap-2 text-muted-foreground">
                    <span>Type:</span>
                    <span className="font-medium text-foreground">
                      {PROMOTION_TYPE_LABELS[promotionType]}
                    </span>
                    <span>Title:</span>
                    <span className="font-medium text-foreground">{title}</span>
                    <span>Location:</span>
                    <span className="font-medium text-foreground">
                      {city}, {province}
                    </span>
                    {priceZar && (
                      <>
                        <span>Price:</span>
                        <span className="font-medium text-foreground">
                          R{parseFloat(priceZar).toFixed(2)}
                          {negotiable ? " (negotiable)" : ""}
                        </span>
                      </>
                    )}
                    <span>Photos:</span>
                    <span className="font-medium text-foreground">{photoFiles.length}</span>
                  </div>
                </div>

                <div className="flex justify-between">
                  <Button variant="outline" onClick={() => setStep(2)} className="gap-1">
                    <ArrowLeft className="h-4 w-4" />
                    Back
                  </Button>
                  <Button
                    onClick={handleSubmit}
                    disabled={isSubmitting || photoFiles.length === 0}
                    className="gap-1"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Publishing...
                      </>
                    ) : (
                      <>
                        <Megaphone className="h-4 w-4" />
                        Publish Promotion
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
