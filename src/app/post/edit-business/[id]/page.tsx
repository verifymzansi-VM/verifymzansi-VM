"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import {
  Loader2,
  ArrowLeft,
  Phone,
  Mail,
  MessageCircle,
  Store,
  MapPin,
  Building2,
  CreditCard,
  Truck,
  Wrench,
  Plus,
  X,
  Camera,
  Film,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { UploadArea, BusinessType } from "@/types/enums";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { PageHeader } from "@/components/layout/page-header";
import { MediaUpload } from "@/components/ui/media-upload";
import { normalizeMediaUrl } from "@/lib/utils/media-url";
import { useToast } from "@/hooks/use-toast";
import { getProvinceNames, getCitiesForProvince } from "@/lib/constants/sa-provinces";
import { BUSINESS_CATEGORIES, BUSINESS_TYPE_OPTIONS } from "@/lib/constants/categories";

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 transition-shadow";

const PAYMENT_METHOD_OPTIONS = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "eft", label: "EFT / Bank Transfer" },
  { value: "snapscan", label: "SnapScan" },
  { value: "capitec_pay", label: "Capitec Pay" },
  { value: "other", label: "Other" },
];

const DELIVERY_OPTION_LIST = [
  { value: "in_store", label: "In-Store / Walk-in" },
  { value: "delivery", label: "Delivery" },
  { value: "collection", label: "Collection" },
  { value: "nationwide", label: "Nationwide Shipping" },
];

