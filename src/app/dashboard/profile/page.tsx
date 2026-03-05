"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2, User, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { useToast } from "@/hooks/use-toast";
import { createClient } from "@/lib/supabase/client";
import { getProvinceNames, getCitiesForProvince } from "@/lib/constants/sa-provinces";
import { profileUpdateSchema } from "@/lib/validations/profile";

export default function ProfilePage() {
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [province, setProvince] = useState("");
  const [city, setCity] = useState("");
  const [phone, setPhone] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();
  const router = useRouter();
  const provinces = getProvinceNames();
  const cities = province ? getCitiesForProvince(province) : [];

  useEffect(() => {
    async function load() {
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
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      if (profile) {
        setDisplayName(profile.display_name || "");
        setBio(profile.bio || "");
        setProvince(profile.location_province || "");
        setCity(profile.location_city || "");
        setPhone(profile.phone || "");
      }
      setIsLoading(false);
    }
    load();
  }, [router]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();

    // Client-side validation with Zod schema
    const result = profileUpdateSchema.safeParse({
      displayName,
      bio: bio || undefined,
      phone: phone || undefined,
      province: province || undefined,
      city: city || undefined,
    });

    if (!result.success) {
      const firstError = result.error.issues[0];
      toast({
        title: "Validation error",
        description: firstError?.message || "Please check your input",
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase
        .from("seller_profiles")
        .update({
          display_name: result.data.displayName || null,
          bio: result.data.bio || null,
          location_province: result.data.province || null,
          location_city: result.data.city || null,
          phone: result.data.phone || null,
        })
        .eq("user_id", user.id);

      if (error) {
        toast({
          title: "Failed to save profile",
          description: error.message,
          variant: "destructive",
        });
        return;
      }

      toast({ title: "Profile updated!", variant: "success" });
    } catch {
      toast({ title: "Something went wrong", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="My Profile"
        description="Update your seller display profile."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Profile" }]}
      />

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <User className="h-5 w-5" />
            Profile Details
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form noValidate onSubmit={handleSave} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="displayName">Display Name *</Label>
              <Input
                id="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value.slice(0, 50))}
                placeholder="How buyers see your name"
                maxLength={50}
                required
              />
              <p className="text-xs text-muted-foreground">{displayName.length}/50</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bio">Bio</Label>
              <textarea
                id="bio"
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Tell buyers about yourself..."
                maxLength={300}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="082 000 0000"
                pattern="^(\+27|0)[6-8][0-9]{8}$"
                title="Enter a valid SA mobile number (e.g. 071 234 5678)"
              />
              <p className="text-xs text-muted-foreground">
                SA mobile format: 0XX XXX XXXX or +27XX XXX XXXX
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
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
            </div>

            <Button type="submit" className="gap-2" disabled={isSaving}>
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save Profile
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
