"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Store, Info, Phone, Mail, MessageCircle, MapPin, Search } from "lucide-react";
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
import { PlanGate, usePlanMaxPhotos } from "@/components/billing/plan-gate";
import { getProvinceNames, getCitiesForProvince } from "@/lib/constants/sa-provinces";
import { MALL_SHOP_CATEGORIES } from "@/lib/constants/categories";

export default function CreateMallShopPage() {
  // Basic Info
  const [shopName, setShopName] = useState("");
  const [tagline, setTagline] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [mallId, setMallId] = useState("");
  const [malls, setMalls] = useState<{ id: string; name: string; location_city: string | null }[]>(
    []
  );

  // New Mall specific state
  const [isAddingNewMall, setIsAddingNewMall] = useState(false);
  const [newMallName, setNewMallName] = useState("");
  const [newMallProvince, setNewMallProvince] = useState("");
  const [newMallCity, setNewMallCity] = useState("");
  const [newMallCoverFile, setNewMallCoverFile] = useState<File[]>([]);

  useEffect(() => {
    async function fetchMalls() {
      const supabase = createClient();
      const { data } = await supabase.from("malls").select("id, name, location_city").order("name");
      if (data) setMalls(data);
    }
    fetchMalls();
  }, []);

  // Location
  const [province, setProvince] = useState("");
  const [city, setCity] = useState("");
  const [storeNumber, setStoreNumber] = useState("");

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
  const [coverThumbnailFile, setCoverThumbnailFile] = useState<File[]>([]);
  const [galleryFiles, setGalleryFiles] = useState<File[]>([]);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();
  const { toast } = useToast();
  const provinces = getProvinceNames();
  const cities = province ? getCitiesForProvince(province) : [];
  const maxPhotos = usePlanMaxPhotos("MALL_SHOPS");

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
    if (!shopName || !description || !category) {
      toast({ title: "Please fill in all required fields", variant: "destructive" });
      return;
    }

    if (mallId === "new") {
      if (!newMallName || !newMallProvince || !newMallCity) {
        toast({
          title: "Please fill in all required fields for the new mall",
          variant: "destructive",
        });
        return;
      }
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

      // 1. Upload Logo
      const logoUrls = await uploadMedia(logoFile, "storefront_logo");
      const finalLogoUrl = logoUrls[0] || null;

      // 2. Upload Cover
      const coverUrls = await uploadMedia(coverFile, "storefront_cover");
      const rawCoverUrl = coverUrls[0] || null;

      // 2b. When cover is a video, upload the thumbnail as the separate cover_photo
      const coverIsVideo = coverFile.length > 0 && coverFile[0].type.startsWith("video/");
      let finalCoverPhotoUrl = rawCoverUrl;
      let finalCoverVideoUrl: string | null = null;

      if (coverIsVideo && rawCoverUrl) {
        finalCoverVideoUrl = rawCoverUrl;
        if (coverThumbnailFile.length > 0) {
          const thumbUrls = await uploadMedia(coverThumbnailFile, "storefront_cover");
          finalCoverPhotoUrl = thumbUrls[0] || null;
        } else {
          finalCoverPhotoUrl = null;
        }
      }

      // 3. Upload Gallery
      const galleryUrls = await uploadMedia(galleryFiles, "storefront");

      // Build Operating Hours
      const operatingHours = {
        Mon_Fri: hoursMonFri || "Closed",
        Sat: hoursSat || "Closed",
        Sun: hoursSun || "Closed",
      };

      // Handle New Mall Creation
      let finalMallId = mallId === "new" ? null : mallId || null;

      if (mallId === "new") {
        const newMallCoverUrls = await uploadMedia(newMallCoverFile, "mall_cover");
        const finalNewMallCoverUrl = newMallCoverUrls[0] || null;

        const { data: newMall, error: newMallError } = await supabase
          .from("malls")
          .insert({
            name: newMallName,
            location_province: newMallProvince,
            location_city: newMallCity,
            cover_photo: finalNewMallCoverUrl,
          })
          .select("id")
          .single();

        if (newMallError) {
          toast({
            title: "Failed to register new mall",
            description: newMallError.message,
            variant: "destructive",
          });
          setIsSubmitting(false);
          return;
        }

        finalMallId = newMall.id;
      }

      // Build Social Links
      const socialLinks: Record<string, string> = {};
      if (socialFacebook) socialLinks["facebook"] = socialFacebook;
      if (socialInstagram) socialLinks["instagram"] = socialInstagram;
      if (socialTwitter) socialLinks["twitter"] = socialTwitter;
      if (socialTiktok) socialLinks["tiktok"] = socialTiktok;

      const { error } = await supabase.from("storefronts").insert({
        seller_id: user.id,
        mall_id: finalMallId,
        mall_name: shopName,
        description,
        logo_url: finalLogoUrl,
        cover_photo: finalCoverPhotoUrl,
        cover_video: finalCoverVideoUrl,
        photos: galleryUrls,
        store_number: storeNumber || "N/A",
        location_province: province || null,
        location_city: city || null,
        operating_hours: operatingHours,
        phone: phone || null,
        whatsapp: whatsapp || null,
        email: email || null,
        website: website || null,
        social_links: socialLinks,
        category: category,
        status: "pending_moderation",
      });

      if (error) {
        toast({
          title: "Failed to create mall shop",
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
        .eq("area", "MALL_SHOPS")
        .eq("status", "active")
        .limit(1)
        .maybeSingle();

      if (!activeEnt) {
        await supabase
          .from("free_posts_used")
          .upsert(
            { user_id: user.id, area: "MALL_SHOPS" as const },
            { onConflict: "user_id,area" }
          );
      }

      toast({ title: "Mall shop submitted for review!" });
      router.push("/dashboard/storefronts");
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
              title="Create a Mall Shop"
              description="Set up your premium brand presence on VerifyMzansi."
              breadcrumbs={[
                { label: "Dashboard", href: "/dashboard" },
                { label: "Create Post", href: "/post/create" },
                { label: "Mall Shop" },
              ]}
            />

            {/* Educational Info Card */}
            <Card className="border-brand-gold/50 bg-brand-gold/5">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-brand-gold">
                  <Info className="h-5 w-5" />
                  What is a Mall Shop?
                </CardTitle>
                <CardDescription className="text-foreground/80">
                  Mall Shops act as mini-websites for physical or digitally established brands. They
                  help buyers discover your business, view your catalog, and find your physical
                  store location easily.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="text-sm space-y-2 text-muted-foreground">
                  <li className="flex items-start gap-2">
                    <Store className="h-4 w-4 mt-0.5 text-brand-gold" /> Showcase your brand with a
                    dedicated Logo and Cover Media (Video/Photo).
                  </li>
                  <li className="flex items-start gap-2">
                    <MapPin className="h-4 w-4 mt-0.5 text-brand-gold" /> Display your physical
                    store number, operating hours, and location.
                  </li>
                  <li className="flex items-start gap-2">
                    <Search className="h-4 w-4 mt-0.5 text-brand-gold" /> Improve your
                    discoverability across VerifyMzansi and search engines.
                  </li>
                </ul>
              </CardContent>
            </Card>

            <PlanGate area="MALL_SHOPS">
              <form onSubmit={handleSubmit} className="space-y-6">
                {/* 1. Branding & Media */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Branding & Media</CardTitle>
                    <CardDescription>Upload your brand assets to stand out.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <MediaUpload
                        label="Brand Logo (1 max)"
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
                    {/* Cover Thumbnail — shown when cover is a video */}
                    {coverFile.length > 0 && coverFile[0]?.type.startsWith("video/") && (
                      <MediaUpload
                        label="Cover Thumbnail Image (1 max) — Shown before video plays"
                        maxFiles={1}
                        files={coverThumbnailFile}
                        onChange={setCoverThumbnailFile}
                        accept="image/*"
                      />
                    )}
                    <div className="pt-2">
                      <MediaUpload
                        label={`Photo Gallery (max ${maxPhotos})`}
                        maxFiles={maxPhotos}
                        files={galleryFiles}
                        onChange={setGalleryFiles}
                      />
                    </div>
                  </CardContent>
                </Card>

                {/* 2. Basic Information */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Basic Information</CardTitle>
                    <CardDescription>Tell customers about your shop.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <div className="space-y-2">
                      <Label htmlFor="shopName">
                        Shop Name <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="shopName"
                        value={shopName}
                        onChange={(e) => setShopName(e.target.value)}
                        placeholder="e.g. Nomsa's Fashion Boutique"
                        maxLength={100}
                        required
                      />
                    </div>

                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="mallId">Which Mall is your shop in? (Optional)</Label>
                        <select
                          id="mallId"
                          name="mallId"
                          aria-label="Mall Selection"
                          title="Mall Selection"
                          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          value={mallId}
                          onChange={(e) => {
                            setMallId(e.target.value);
                            setIsAddingNewMall(e.target.value === "new");
                          }}
                        >
                          <option value="">Select a mall or leave blank...</option>
                          <option value="new" className="font-semibold text-brand-gold-700">
                            Add New Mall (+)
                          </option>
                          {malls.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name} {m.location_city ? `(${m.location_city})` : ""}
                            </option>
                          ))}
                        </select>
                      </div>

                      {isAddingNewMall && (
                        <div className="p-4 bg-muted/50 border rounded-lg space-y-4 animate-in fade-in slide-in-from-top-2">
                          <h4 className="text-sm font-semibold flex items-center gap-2 text-brand-gold-700 dark:text-brand-gold-400">
                            <Store className="w-4 h-4" /> Register New Mall
                          </h4>

                          <div className="space-y-2">
                            <Label htmlFor="newMallName">
                              Mall Name <span className="text-destructive">*</span>
                            </Label>
                            <Input
                              id="newMallName"
                              value={newMallName}
                              onChange={(e) => setNewMallName(e.target.value)}
                              placeholder="e.g. Sandton City"
                              required={isAddingNewMall}
                            />
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <Label htmlFor="newMallProvince">
                                Province <span className="text-destructive">*</span>
                              </Label>
                              <select
                                id="newMallProvince"
                                title="Select province"
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                value={newMallProvince}
                                onChange={(e) => {
                                  setNewMallProvince(e.target.value);
                                  setNewMallCity("");
                                }}
                                required={isAddingNewMall}
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
                              <Label htmlFor="newMallCity">
                                City <span className="text-destructive">*</span>
                              </Label>
                              <select
                                id="newMallCity"
                                title="Select city"
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                value={newMallCity}
                                onChange={(e) => setNewMallCity(e.target.value)}
                                disabled={!newMallProvince}
                                required={isAddingNewMall}
                              >
                                <option value="">Select city...</option>
                                {newMallProvince &&
                                  getCitiesForProvince(newMallProvince).map((c) => (
                                    <option key={c} value={c}>
                                      {c}
                                    </option>
                                  ))}
                              </select>
                            </div>
                          </div>

                          <div className="pt-2">
                            <MediaUpload
                              label="Mall Cover Photo (Optional)"
                              maxFiles={1}
                              files={newMallCoverFile}
                              onChange={setNewMallCoverFile}
                              accept="image/*"
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="tagline">Tagline</Label>
                      <Input
                        id="tagline"
                        value={tagline}
                        onChange={(e) => setTagline(e.target.value)}
                        placeholder="A catchy phrase for your shop (e.g. Premium fashion for modern women)"
                        maxLength={150}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="description">
                        About the Shop <span className="text-destructive">*</span>
                      </Label>
                      <textarea
                        id="description"
                        className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Describe your shop, your history, and what you sell..."
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
                        {MALL_SHOP_CATEGORIES.map((cat) => (
                          <option key={cat.value} value={cat.value}>
                            {cat.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </CardContent>
                </Card>

                {/* 3. Location & Hours */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Location & Operating Hours</CardTitle>
                    <CardDescription>Where and when can customers visit you?</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="province">Province</Label>
                        <select
                          id="province"
                          title="Select province"
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
                        <Label htmlFor="city">City</Label>
                        <select
                          id="city"
                          title="Select city"
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
                        <Label htmlFor="storeNumber">Store Number / Address</Label>
                        <Input
                          id="storeNumber"
                          value={storeNumber}
                          onChange={(e) => setStoreNumber(e.target.value)}
                          placeholder="e.g. Store 42, Ground Floor"
                        />
                      </div>
                    </div>

                    <div className="space-y-3 pt-2">
                      <h4 className="text-sm font-medium">Operating Hours</h4>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="space-y-1.5">
                          <Label
                            htmlFor="mallHoursMonFri"
                            className="text-xs text-muted-foreground"
                          >
                            Mon - Fri
                          </Label>
                          <Input
                            id="mallHoursMonFri"
                            value={hoursMonFri}
                            onChange={(e) => setHoursMonFri(e.target.value)}
                            placeholder="e.g. 09:00 - 17:00"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="mallHoursSat" className="text-xs text-muted-foreground">
                            Saturday
                          </Label>
                          <Input
                            id="mallHoursSat"
                            value={hoursSat}
                            onChange={(e) => setHoursSat(e.target.value)}
                            placeholder="e.g. 09:00 - 14:00"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="mallHoursSun" className="text-xs text-muted-foreground">
                            Sunday / Public Holidays
                          </Label>
                          <Input
                            id="mallHoursSun"
                            value={hoursSun}
                            onChange={(e) => setHoursSun(e.target.value)}
                            placeholder="e.g. Closed"
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
                    <CardDescription>How buyers can reach you online.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="mallPhone" className="flex items-center gap-2">
                          <Phone className="w-4 h-4 text-muted-foreground" /> Phone Number
                        </Label>
                        <Input
                          id="mallPhone"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          placeholder="082 000 0000"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="mallWhatsapp" className="flex items-center gap-2">
                          <MessageCircle className="w-4 h-4 text-green-600" /> WhatsApp
                        </Label>
                        <Input
                          id="mallWhatsapp"
                          value={whatsapp}
                          onChange={(e) => setWhatsapp(e.target.value)}
                          placeholder="082 000 0000"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="mallEmail" className="flex items-center gap-2">
                          <Mail className="w-4 h-4 text-muted-foreground" /> Email Address
                        </Label>
                        <Input
                          id="mallEmail"
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="contact@shop.co.za"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="mallWebsite">Website</Label>
                        <Input
                          id="mallWebsite"
                          value={website}
                          onChange={(e) => setWebsite(e.target.value)}
                          placeholder="https://www.yourshop.co.za"
                        />
                      </div>
                    </div>

                    <div className="space-y-3 pt-2">
                      <h4 className="text-sm font-medium">Social Media Links</h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <Label
                            htmlFor="mallSocialFacebook"
                            className="text-xs text-muted-foreground"
                          >
                            Facebook Profile/Page URL
                          </Label>
                          <Input
                            id="mallSocialFacebook"
                            value={socialFacebook}
                            onChange={(e) => setSocialFacebook(e.target.value)}
                            placeholder="https://facebook.com/yourshop"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label
                            htmlFor="mallSocialInstagram"
                            className="text-xs text-muted-foreground"
                          >
                            Instagram Profile URL
                          </Label>
                          <Input
                            id="mallSocialInstagram"
                            value={socialInstagram}
                            onChange={(e) => setSocialInstagram(e.target.value)}
                            placeholder="https://instagram.com/yourshop"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label
                            htmlFor="mallSocialTwitter"
                            className="text-xs text-muted-foreground"
                          >
                            X (Twitter) Profile URL
                          </Label>
                          <Input
                            id="mallSocialTwitter"
                            value={socialTwitter}
                            onChange={(e) => setSocialTwitter(e.target.value)}
                            placeholder="https://x.com/yourshop"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label
                            htmlFor="mallSocialTiktok"
                            className="text-xs text-muted-foreground"
                          >
                            TikTok Profile URL
                          </Label>
                          <Input
                            id="mallSocialTiktok"
                            value={socialTiktok}
                            onChange={(e) => setSocialTiktok(e.target.value)}
                            placeholder="https://tiktok.com/@yourshop"
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
                    Submit Mall Shop for Review
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