export default function EditBusinessPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const businessId = params.id;
  const { toast } = useToast();

  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Business Type
  const [businessType, setBusinessType] = useState<BusinessType>("standalone_shop");

  // Basic Info
  const [businessName, setBusinessName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");

  // Location
  const [province, setProvince] = useState("");
  const [city, setCity] = useState("");
  const [storeNumber, setStoreNumber] = useState("");
  const [mallId, setMallId] = useState("");
  const [malls, setMalls] = useState<{ id: string; name: string; location_city: string | null }[]>(
    []
  );
  const [serviceAreasInput, setServiceAreasInput] = useState("");

  // Contact & Social
  const [phone, setPhone] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [socialFacebook, setSocialFacebook] = useState("");
  const [socialInstagram, setSocialInstagram] = useState("");
  const [socialTwitter, setSocialTwitter] = useState("");
  const [socialTiktok, setSocialTiktok] = useState("");

  // Operating Hours
  const [hoursMonFri, setHoursMonFri] = useState("");
  const [hoursSat, setHoursSat] = useState("");
  const [hoursSun, setHoursSun] = useState("");

  // Services & Additional
  const [servicesInput, setServicesInput] = useState("");
  const [services, setServices] = useState<string[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<string[]>([]);
  const [deliveryOptions, setDeliveryOptions] = useState<string[]>([]);

  // Media — existing URLs
  const [existingLogo, setExistingLogo] = useState("");
  const [existingCoverPhoto, setExistingCoverPhoto] = useState("");
  const [existingCoverVideo, setExistingCoverVideo] = useState("");
  const [existingVideoThumbnail, setExistingVideoThumbnail] = useState("");
  const [existingGalleryPhotos, setExistingGalleryPhotos] = useState<string[]>([]);

  // Media — new files
  const [newLogoFile, setNewLogoFile] = useState<File[]>([]);
  const [newCoverFile, setNewCoverFile] = useState<File[]>([]);
  const [newGalleryFiles, setNewGalleryFiles] = useState<File[]>([]);
  const [newPromoVideoFile, setNewPromoVideoFile] = useState<File[]>([]);
  const [newVideoThumbnailFile, setNewVideoThumbnailFile] = useState<File[]>([]);
  const [removeGallery, setRemoveGallery] = useState(false);
  const [removeVideo, setRemoveVideo] = useState(false);

  const provinces = getProvinceNames();
  const cities = province ? getCitiesForProvince(province) : [];

  // Load existing data
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/businesses/${businessId}`);
        if (!res.ok) {
          setError("Business not found");
          return;
        }
        const data = await res.json();
        const b = data.business;

        setBusinessType(b.business_type || "standalone_shop");
        setBusinessName(b.business_name || "");
        setSlug(b.slug || "");
        setDescription(b.description || "");
        setCategory(b.category || "");
        setProvince(b.location_province || "");
        setCity(b.location_city || "");
        setStoreNumber(b.store_number || "");
        setMallId(b.mall_id || "");
        setPhone(b.phone || "");
        setWhatsapp(b.whatsapp || "");
        setEmail(b.email || "");
        setWebsite(b.website || "");
        setExistingLogo(b.logo_url || "");
        setExistingCoverPhoto(b.cover_photo || "");
        setExistingCoverVideo(b.cover_video || "");
        setExistingVideoThumbnail(b.video_thumbnail || "");
        setExistingGalleryPhotos(b.gallery_photos || []);
        setServices(b.services_offered || []);
        setPaymentMethods(b.payment_methods_accepted || []);
        setDeliveryOptions(b.delivery_options || []);

        // Operating hours
        const hours = b.operating_hours || {};
        setHoursMonFri(hours.Mon_Fri || "");
        setHoursSat(hours.Sat || "");
        setHoursSun(hours.Sun || "");

        // Social links
        const social = b.social_links || {};
        setSocialFacebook(social.facebook || "");
        setSocialInstagram(social.instagram || "");
        setSocialTwitter(social.twitter || "");
        setSocialTiktok(social.tiktok || "");

        // Service areas
        if (b.service_areas?.areas) {
          setServiceAreasInput(b.service_areas.areas.join(", "));
        }
      } catch {
        setError("Failed to load business");
      } finally {
        setIsLoading(false);
      }
    }

    async function fetchMalls() {
      try {
        const { createClient } = await import("@/lib/supabase/client");
        const supabase = createClient();
        const { data } = await supabase
          .from("malls")
          .select("id, name, location_city")
          .order("name");
        if (data) setMalls(data);
      } catch {
        // non-critical
      }
    }

    load();
    fetchMalls();
  }, [businessId]);

  function addService() {
    const trimmed = servicesInput.trim();
    if (trimmed && !services.includes(trimmed) && services.length < 30) {
      setServices((prev) => [...prev, trimmed]);
      setServicesInput("");
    }
  }

  function removeService(index: number) {
    setServices((prev) => prev.filter((_, i) => i !== index));
  }

  function togglePaymentMethod(method: string) {
    setPaymentMethods((prev) =>
      prev.includes(method) ? prev.filter((m) => m !== method) : [...prev, method]
    );
  }

  function toggleDeliveryOption(option: string) {
    setDeliveryOptions((prev) =>
      prev.includes(option) ? prev.filter((o) => o !== option) : [...prev, option]
    );
  }

  async function uploadMedia(files: File[], area: UploadArea): Promise<string[]> {
    if (files.length === 0) return [];
    try {
      const uploadData = new FormData();
      uploadData.append("area", area);
      files.forEach((f) => uploadData.append("files", f));
      const uploadRes = await fetch("/api/media/upload", { method: "POST", body: uploadData });
      if (!uploadRes.ok) throw new Error("Upload failed");
      const uploadJson = await uploadRes.json();
      return uploadJson.urls || [];
    } catch {
      toast({
        title: "Some media failed to upload",
        description:
          "Your changes will be saved without the failed files. You can re-upload them later.",
        variant: "destructive",
      });
      return [];
    }
  }

  async function handleSubmit() {
    setIsSubmitting(true);
    setError(null);

    try {
      // Upload new media if provided
      let finalLogoUrl = existingLogo;
      if (newLogoFile.length > 0) {
        const urls = await uploadMedia(newLogoFile, "business_logo");
        if (urls[0]) finalLogoUrl = urls[0];
      }

      let finalCoverPhoto = existingCoverPhoto;
      let finalCoverVideo = existingCoverVideo;
      let finalVideoThumbnail = existingVideoThumbnail;
      let finalGalleryPhotos = existingGalleryPhotos;

      if (newCoverFile.length > 0) {
        const urls = await uploadMedia(newCoverFile, "business_cover");
        if (urls[0]) finalCoverPhoto = urls[0];
      }

      if (removeVideo) {
        finalCoverVideo = "";
        finalVideoThumbnail = "";
      } else if (newPromoVideoFile.length > 0) {
        const urls = await uploadMedia(newPromoVideoFile, "business_cover");
        if (urls[0]) finalCoverVideo = urls[0];
      }

      if (newVideoThumbnailFile.length > 0 && finalCoverVideo) {
        const thumbUrls = await uploadMedia(newVideoThumbnailFile, "business_cover");
        if (thumbUrls[0]) finalVideoThumbnail = thumbUrls[0];
      }

      if (removeGallery) {
        finalGalleryPhotos = [];
      } else if (newGalleryFiles.length > 0) {
        const urls = await uploadMedia(newGalleryFiles, "business_gallery");
        if (urls.length > 0) finalGalleryPhotos = urls;
      }

      // Build social links
      const socialLinks: Record<string, string> = {};
      if (socialFacebook) socialLinks.facebook = socialFacebook;
      if (socialInstagram) socialLinks.instagram = socialInstagram;
      if (socialTwitter) socialLinks.twitter = socialTwitter;
      if (socialTiktok) socialLinks.tiktok = socialTiktok;

      // Build operating hours
      const operatingHours: Record<string, string> = {};
      if (hoursMonFri) operatingHours.Mon_Fri = hoursMonFri;
      if (hoursSat) operatingHours.Sat = hoursSat;
      if (hoursSun) operatingHours.Sun = hoursSun;

      // Build service areas
      const serviceAreas =
        businessType === "mobile_service" && serviceAreasInput
          ? {
              areas: serviceAreasInput
                .split(",")
                .map((a) => a.trim())
                .filter(Boolean),
            }
          : undefined;

      const body = {
        business_name: businessName,
        slug,
        business_type: businessType,
        category,
        description,
        location_province: province,
        location_city: city,
        store_number: businessType === "mall_store" ? storeNumber : undefined,
        mall_id: businessType === "mall_store" && mallId ? mallId : undefined,
        phone: phone || undefined,
        whatsapp: whatsapp || undefined,
        email: email || undefined,
        website: website || undefined,
        logo_url: finalLogoUrl || undefined,
        cover_photo: finalCoverPhoto || undefined,
        cover_video: finalCoverVideo || undefined,
        video_thumbnail: finalVideoThumbnail || undefined,
        gallery_photos: finalGalleryPhotos.length > 0 ? finalGalleryPhotos : [],
        services_offered: services,
        service_areas: serviceAreas,
        operating_hours: operatingHours,
        payment_methods_accepted: paymentMethods,
        delivery_options: deliveryOptions,
        social_links: Object.keys(socialLinks).length > 0 ? socialLinks : undefined,
      };

      const res = await fetch(`/api/businesses/${businessId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to update business");
        return;
      }

      toast({ title: "Business updated!", variant: "success" });
      router.push("/dashboard/businesses?updated=true");
    } catch {
      setError("Something went wrong. Please try again.");
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
            title="Edit Business"
            breadcrumbs={[
              { label: "Dashboard", href: "/dashboard" },
              { label: "My Businesses", href: "/dashboard/businesses" },
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
              {/* Business Type (read-only display) */}
              <div className="space-y-2">
                <Label>Business Type</Label>
                <div className="flex items-center gap-2">
                  {(() => {
                    const opt = BUSINESS_TYPE_OPTIONS.find((o) => o.value === businessType);
                    if (!opt) return <span className="text-sm">{businessType}</span>;
                    const Icon = opt.icon;
                    return (
                      <Badge variant="outline" className="gap-1.5 py-1.5 px-3">
                        <Icon className="h-4 w-4" />
                        {opt.label}
                      </Badge>
                    );
                  })()}
                </div>
              </div>

              {/* Basic Information */}
              <div className="space-y-2">
                <Label htmlFor="businessName">Business Name</Label>
                <Input
                  id="businessName"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  maxLength={100}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="slug">URL Slug</Label>
                <Input
                  id="slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  maxLength={60}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={5}
                  maxLength={3000}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="category">Category</Label>
                <select
                  id="category"
                  aria-label="Category"
                  className={selectClass}
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="">Select a category...</option>
                  {BUSINESS_CATEGORIES.map((cat) => (
                    <option key={cat.value} value={cat.value}>
                      {cat.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Location */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="province">Province</Label>
                  <select
                    id="province"
                    aria-label="Province"
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
                    aria-label="City / Town"
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

              {/* Mall Store specific */}
              {businessType === "mall_store" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 bg-muted/50 border rounded-lg">
                  <div className="space-y-2">
                    <Label htmlFor="storeNumber" className="flex items-center gap-1.5">
                      <Store className="h-4 w-4 text-brand-blue" /> Store Number
                    </Label>
                    <Input
                      id="storeNumber"
                      value={storeNumber}
                      onChange={(e) => setStoreNumber(e.target.value)}
                      maxLength={20}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="mallId">Mall</Label>
                    <select
                      id="mallId"
                      aria-label="Mall"
                      className={selectClass}
                      value={mallId}
                      onChange={(e) => setMallId(e.target.value)}
                    >
                      <option value="">Independent / Not in a mall</option>
                      {malls.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                          {m.location_city ? ` (${m.location_city})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {/* Mobile Service specific */}
              {businessType === "mobile_service" && (
                <div className="space-y-2 p-4 bg-muted/50 border rounded-lg">
                  <Label htmlFor="serviceAreas" className="flex items-center gap-1.5">
                    <MapPin className="h-4 w-4 text-brand-blue" /> Service Areas
                  </Label>
                  <Input
                    id="serviceAreas"
                    value={serviceAreasInput}
                    onChange={(e) => setServiceAreasInput(e.target.value)}
                    placeholder="e.g. Sandton, Randburg, Fourways"
                  />
                  <p className="text-xs text-muted-foreground">
                    Comma-separated list of areas you serve.
                  </p>
                </div>
              )}

              {/* Contact */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="phone" className="flex items-center gap-1.5">
                    <Phone className="h-4 w-4 text-muted-foreground" /> Phone
                  </Label>
                  <Input
                    id="phone"
                    autoComplete="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="082 000 0000"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="whatsapp" className="flex items-center gap-1.5">
                    <MessageCircle className="h-4 w-4 text-green-600" /> WhatsApp
                  </Label>
                  <Input
                    id="whatsapp"
                    autoComplete="tel"
                    value={whatsapp}
                    onChange={(e) => setWhatsapp(e.target.value)}
                    placeholder="082 000 0000"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email" className="flex items-center gap-1.5">
                    <Mail className="h-4 w-4 text-muted-foreground" /> Email
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    spellCheck={false}
                    autoCapitalize="none"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="website">Website</Label>
                  <Input
                    id="website"
                    autoComplete="url"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    placeholder="https://..."
                  />
                </div>
              </div>

              {/* Social */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="facebook" className="text-xs text-muted-foreground">
                    Facebook
                  </Label>
                  <Input
                    id="facebook"
                    value={socialFacebook}
                    onChange={(e) => setSocialFacebook(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="instagram" className="text-xs text-muted-foreground">
                    Instagram
                  </Label>
                  <Input
                    id="instagram"
                    value={socialInstagram}
                    onChange={(e) => setSocialInstagram(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="twitter" className="text-xs text-muted-foreground">
                    X (Twitter)
                  </Label>
                  <Input
                    id="twitter"
                    value={socialTwitter}
                    onChange={(e) => setSocialTwitter(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="tiktok" className="text-xs text-muted-foreground">
                    TikTok
                  </Label>
                  <Input
                    id="tiktok"
                    value={socialTiktok}
                    onChange={(e) => setSocialTiktok(e.target.value)}
                  />
                </div>
              </div>

              {/* Operating Hours */}
              <div className="space-y-3">
                <Label>Operating Hours</Label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="hoursMonFri" className="text-xs text-muted-foreground">
                      Mon - Fri
                    </Label>
                    <Input
                      id="hoursMonFri"
                      value={hoursMonFri}
                      onChange={(e) => setHoursMonFri(e.target.value)}
                      placeholder="09:00 - 17:00"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="hoursSat" className="text-xs text-muted-foreground">
                      Saturday
                    </Label>
                    <Input
                      id="hoursSat"
                      value={hoursSat}
                      onChange={(e) => setHoursSat(e.target.value)}
                      placeholder="09:00 - 14:00"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="hoursSun" className="text-xs text-muted-foreground">
                      Sunday
                    </Label>
                    <Input
                      id="hoursSun"
                      value={hoursSun}
                      onChange={(e) => setHoursSun(e.target.value)}
                      placeholder="Closed"
                    />
                  </div>
                </div>
              </div>

              {/* Existing Media Preview */}
              {(existingLogo ||
                existingCoverPhoto ||
                existingCoverVideo ||
                existingGalleryPhotos.length > 0) && (
                <div className="space-y-3">
                  <Label>Current Media</Label>
                  <div className="flex flex-wrap gap-4">
                    {existingLogo && (
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Logo</p>
                        <div className="h-12 w-12 rounded-lg overflow-hidden border">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={normalizeMediaUrl(existingLogo)}
                            alt="Logo"
                            className="w-full h-full object-cover"
                          />
                        </div>
                      </div>
                    )}
                    {existingCoverPhoto && (
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Cover Photo</p>
                        <div className="h-16 w-28 rounded-lg overflow-hidden border">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={normalizeMediaUrl(existingCoverPhoto)}
                            alt="Cover"
                            className="w-full h-full object-cover"
                          />
                        </div>
                      </div>
                    )}
                    {existingCoverVideo && !removeVideo && (
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Promo Video</p>
                        <div className="h-16 w-28 rounded-lg overflow-hidden border bg-black flex items-center justify-center">
                          <Film className="h-6 w-6 text-white/60" />
                        </div>
                        <button
                          type="button"
                          onClick={() => setRemoveVideo(true)}
                          className="text-xs text-destructive hover:underline"
                        >
                          Remove video
                        </button>
                      </div>
                    )}
                  </div>
                  {/* Existing gallery photos */}
                  {existingGalleryPhotos.length > 0 && !removeGallery && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Camera className="h-3 w-3" /> Gallery Photos (
                          {existingGalleryPhotos.length})
                        </p>
                        <button
                          type="button"
                          onClick={() => setRemoveGallery(true)}
                          className="text-xs text-destructive hover:underline"
                        >
                          Replace all
                        </button>
                      </div>
                      <div className="flex gap-2 overflow-x-auto pb-1">
                        {existingGalleryPhotos.map((url, i) => (
                          <div
                            key={i}
                            className="h-12 w-12 rounded-lg overflow-hidden border flex-shrink-0"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={normalizeMediaUrl(url)}
                              alt={`Gallery ${i + 1}`}
                              className="w-full h-full object-cover"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Upload new media */}
              <div className="space-y-4">
                <Label className="text-sm font-medium">Upload New Media</Label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <MediaUpload
                    label="Replace Logo"
                    maxFiles={1}
                    files={newLogoFile}
                    onChange={setNewLogoFile}
                    accept="image/*"
                  />
                  <MediaUpload
                    label="Replace Cover Photo"
                    maxFiles={1}
                    files={newCoverFile}
                    onChange={setNewCoverFile}
                    accept="image/*"
                  />
                </div>

                {/* Gallery Photos */}
                <div className="space-y-2">
                  <MediaUpload
                    label={
                      removeGallery || existingGalleryPhotos.length === 0
                        ? "Profile Photos (up to 5)"
                        : "Replace Profile Photos (up to 5)"
                    }
                    maxFiles={5}
                    files={newGalleryFiles}
                    onChange={setNewGalleryFiles}
                    accept="image/*"
                  />
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Camera className="h-3 w-3" />
                    Showcase your business. Use landscape photos (800×600px+).
                  </p>
                  {/* Gallery reorder controls */}
                  {newGalleryFiles.length > 1 && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">
                        Order — first photo is featured on cards:
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {newGalleryFiles.map((file, idx) => (
                          <div
                            key={`${file.name}-${idx}`}
                            className="flex items-center gap-1 bg-muted rounded-md px-2 py-1 text-xs"
                          >
                            <span className="font-medium truncate max-w-[100px]">{file.name}</span>
                            <button
                              type="button"
                              disabled={idx === 0}
                              onClick={() => {
                                const arr = [...newGalleryFiles];
                                [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
                                setNewGalleryFiles(arr);
                              }}
                              className="p-0.5 disabled:opacity-30 hover:bg-background rounded"
                              aria-label="Move left"
                            >
                              <ChevronLeft className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              disabled={idx === newGalleryFiles.length - 1}
                              onClick={() => {
                                const arr = [...newGalleryFiles];
                                [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
                                setNewGalleryFiles(arr);
                              }}
                              className="p-0.5 disabled:opacity-30 hover:bg-background rounded"
                              aria-label="Move right"
                            >
                              <ChevronRight className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Promo Video */}
                <div className="space-y-2">
                  <MediaUpload
                    label={
                      removeVideo || !existingCoverVideo
                        ? "Promo / Intro Video (1 max)"
                        : "Replace Promo Video"
                    }
                    maxFiles={1}
                    files={newPromoVideoFile}
                    onChange={(files) => {
                      setNewPromoVideoFile(files);
                      if (files.length === 0) setNewVideoThumbnailFile([]);
                    }}
                    accept="video/*"
                  />
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Film className="h-3 w-3" />
                    Auto-plays muted on your profile. Max 50 MB.
                  </p>
                </div>

                {/* Video Thumbnail */}
                {(newPromoVideoFile.length > 0 || (existingCoverVideo && !removeVideo)) && (
                  <MediaUpload
                    label="Video Thumbnail (1 max) — Poster shown before video loads"
                    maxFiles={1}
                    files={newVideoThumbnailFile}
                    onChange={setNewVideoThumbnailFile}
                    accept="image/*"
                  />
                )}
              </div>

              {/* Services Offered */}
              <div className="space-y-3">
                <Label className="flex items-center gap-2">
                  <Wrench className="h-4 w-4 text-muted-foreground" /> Services Offered
                </Label>
                <div className="flex gap-2">
                  <Input
                    value={servicesInput}
                    onChange={(e) => setServicesInput(e.target.value)}
                    placeholder="Type a service and press Add"
                    maxLength={200}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addService();
                      }
                    }}
                  />
                  <Button type="button" variant="outline" size="sm" onClick={addService}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                {services.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {services.map((service, i) => (
                      <Badge
                        key={i}
                        variant="secondary"
                        className="gap-1 cursor-pointer"
                        onClick={() => removeService(i)}
                      >
                        {service}
                        <X className="h-3 w-3" />
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              {/* Payment Methods */}
              <div className="space-y-3">
                <Label className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-muted-foreground" /> Payment Methods
                </Label>
                <div className="flex flex-wrap gap-3">
                  {PAYMENT_METHOD_OPTIONS.map((option) => (
                    <label
                      key={option.value}
                      className="flex items-center gap-2 text-sm cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={paymentMethods.includes(option.value)}
                        onChange={() => togglePaymentMethod(option.value)}
                        className="rounded"
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
              </div>

              {/* Delivery Options */}
              <div className="space-y-3">
                <Label className="flex items-center gap-2">
                  <Truck className="h-4 w-4 text-muted-foreground" /> Delivery Options
                </Label>
                <div className="flex flex-wrap gap-3">
                  {DELIVERY_OPTION_LIST.map((option) => (
                    <label
                      key={option.value}
                      className="flex items-center gap-2 text-sm cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={deliveryOptions.includes(option.value)}
                        onChange={() => toggleDeliveryOption(option.value)}
                        className="rounded"
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
              </div>

              {/* Actions */}
              <div className="flex justify-between pt-4">
                <Button variant="outline" asChild className="gap-1">
                  <Link href="/dashboard/businesses">
                    <ArrowLeft className="h-4 w-4" />
                    Cancel
                  </Link>
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={
                    isSubmitting || businessName.length < 2 || !category || !province || !city
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
                      <Building2 className="h-4 w-4" />
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
