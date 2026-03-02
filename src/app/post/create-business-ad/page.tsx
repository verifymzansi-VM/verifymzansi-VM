"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Briefcase, Info, Phone, Mail, MessageCircle, MapPin, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { UploadArea } from "@/types/enums";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { PageHeader } from "@/components/layout/page-header";
import { useToast } from "@/hooks/use-toast";
import { createClient } from "@/lib/supabase/client";
import { MediaUpload } from "@/components/ui/media-upload";
import { PlanGate, usePlanMaxPhotos, usePlanVideoAllowed } from "@/components/billing/plan-gate";
import { getProvinceNames, getCitiesForProvince } from "@/lib/constants/sa-provinces";
import { BUSINESS_AD_CATEGORIES } from "@/lib/constants/categories";

export default function CreateBusinessAdPage() {
  // Basic Info
  const [businessName, setBusinessName] = useState("");
  const [tagline, setTagline] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");

  // Services & Areas
  const [servicesInput, setServicesInput] = useState("");
  const [serviceArea, setServiceArea] = useState("");
  const [province, setProvince] = useState("");
  const [city, setCity] = useState("");

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

  // Media
  const [logoFile, setLogoFile] = useState<File[]>([]);
  const [coverFile, setCoverFile] = useState<File[]>([]);
  const [galleryFiles, setGalleryFiles] = useState<File[]>([]);
  const [videoFile, setVideoFile] = useState<File[]>([]);
  const [videoCoverFile, setVideoCoverFile] = useState<File[]>([]);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();
  const { toast } = useToast();
  const provinces = getProvinceNames();
  const cities = province ? getCitiesForProvince(province) : [];
  const maxPhotos = usePlanMaxPhotos("BUSINESS_ADS");
  const videoAllowed = usePlanVideoAllowed("BUSINESS_ADS");

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
    if (!businessName || !description || !servicesInput || !category) {
      toast({ title: "Please fill in all required fields", variant: "destructive" });
      return;
    }

    setIsSubmitting(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push("/login");
        return;
      }

      const { data: profile } = await supabase
        .from("seller_profiles")
        .select("id")
        .eq("user_id", user.id)
        .single();

      if (!profile) {
        toast({ title: "Seller profile not found", variant: "destructive" });
        return;
      }

      // Process Services Map
      const servicesArray = servicesInput
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      // 1. Upload Logo
      const logoUrls = await uploadMedia(logoFile, "business_logo");
      const finalLogoUrl = logoUrls[0] || null;

      // 2. Upload Cover Photo
      const coverUrls = await uploadMedia(coverFile, "business_cover");
      const finalCoverUrl = coverUrls[0] || null;

      // 3. Upload Gallery & Video
      const galleryUrls = await uploadMedia(galleryFiles, "business");
      const videoUrls = await uploadMedia(videoFile, "business");

      const allPhotosAndVideos = [...galleryUrls, ...videoUrls];

      // Upload video cover image
      let videoThumbnailUrl: string | null = null;
      if (videoCoverFile.length > 0) {
        const coverThumbUrls = await uploadMedia(videoCoverFile, "business_cover");
        videoThumbnailUrl = coverThumbUrls[0] || null;
      }

      // Build Operating Hours
      const operatingHours = {
        Mon_Fri: hoursMonFri || "Closed",
        Sat: hoursSat || "Closed",
        Sun: hoursSun || "Closed",
      };

      // Build Social Links
      const socialLinks: Record<string, string> = {};
      if (socialFacebook) socialLinks["facebook"] = socialFacebook;
      if (socialInstagram) socialLinks["instagram"] = socialInstagram;
      if (socialTwitter) socialLinks["twitter"] = socialTwitter;
      if (socialTiktok) socialLinks["tiktok"] = socialTiktok;

      const { error } = await supabase.from("business_profiles").insert({
        seller_id: user.id,
        business_name: businessName,
        about: description,
        logo_url: finalLogoUrl,
        cover_photo: finalCoverUrl, // Note: backend can determine if video based on extension later
        photos: allPhotosAndVideos,
        services_offered: servicesArray,
        service_areas: serviceArea ? { areas: [serviceArea], province, city } : {},
        operating_hours: operatingHours,
        phone: phone || null,
        whatsapp: whatsapp || null,
        email: email || null,
        website: website || null,
        social_links: socialLinks,
        category: category,
        video_thumbnail: videoThumbnailUrl,
        status: "pending_moderation",
      });

      if (error) {
        toast({
          title: "Failed to create business ad",
          description: error.message,
          variant: "destructive",
        });
        return;
      }

      // Mark free post as used if no active paid entitlement
      const { data: activeEnt } = await supabase
        .from("entitlements")
        .select("id")
        .eq("user_id", user.id)
        .eq("area", "BUSINESS_ADS")
        .eq("status", "active")
        .limit(1)
        .maybeSingle();

      if (!activeEnt) {
        await supabase
          .from("free_posts_used")
          .upsert(
            { user_id: user.id, area: "BUSINESS_ADS" as const },
            { onConflict: "user_id,area" }
          );
      }

      toast({ title: "Business ad submitted for review!" });
      router.push("/dashboard/business-profiles");
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
              title="Create a Business Ad"
              description="Promote your services and generate leads on VerifyMzansi."
              breadcrumbs={[
                { label: "Dashboard", href: "/dashboard" },
                { label: "Create Post", href: "/post/create" },
                { label: "Business Ad" },
              ]}
            />

            {/* Educational Info Card */}
            <Card className="border-sky-700/50 bg-sky-700/5">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sky-700">
                  <Info className="h-5 w-5" />
                  What is a Business Ad?
                </CardTitle>
                <CardDescription className="text-foreground/80">
                  Business Ads are designed for service providers (like plumbers, caterers, tutors,
                  mechanics) who want to generate leads and showcase their professional services to
                  local customers.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="text-sm space-y-2 text-muted-foreground">
                  <li className="flex items-start gap-2">
                    <Briefcase className="h-4 w-4 mt-0.5 text-sky-600" /> Stand out with a
                    professional logo and eye-catching cover video/photo.
                  </li>
                  <li className="flex items-start gap-2">
                    <MapPin className="h-4 w-4 mt-0.5 text-sky-600" /> Highlight your service areas
                    and specialized offerings clearly.
                  </li>
                  <li className="flex items-start gap-2">
                    <Search className="h-4 w-4 mt-0.5 text-sky-600" /> Allow customers to reach you
                    easily via WhatsApp, Phone, or Email.
                  </li>
                </ul>
              </CardContent>
            </Card>

            <PlanGate area="BUSINESS_ADS">
              <form onSubmit={handleSubmit} className="space-y-6">
                {/* 1. Branding & Media */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Briefcase className="w-5 h-5 text-muted-foreground" /> Branding & Media
                    </CardTitle>
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
                        label="Cover Photo (Image, 1 max)"
                        maxFiles={1}
                        files={coverFile}
                        onChange={setCoverFile}
                        accept="image/*"
                      />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
                      <MediaUpload
                        label={`Promotional Video (1 max)${!videoAllowed ? " - Upgrade to unlock" : ""}`}
                        maxFiles={1}
                        files={videoFile}
                        onChange={setVideoFile}
                        accept="video/*"
                        disabled={!videoAllowed}
                      />
                      <MediaUpload
                        label={`Work Portfolio Gallery (max ${maxPhotos})`}
                        maxFiles={maxPhotos}
                        files={galleryFiles}
                        onChange={setGalleryFiles}
                        accept="image/*"
                      />
                    </div>
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
                  </CardContent>
                </Card>

                {/* 2. Basic Information */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Info className="w-5 h-5 text-muted-foreground" /> Business Details
                    </CardTitle>
                    <CardDescription>
                      Tell customers about your business and history.
                    </CardDescription>
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
                        placeholder="e.g. Sipho's Elite Plumbing"
                        maxLength={100}
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="tagline">Tagline</Label>
                      <Input
                        id="tagline"
                        value={tagline}
                        onChange={(e) => setTagline(e.target.value)}
                        placeholder="e.g. Reliable 24/7 plumbing services"
                        maxLength={150}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="description">
                        About the Business <span className="text-destructive">*</span>
                      </Label>
                      <textarea
                        id="description"
                        className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Describe your expertise, experience, and the specific value you provide..."
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="category">
                        Primary Category <span className="text-destructive">*</span>
                      </Label>
                      <select
                        id="category"
                        name="category"
                        aria-label="Primary Category"
                        title="Primary Category"
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        required
                      >
                        <option value="">Select a category...</option>
                        {BUSINESS_AD_CATEGORIES.map((cat) => (
                          <option key={cat.value} value={cat.value}>
                            {cat.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </CardContent>
                </Card>

                {/* 3. Services & Location */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <MapPin className="w-5 h-5 text-muted-foreground" /> Services & Areas
                    </CardTitle>
                    <CardDescription>What do you offer and where do you operate?</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="space-y-2">
                      <Label htmlFor="servicesInput">
                        Services Offered <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="servicesInput"
                        value={servicesInput}
                        onChange={(e) => setServicesInput(e.target.value)}
                        placeholder="e.g. Geyser repair, Blocked drains, Pipe installation (comma separated)"
                        required
                      />
                      <p className="text-xs text-muted-foreground">
                        Separate each service with a comma.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 border-t pt-4">
                      <div className="space-y-2">
                        <Label htmlFor="province">Base Province</Label>
                        <select
                          id="province"
                          title="Base Province"
                          aria-label="Base Province"
                          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          value={province}
                          onChange={(e) => {
                            setProvince(e.target.value);
                            setCity("");
                          }}
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
                        <Label htmlFor="city">Base City</Label>
                        <select
                          id="city"
                          title="Base City"
                          aria-label="Base City"
                          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          value={city}
                          onChange={(e) => setCity(e.target.value)}
                          disabled={!province}
                        >
                          <option value="">Select city...</option>
                          {cities.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-2 lg:col-span-1 sm:col-span-2">
                        <Label htmlFor="serviceArea">Specific Service Areas</Label>
                        <Input
                          id="serviceArea"
                          value={serviceArea}
                          onChange={(e) => setServiceArea(e.target.value)}
                          placeholder="e.g. Northern Suburbs, CBD"
                        />
                      </div>
                    </div>

                    <div className="space-y-3 pt-4 border-t">
                      <h4 className="text-sm font-medium">Operating Hours</h4>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="space-y-1.5">
                          <Label htmlFor="hoursMonFri" className="text-xs text-muted-foreground">
                            Mon - Fri
                          </Label>
                          <Input
                            id="hoursMonFri"
                            value={hoursMonFri}
                            onChange={(e) => setHoursMonFri(e.target.value)}
                            placeholder="e.g. 08:00 - 17:00"
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
                            placeholder="e.g. Closed or Emergency Only"
                          />
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* 4. Contact & Social */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Contact & Social Media</CardTitle>
                    <CardDescription>How clients can reach you online.</CardDescription>
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
                          placeholder="hello@business.co.za"
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

                    <div className="space-y-3 pt-2 border-t mt-4">
                      <h4 className="text-sm font-medium pt-2">Social Media Links</h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <Label htmlFor="socialFacebook" className="text-xs text-muted-foreground">
                            Facebook Profile
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
                            Instagram Profile
                          </Label>
                          <Input
                            id="socialInstagram"
                            value={socialInstagram}
                            onChange={(e) => setSocialInstagram(e.target.value)}
                            placeholder="https://instagram.com/yourbusiness"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="socialTwitter" className="text-xs text-muted-foreground">
                            X (Twitter) Profile
                          </Label>
                          <Input
                            id="socialTwitter"
                            value={socialTwitter}
                            onChange={(e) => setSocialTwitter(e.target.value)}
                            placeholder="https://x.com/yourbusiness"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="socialTiktok" className="text-xs text-muted-foreground">
                            TikTok Profile
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

                <div className="flex justify-end pt-4">
                  <Button
                    type="submit"
                    size="lg"
                    className="w-full sm:w-auto px-8"
                    disabled={isSubmitting}
                  >
                    {isSubmitting && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
                    Submit Business Ad for Review
                  </Button>
                </div>
              </form>
            </PlanGate>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
