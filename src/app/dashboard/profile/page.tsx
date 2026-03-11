"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, User, Save, ShieldCheck, KeyRound, Mail, Check, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { useToast } from "@/hooks/use-toast";
import { createClient } from "@/lib/supabase/client";
import { getProvinceNames, getCitiesForProvince } from "@/lib/constants/sa-provinces";
import { profileUpdateSchema } from "@/lib/validations/profile";
import { ACCOUNT_PHONE_IN_USE_ERROR } from "@/lib/utils/phone";
import { ACCOUNT_PROFILE_TABLE, readAccountVerificationStatus } from "@/lib/account/compat";

export default function ProfilePage() {
  const [email, setEmail] = useState("");
  const [verificationStatus, setVerificationStatus] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [province, setProvince] = useState("");
  const [city, setCity] = useState("");
  const [phone, setPhone] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const { toast } = useToast();
  const router = useRouter();
  const provinces = getProvinceNames();
  const cities = province ? getCitiesForProvince(province) : [];

  const passwordRequirements = [
    { label: "8+ characters", met: newPassword.length >= 8 },
    { label: "Lowercase letter", met: /[a-z]/.test(newPassword) },
    { label: "Uppercase letter", met: /[A-Z]/.test(newPassword) },
    { label: "Number", met: /[0-9]/.test(newPassword) },
  ];

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

      setEmail(user.email ?? "");

      const { data: profile } = await supabase
        .from(ACCOUNT_PROFILE_TABLE)
        .select(
          "display_name, bio, location_province, location_city, phone, account_verification_status, seller_verification_status"
        )
        .eq("user_id", user.id)
        .maybeSingle();

      if (profile) {
        setDisplayName(profile.display_name || "");
        setBio(profile.bio || "");
        setProvince(profile.location_province || "");
        setCity(profile.location_city || "");
        setPhone(profile.phone || "");
        setVerificationStatus(readAccountVerificationStatus(profile));
      }
      setIsLoading(false);
    }

    void load();
  }, [router]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();

    const result = profileUpdateSchema.safeParse({
      displayName,
      bio: bio || undefined,
      phone: phone || undefined,
      province: province || undefined,
      city: city || undefined,
    });

    if (!result.success) {
      toast({
        title: "Validation error",
        description: result.error.issues[0]?.message || "Please check your input",
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    try {
      const res = await fetch("/api/profile/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result.data),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 409) {
          toast({
            title: "Phone number already in use",
            description: ACCOUNT_PHONE_IN_USE_ERROR,
            variant: "destructive",
          });
          return;
        }
        toast({
          title: "Failed to save profile",
          description: data.error || "Please try again.",
          variant: "destructive",
        });
        return;
      }

      // Update local phone state with normalized value from server
      if (data.profile?.phone) {
        setPhone(data.profile.phone);
      }

      toast({ title: "Profile updated!", variant: "success" });
    } catch {
      toast({ title: "Something went wrong", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  }

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();

    if (!currentPassword) {
      toast({
        title: "Current password required",
        description: "Please enter your current password to verify your identity.",
        variant: "destructive",
      });
      return;
    }

    if (newPassword !== confirmNewPassword) {
      toast({
        title: "Passwords do not match",
        description: "New password and confirmation must match.",
        variant: "destructive",
      });
      return;
    }

    const allMet = passwordRequirements.every((r) => r.met);
    if (!allMet) {
      toast({
        title: "Password too weak",
        description: "Please meet all password requirements.",
        variant: "destructive",
      });
      return;
    }

    setIsChangingPassword(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, confirmNewPassword }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast({
          title: "Password change failed",
          description: data.error || "Please try again.",
          variant: "destructive",
        });
        return;
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
      toast({
        title: "Password changed",
        description: "Your password has been updated successfully.",
        variant: "success",
      });
    } catch {
      toast({ title: "Something went wrong", variant: "destructive" });
    } finally {
      setIsChangingPassword(false);
    }
  }

  function getVerificationBadge() {
    switch (verificationStatus) {
      case "verified":
        return (
          <Badge variant="default" className="bg-green-600">
            Verified
          </Badge>
        );
      case "pending_review":
        return <Badge variant="secondary">Pending Review</Badge>;
      case "rejected":
        return <Badge variant="destructive">Rejected</Badge>;
      default:
        return <Badge variant="outline">Incomplete</Badge>;
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
        description="Manage your account details, phone number, and password."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Profile" }]}
      />

      {/* Card 1: Account Info (read-only) */}
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Mail className="h-5 w-5" />
            Account Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Email</p>
              <p className="text-sm">{email}</p>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Verification Status</p>
              <div className="mt-1">{getVerificationBadge()}</div>
            </div>
            {verificationStatus !== "verified" && (
              <Button asChild variant="outline" size="sm">
                <Link href="/dashboard/verification">Start Verification</Link>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Card 2: Profile Details (editable) */}
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
                placeholder="How people see your name"
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
                placeholder="Tell people about yourself..."
                maxLength={300}
              />
              <p className="text-xs text-muted-foreground">{bio.length}/300</p>
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
                SA mobile format: 0XX XXX XXXX or +27XX XXX XXXX. Each phone number can only belong
                to one account.
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

      {/* Card 3: Change Password */}
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ShieldCheck className="h-5 w-5" />
            Change Password
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form noValidate onSubmit={handlePasswordChange} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="currentPassword">Current password</Label>
              <Input
                id="currentPassword"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter your current password"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="newPassword">New password</Label>
              <div className="relative">
                <Input
                  id="newPassword"
                  type={showNewPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Create a strong password"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  tabIndex={-1}
                  aria-label={showNewPassword ? "Hide password" : "Show password"}
                >
                  {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-1">
                {passwordRequirements.map((req) => (
                  <span
                    key={req.label}
                    className={`text-xs flex items-center gap-1 ${
                      req.met ? "text-brand-green" : "text-muted-foreground"
                    }`}
                  >
                    <Check className={`h-3 w-3 ${req.met ? "" : "opacity-30"}`} />
                    {req.label}
                  </span>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmNewPassword">Confirm new password</Label>
              <Input
                id="confirmNewPassword"
                type="password"
                autoComplete="new-password"
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                placeholder="Confirm your new password"
              />
            </div>

            <Button type="submit" className="gap-2" disabled={isChangingPassword}>
              {isChangingPassword ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <KeyRound className="h-4 w-4" />
              )}
              Change Password
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
