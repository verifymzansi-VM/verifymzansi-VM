"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Loader2,
  Info,
  Phone,
  Mail,
  MessageCircle,
  Store,
  MapPin,
  Search,
  Building2,
  CreditCard,
  Truck,
  Wrench,
  Plus,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { UploadArea, BusinessType } from "@/types/enums";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { PageHeader } from "@/components/layout/page-header";
import { useToast } from "@/hooks/use-toast";
import { createClient } from "@/lib/supabase/client";
import { MediaUpload } from "@/components/ui/media-upload";
import { PlanGate } from "@/components/billing/plan-gate";
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

const DELIVERY_OPTIONS = [
  { value: "in_store", label: "In-Store / Walk-in" },
  { value: "delivery", label: "Delivery" },
  { value: "collection", label: "Collection" },
  { value: "nationwide", label: "Nationwide Shipping" },
];

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
}

export default function CreateBusinessPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialType = (searchParams.get("type") as BusinessType) || "";

  // Business Type
  const [businessType, setBusinessType] = useState<BusinessType | "">(initialType);

  // Basic Info
  const [businessName, setBusinessName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugManual, setSlugManual] = useState(false);
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

  // Media
  const [logoFile, setLogoFile] = useState<File[]>([]);
  const [coverFile, setCoverFile] = useState<File[]>([]);
  const [coverThumbnailFile, setCoverThumbnailFile] = useState<File[]>([]);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
  const provinces = getProvinceNames();
  const cities = province ? getCitiesForProvince(province) : [];

  // Fetch malls for mall_store type
  useEffect(() => {
    if (businessType === "mall_store") {
      async function fetchMalls() {
        const supabase = createClient();
        const { data } = await supabase
          .from("malls")
          .select("id, name, location_city")
          .order("name");
        if (data) setMalls(data);
      }
      fetchMalls();
    }
  }, [businessType]);

  // Auto-generate slug from business name
  useEffect(() => {
    if (!slugManual && businessName) {
      setSlug(generateSlug(businessName));
    }
  }, [businessName, slugManual]);

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
    } catch (e) {
      console.error("Upload error:", e);
      return [];
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!businessType || !businessName || !category || !province || !city) {
      toast({ title: "Please fill in all required fields", variant: "destructive" });
      return;
    }

    if (businessType === "mall_store" && !storeNumber) {
      toast({ title: "Store number is required for mall stores", variant: "destructive" });
      return;
    }

    setIsSubmitting(true);
    try {
      // Upload media
      const logoUrls = await uploadMedia(logoFile, "business_logo");
      const coverUrls = await uploadMedia(coverFile, "business_cover");

      const coverIsVideo = coverFile.length > 0 && coverFile[0]?.type.startsWith("video/");
      let finalCoverPhoto = coverUrls[0] || null;
      let finalCoverVideo: string | null = null;

      if (coverIsVideo && coverUrls[0]) {
        finalCoverVideo = coverUrls[0];
        if (coverThumbnailFile.length > 0) {
          const thumbUrls = await uploadMedia(coverThumbnailFile, "business_cover");
          finalCoverPhoto = thumbUrls[0] || null;
        } else {
          finalCoverPhoto = null;
        }
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

      // Build service areas for mobile_service
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
        slug: slug || generateSlug(businessName),
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
        logo_url: logoUrls[0] || undefined,
        cover_photo: finalCoverPhoto || undefined,
        cover_video: finalCoverVideo || undefined,
        services_offered: services.length > 0 ? services : undefined,
        service_areas: serviceAreas,
        operating_hours: Object.keys(operatingHours).length > 0 ? operatingHours : undefined,
        payment_methods_accepted: paymentMethods.length > 0 ? paymentMethods : undefined,
        delivery_options: deliveryOptions.length > 0 ? deliveryOptions : undefined,
        social_links: Object.keys(socialLinks).length > 0 ? socialLinks : undefined,
      };

      const res = await fetch("/api/businesses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        toast({
          title: "Failed to create business",
          description: data.error || "Please check your inputs and try again.",
          variant: "destructive",
        });
        return;
      }

      toast({ title: "Business created successfully!" });
      router.push("/dashboard/businesses");
    } catch (e: unknown) {
      toast({
        title: "Something went wrong",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <Header isAuthenticated />

      <main className="flex-1">
        <div className="container-page py-8">
          <div className="max-w-3xl mx-auto space-y-6">
            <PageHeader
              title="Create a Business"
              description="Set up your Mzansi Business profile on VerifyMzansi."
              breadcrumbs={[
                { label: "Dashboard", href: "/dashboard" },
                { label: "Create Post", href: "/post/create" },
                { label: "Business" },
              ]}
            />

            {/* Info Card */}
            <Card className="border-brand-blue/50 bg-brand-blue/5">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-brand-blue">
                  <Info className="h-5 w-5" />
                  What is Mzansi Business?
                </CardTitle>
                <CardDescription className="text-foreground/80">
                  Mzansi Business is your professional online presence. Whether you run a mall
                  store, home business, mobile service, or online shop — create your business
                  profile and connect with customers across South Africa.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="text-sm space-y-2 text-muted-foreground">
                  <li className="flex items-start gap-2">
                    <Building2 className="h-4 w-4 mt-0.5 text-brand-blue" /> Showcase your brand
                    with a dedicated logo, cover media, and description.
                  </li>
                  <li className="flex items-start gap-2">
                    <MapPin className="h-4 w-4 mt-0.5 text-brand-blue" /> Display your location,
                    operating hours, and service areas.
                  </li>
                  <li className="flex items-start gap-2">
                    <Search className="h-4 w-4 mt-0.5 text-brand-blue" /> Link promotions and offers
                    directly to your business profile.
                  </li>
                </ul>
              </CardContent>
            </Card>

            <PlanGate area="MZANSI_BUSINESS">
              <form onSubmit={handleSubmit} className="space-y-6">
                {/* 1. Business Type */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Business Type</CardTitle>
                    <CardDescription>
                      What kind of business are you? This helps buyers find you.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {BUSINESS_TYPE_OPTIONS.map((option) => {
                        const Icon = option.icon;
                        const isSelected = businessType === option.value;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => setBusinessType(option.value)}
                            className={`p-4 rounded-lg border-2 text-left transition-all ${
                              isSelected
                                ? "border-brand-blue bg-brand-blue/5 ring-1 ring-brand-blue/20"
                                : "border-border hover:border-brand-blue/30"
                            }`}
                          >
                            <Icon
                              className={`h-6 w-6 mb-2 ${isSelected ? "text-brand-blue" : "text-muted-foreground"}`}
                            />
                            <p className="font-medium text-sm">{option.label}</p>
                            <p className="text-xs text-muted-foreground mt-1">
                              {option.description}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>

                {businessType && (
                  <>
                    {/* 2. Branding & Media */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg">Branding & Media</CardTitle>
                        <CardDescription>Upload your brand assets to stand out.</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <MediaUpload
                            label="Business Logo (1 max)"
                            maxFiles={1}
                            files={logoFile}
                            onChange={setLogoFile}
                            accept="image/*"
                          />
                          <MediaUpload
                            label="Cover Media (Video or Photo, 1 max)"
                            maxFiles={1}
                            files={coverFile}
                            onChange={setCoverFile}
                          />
                        </div>
                        {coverFile.length > 0 && coverFile[0]?.type.startsWith("video/") && (
                          <MediaUpload
                            label="Cover Thumbnail Image (1 max) — Shown before video plays"
                            maxFiles={1}
                            files={coverThumbnailFile}
                            onChange={setCoverThumbnailFile}
                            accept="image/*"
                          />
                        )}
                      </CardContent>
                    </Card>

                    {/* 3. Basic Information */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg">Basic Information</CardTitle>
                        <CardDescription>Tell customers about your business.</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-5">
                        <div className="space-y-2">
                          <Label htmlFor="businessName">
                            Business Name <span className="text-destructive">*</span>
                          </Label>
                          <Input
                            id="businessName"
                            value={businessName}
                            onChange={(e) => setBusinessName(e.target.value)}
                            placeholder="e.g. Nomsa's Fashion Boutique"
                            maxLength={100}
                            required
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="slug">
                            URL Slug <span className="text-destructive">*</span>
                          </Label>
                          <Input
                            id="slug"
                            value={slug}
                            onChange={(e) => {
                              setSlugManual(true);
                              setSlug(generateSlug(e.target.value));
                            }}
                            placeholder="your-business-name"
                            maxLength={60}
                            required
                          />
                          <p className="text-xs text-muted-foreground">
                            Only lowercase letters, numbers, and hyphens. Auto-generated from your
                            business name.
                          </p>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="description">About Your Business</Label>
                          <Textarea
                            id="description"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Describe your business, what you offer, and why customers should choose you..."
                            rows={5}
                            maxLength={3000}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="category">
                            Category <span className="text-destructive">*</span>
                          </Label>
                          <select
                            id="category"
                            aria-label="Category"
                            className={selectClass}
                            value={category}
                            onChange={(e) => setCategory(e.target.value)}
                            required
                          >
                            <option value="">Select a category...</option>
                            {BUSINESS_CATEGORIES.map((cat) => (
                              <option key={cat.value} value={cat.value}>
                                {cat.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </CardContent>
                    </Card>

                    {/* 4. Location */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg">Location</CardTitle>
                        <CardDescription>
                          {businessType === "mobile_service"
                            ? "Where are you based and where do you serve?"
                            : businessType === "online_only"
                              ? "Where is your business registered?"
                              : "Where can customers find you?"}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-5">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="province">
                              Province <span className="text-destructive">*</span>
                            </Label>
                            <select
                              id="province"
                              aria-label="Province"
                              className={selectClass}
                              value={province}
                              onChange={(e) => {
                                setProvince(e.target.value);
                                setCity("");
                              }}
                              required
                            >
                              <option value="">Select province...</option>
                              {provinces.map((p) => (
                                <option key={p} value={p}>
                                  {p}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="city">
                              City / Town <span className="text-destructive">*</span>
                            </Label>
                            <select
                              id="city"
                              aria-label="City / Town"
                              className={selectClass}
                              value={city}
                              onChange={(e) => setCity(e.target.value)}
                              disabled={!province}
                              required
                            >
                              <option value="">Select city...</option>
                              {cities.map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        {/* Mall Store specific fields */}
                        {businessType === "mall_store" && (
                          <div className="space-y-4 p-4 bg-muted/50 border rounded-lg">
                            <h4 className="text-sm font-semibold flex items-center gap-2">
                              <Store className="h-4 w-4 text-brand-blue" /> Mall Store Details
                            </h4>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              <div className="space-y-2">
                                <Label htmlFor="storeNumber">
                                  Store Number <span className="text-destructive">*</span>
                                </Label>
                                <Input
                                  id="storeNumber"
                                  value={storeNumber}
                                  onChange={(e) => setStoreNumber(e.target.value)}
                                  placeholder="e.g. Store 42, Ground Floor"
                                  maxLength={20}
                                  required
                                />
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor="mallId">Mall (optional)</Label>
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
                          </div>
                        )}

                        {/* Mobile Service specific fields */}
                        {businessType === "mobile_service" && (
                          <div className="space-y-2 p-4 bg-muted/50 border rounded-lg">
                            <Label htmlFor="serviceAreas" className="flex items-center gap-2">
                              <MapPin className="h-4 w-4 text-brand-blue" />
                              Service Areas <span className="text-destructive">*</span>
                            </Label>
                            <Input
                              id="serviceAreas"
                              value={serviceAreasInput}
                              onChange={(e) => setServiceAreasInput(e.target.value)}
                              placeholder="e.g. Sandton, Randburg, Fourways, Midrand"
                            />
                            <p className="text-xs text-muted-foreground">
                              Comma-separated list of areas you serve.
                            </p>
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    {/* 5. Contact & Social */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg">Contact & Social Media</CardTitle>
                        <CardDescription>How customers can reach you.</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-6">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="phone" className="flex items-center gap-2">
                              <Phone className="w-4 h-4 text-muted-foreground" /> Phone Number
                            </Label>
                            <Input
                              id="phone"
                              value={phone}
                              onChange={(e) => setPhone(e.target.value)}
                              placeholder="082 000 0000"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="whatsapp" className="flex items-center gap-2">
                              <MessageCircle className="w-4 h-4 text-green-600" /> WhatsApp
                            </Label>
                            <Input
                              id="whatsapp"
                              value={whatsapp}
                              onChange={(e) => setWhatsapp(e.target.value)}
                              placeholder="082 000 0000"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="email" className="flex items-center gap-2">
                              <Mail className="w-4 h-4 text-muted-foreground" /> Email Address
                            </Label>
                            <Input
                              id="email"
                              type="email"
                              value={email}
                              onChange={(e) => setEmail(e.target.value)}
                              placeholder="contact@business.co.za"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="website">Website</Label>
                            <Input
                              id="website"
                              value={website}
                              onChange={(e) => setWebsite(e.target.value)}
                              placeholder="https://www.yourbusiness.co.za"
                            />
                          </div>
                        </div>

                        <div className="space-y-3 pt-2">
                          <h4 className="text-sm font-medium">Social Media Links</h4>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                              <Label
                                htmlFor="socialFacebook"
                                className="text-xs text-muted-foreground"
                              >
                                Facebook URL
                              </Label>
                              <Input
                                id="socialFacebook"
                                value={socialFacebook}
                                onChange={(e) => setSocialFacebook(e.target.value)}
                                placeholder="https://facebook.com/yourbusiness"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label
                                htmlFor="socialInstagram"
                                className="text-xs text-muted-foreground"
                              >
                                Instagram URL
                              </Label>
                              <Input
                                id="socialInstagram"
                                value={socialInstagram}
                                onChange={(e) => setSocialInstagram(e.target.value)}
                                placeholder="https://instagram.com/yourbusiness"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label
                                htmlFor="socialTwitter"
                                className="text-xs text-muted-foreground"
                              >
                                X (Twitter) URL
                              </Label>
                              <Input
                                id="socialTwitter"
                                value={socialTwitter}
                                onChange={(e) => setSocialTwitter(e.target.value)}
                                placeholder="https://x.com/yourbusiness"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label
                                htmlFor="socialTiktok"
                                className="text-xs text-muted-foreground"
                              >
                                TikTok URL
                              </Label>
                              <Input
                                id="socialTiktok"
                                value={socialTiktok}
                                onChange={(e) => setSocialTiktok(e.target.value)}
                                placeholder="https://tiktok.com/@yourbusiness"
                              />
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    {/* 6. Operating Hours */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg">Operating Hours</CardTitle>
                        <CardDescription>When are you available?</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                          <div className="space-y-1.5">
                            <Label htmlFor="hoursMonFri" className="text-xs text-muted-foreground">
                              Mon - Fri
                            </Label>
                            <Input
                              id="hoursMonFri"
                              value={hoursMonFri}
                              onChange={(e) => setHoursMonFri(e.target.value)}
                              placeholder="e.g. 09:00 - 17:00"
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
                              placeholder="e.g. 09:00 - 14:00"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor="hoursSun" className="text-xs text-muted-foreground">
                              Sunday / Public Holidays
                            </Label>
                            <Input
                              id="hoursSun"
                              value={hoursSun}
                              onChange={(e) => setHoursSun(e.target.value)}
                              placeholder="e.g. Closed"
                            />
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    {/* 7. Additional Details */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg">Additional Details</CardTitle>
                        <CardDescription>
                          Help customers understand your offering better.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-6">
                        {/* Services Offered */}
                        <div className="space-y-3">
                          <Label className="flex items-center gap-2">
                            <Wrench className="h-4 w-4 text-muted-foreground" />
                            Services Offered
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
                            <CreditCard className="h-4 w-4 text-muted-foreground" />
                            Payment Methods Accepted
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
                            <Truck className="h-4 w-4 text-muted-foreground" />
                            Delivery Options
                          </Label>
                          <div className="flex flex-wrap gap-3">
                            {DELIVERY_OPTIONS.map((option) => (
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
                      </CardContent>
                    </Card>

                    {/* Submit */}
                    <div className="flex justify-end pt-4">
                      <Button
                        type="submit"
                        size="lg"
                        className="w-full sm:w-auto px-8"
                        disabled={isSubmitting}
                      >
                        {isSubmitting && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
                        Submit Business for Review
                      </Button>
                    </div>
                  </>
                )}
              </form>
            </PlanGate>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
