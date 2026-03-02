"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { Loader2, X } from "lucide-react";
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
import { MediaUpload } from "@/components/ui/media-upload";
import { getProvinceNames, getCitiesForProvince } from "@/lib/constants/sa-provinces";
import type { UploadArea } from "@/types/enums";
import { normalizeMediaUrl, normalizeMediaUrls } from "@/lib/utils/media-url";

export default function EditMallShopPage() {
  const params = useParams();
  const id = params.id as string;
  const [shopName, setShopName] = useState("");
  const [description, setDescription] = useState("");
  const [province, setProvince] = useState("");
  const [city, setCity] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [existingLogo, setExistingLogo] = useState<string | null>(null);
  const [existingCover, setExistingCover] = useState<string | null>(null);
  const [existingPhotos, setExistingPhotos] = useState<string[]>([]);
  const [newLogoFile, setNewLogoFile] = useState<File[]>([]);
  const [newCoverFile, setNewCoverFile] = useState<File[]>([]);
  const [newGalleryFiles, setNewGalleryFiles] = useState<File[]>([]);
  const router = useRouter();
  const { toast } = useToast();
  const provinces = getProvinceNames();
  const cities = province ? getCitiesForProvince(province) : [];

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data } = await supabase.from("storefronts").select("*").eq("id", id).single();

      if (!data) {
        toast({ title: "Mall shop not found", variant: "destructive" });
        router.push("/dashboard/storefronts");
        return;
      }

      setShopName(data.mall_name || "");
      setDescription(data.description || "");
      setProvince(data.location_province || "");
      setCity(data.location_city || "");
      setExistingLogo(data.logo_url ? normalizeMediaUrl(data.logo_url) : null);
      setExistingCover(
        data.cover_video || data.cover_photo
          ? normalizeMediaUrl(data.cover_video || data.cover_photo)
          : null
      );
      setExistingPhotos(
        normalizeMediaUrls(Array.isArray(data.photos) ? (data.photos as string[]) : [])
      );
      setIsLoading(false);
    }
    load();
  }, [id, router, toast]);

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
    if (!shopName || !description) {
      toast({ title: "Please fill in all required fields", variant: "destructive" });
      return;
    }

    setIsSubmitting(true);
    try {
      const logoUrls = await uploadMedia(newLogoFile, "storefront_logo");
      const coverUrls = await uploadMedia(newCoverFile, "storefront_cover");
      const galleryUrls = await uploadMedia(newGalleryFiles, "storefront");

      // Determine if cover is a video or photo
      const newCoverUrl = coverUrls[0] || existingCover;
      const isVideoFile = (url: string | null) =>
        url
          ? url
              .split("?")[0]
              .toLowerCase()
              .match(/\.(mp4|webm|ogg)$/) != null
          : false;
      const isCoverVideo = isVideoFile(newCoverUrl);

      const supabase = createClient();
      const { error } = await supabase
        .from("storefronts")
        .update({
          mall_name: shopName,
          description,
          location_province: province || null,
          location_city: city || null,
          logo_url: logoUrls[0] || existingLogo,
          cover_photo: isCoverVideo ? null : newCoverUrl,
          cover_video: isCoverVideo ? newCoverUrl : null,
          photos: [...existingPhotos, ...galleryUrls],
        })
        .eq("id", id);

      if (error) {
        toast({ title: "Failed to update", description: error.message, variant: "destructive" });
        return;
      }

      toast({ title: "Mall shop updated!" });
      router.push("/dashboard/storefronts");
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

  return (
    <div className="flex min-h-screen flex-col">
      <Header isAuthenticated />

      <main className="flex-1">
        <div className="container-page py-6">
          <div className="max-w-2xl mx-auto space-y-6">
            <PageHeader
              title="Edit Mall Shop"
              breadcrumbs={[
                { label: "Dashboard", href: "/dashboard" },
                { label: "Storefronts", href: "/dashboard/storefronts" },
                { label: "Edit" },
              ]}
            />

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Badge className="bg-brand-gold text-amber-950">Mall Shops</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="shopName">Shop Name *</Label>
                    <Input
                      id="shopName"
                      value={shopName}
                      onChange={(e) => setShopName(e.target.value)}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="description">Description *</Label>
                    <textarea
                      id="description"
                      title="Shop description"
                      placeholder="Describe your shop..."
                      className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      required
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="province">Province</Label>
                      <select
                        id="province"
                        title="Select province"
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
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
                      <Label htmlFor="city">City</Label>
                      <select
                        id="city"
                        title="Select city"
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
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

                  {/* ── Logo ────────────────────────────────── */}
                  <div className="space-y-2">
                    <Label>Shop Logo</Label>
                    {existingLogo && (
                      <div className="relative group w-24 h-24 rounded-md overflow-hidden border">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={existingLogo}
                          alt="Current logo"
                          className="w-full h-full object-cover"
                        />
                        <button
                          type="button"
                          title="Remove logo"
                          onClick={() => setExistingLogo(null)}
                          className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                    {!existingLogo && (
                      <MediaUpload
                        label="Upload Logo"
                        maxFiles={1}
                        files={newLogoFile}
                        onChange={setNewLogoFile}
                        accept="image/*"
                      />
                    )}
                  </div>

                  {/* ── Cover Media (Video or Photo) ────────────────────── */}
                  <div className="space-y-2">
                    <Label>Shop Cover Media</Label>
                    {existingCover && (
                      <div className="relative group rounded-md overflow-hidden border">
                        {existingCover
                          .split("?")[0]
                          .toLowerCase()
                          .match(/\.(mp4|webm|ogg)$/) ? (
                          <video
                            src={existingCover}
                            className="w-full aspect-[3/1] object-cover"
                            muted
                            playsInline
                            loop
                            autoPlay
                          />
                        ) : (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={existingCover}
                            alt="Current cover"
                            className="w-full aspect-[3/1] object-cover"
                          />
                        )}
                        <button
                          type="button"
                          title="Remove cover media"
                          onClick={() => setExistingCover(null)}
                          className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                    {!existingCover && (
                      <MediaUpload
                        label="Upload Cover Media (Video or Photo)"
                        maxFiles={1}
                        files={newCoverFile}
                        onChange={setNewCoverFile}
                      />
                    )}
                  </div>

                  {/* ── Gallery Photos ────────────────────────── */}
                  {existingPhotos.length > 0 && (
                    <div className="space-y-2">
                      <Label>Gallery Photos</Label>
                      <div className="grid grid-cols-3 gap-2">
                        {existingPhotos.map((url, i) => (
                          <div
                            key={url}
                            className="relative group rounded-md overflow-hidden border"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={url}
                              alt={`Gallery ${i + 1}`}
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
                  <MediaUpload
                    label={`Add Gallery Photos (max ${8 - existingPhotos.length} more)`}
                    maxFiles={8 - existingPhotos.length}
                    files={newGalleryFiles}
                    onChange={setNewGalleryFiles}
                    accept="image/*"
                    disabled={existingPhotos.length >= 8}
                  />
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
