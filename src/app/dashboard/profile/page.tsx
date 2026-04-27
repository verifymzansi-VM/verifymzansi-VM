"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Loader2,
  User,
  Save,
  ShieldCheck,
  KeyRound,
  Mail,
  Check,
  Eye,
  EyeOff,
  Camera,
  LogOut,
  Trash2,
  Lock,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { createClient } from "@/lib/supabase/client";
import { getProvinceNames, getCitiesForProvince } from "@/lib/constants/sa-provinces";
import { summarizeVerification } from "@/lib/account/verification-summary";
import { profileUpdateSchema } from "@/lib/validations/profile";
import { ACCOUNT_PHONE_IN_USE_ERROR, sanitizeSaPhoneInput } from "@/lib/utils/phone";
import { ACCOUNT_PROFILE_TABLE } from "@/lib/account/compat";
import {
  checkCooldown,
  PHONE_CHANGE_COOLDOWN_MS,
  EMAIL_CHANGE_COOLDOWN_MS,
} from "@/lib/account/identity-policy";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import type { AccountVerificationStatus } from "@/types/enums";

type TabValue = "profile" | "security" | "account";

function getIdentityProviders(user: { app_metadata?: unknown; identities?: unknown }): string[] {
  const providers = new Set<string>();
  const appMetadata = (user.app_metadata ?? {}) as Record<string, unknown>;
  if (typeof appMetadata.provider === "string") {
    providers.add(appMetadata.provider);
  }

  if (Array.isArray(user.identities)) {
    for (const identity of user.identities) {
      if (identity && typeof identity === "object") {
        const provider = (identity as Record<string, unknown>).provider;
        if (typeof provider === "string") {
          providers.add(provider);
        }
      }
    }
  }

  return [...providers];
}

function hasPasswordProvider(user: { app_metadata?: unknown; identities?: unknown }): boolean {
  const providers = getIdentityProviders(user);
  return providers.length === 0 || providers.includes("email");
}

export default function ProfilePage() {
  const [email, setEmail] = useState("");
  const [verificationStatus, setVerificationStatus] = useState<AccountVerificationStatus | null>(
    null
  );
  const [displayName, setDisplayName] = useState("");
  const [legalFirstName, setLegalFirstName] = useState("");
  const [legalLastName, setLegalLastName] = useState("");
  const [bio, setBio] = useState("");
  const [province, setProvince] = useState("");
  const [city, setCity] = useState("");
  const [phone, setPhone] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [isSendingPasswordSetup, setIsSendingPasswordSetup] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [activeTab, setActiveTab] = useState<TabValue>("profile");
  const [isNameLocked, setIsNameLocked] = useState(false);
  const [isLocationLocked, setIsLocationLocked] = useState(false);
  const [phoneCooldownUntil, setPhoneCooldownUntil] = useState<Date | null>(null);
  const [emailCooldownUntil, setEmailCooldownUntil] = useState<Date | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [isChangingEmail, setIsChangingEmail] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteCurrentPassword, setDeleteCurrentPassword] = useState("");
  const [isPasswordAccount, setIsPasswordAccount] = useState(true);
  const [isDeleteVerifying, setIsDeleteVerifying] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const router = useRouter();
  const provinces = getProvinceNames();
  const cities = province ? getCitiesForProvince(province) : [];

  const initials = displayName
    ? displayName
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "U";

  const passwordRequirements = [
    { label: "8+ characters", met: newPassword.length >= 8 },
    { label: "Lowercase", met: /[a-z]/.test(newPassword) },
    { label: "Uppercase", met: /[A-Z]/.test(newPassword) },
    { label: "Number", met: /[0-9]/.test(newPassword) },
  ];

  // Read tab from URL hash on mount
  useEffect(() => {
    const hash = window.location.hash.replace("#", "") as TabValue;
    if (["profile", "security", "account"].includes(hash)) {
      queueMicrotask(() => {
        setActiveTab(hash);
      });
    }
  }, []);

  function handleTabChange(value: string) {
    const tab = value as TabValue;
    setActiveTab(tab);
    window.history.replaceState(null, "", `#${tab}`);
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push("/login");
        return;
      }

      const [{ data: profile }, { data: verificationSteps }] = await Promise.all([
        supabase
          .from(ACCOUNT_PROFILE_TABLE)
          .select(
            "display_name, legal_first_name, legal_last_name, bio, location_province, location_city, phone, account_verification_status, avatar_url, legal_name_locked_at, location_verified_at, contact_last_phone_change_at, contact_last_email_change_at"
          )
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase
          .from("verification_steps")
          .select("step_type, status, reviewed_at")
          .eq("user_id", user.id)
          .in("status", ["approved", "pending", "rejected", "needs_resubmission"]),
      ]);

      const verificationSummary = summarizeVerification(
        profile?.account_verification_status,
        verificationSteps
      );

      if (cancelled) {
        return;
      }

      queueMicrotask(() => {
        if (cancelled) {
          return;
        }

        setEmail(user.email ?? "");
        setIsPasswordAccount(hasPasswordProvider(user));
        if (profile) {
          setDisplayName(profile.display_name || "");
          setLegalFirstName(profile.legal_first_name || "");
          setLegalLastName(profile.legal_last_name || "");
          setBio(profile.bio || "");
          setProvince(profile.location_province || "");
          setCity(profile.location_city || "");
          setPhone(sanitizeSaPhoneInput(profile.phone || ""));
          setAvatarUrl(profile.avatar_url || null);
          setIsNameLocked(!!profile.legal_name_locked_at);
          setIsLocationLocked(!!profile.location_verified_at);
          setPhoneCooldownUntil(
            checkCooldown(profile.contact_last_phone_change_at ?? null, PHONE_CHANGE_COOLDOWN_MS)
          );
          setEmailCooldownUntil(
            checkCooldown(profile.contact_last_email_change_at ?? null, EMAIL_CHANGE_COOLDOWN_MS)
          );
        }
        setVerificationStatus(verificationSummary.accountVerificationStatus);
        setIsLoading(false);
      });
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
    const MAX_SIZE = 2 * 1024 * 1024; // 2 MB

    if (!ALLOWED_TYPES.includes(file.type)) {
      toast({
        title: "Invalid file type",
        description: "Please upload a JPEG, PNG, or WebP image.",
        variant: "destructive",
      });
      return;
    }
    if (file.size > MAX_SIZE) {
      toast({
        title: "File too large",
        description: "Avatar must be under 2 MB.",
        variant: "destructive",
      });
      return;
    }

    setIsUploadingAvatar(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/profile/avatar", {
        method: "POST",
        headers: withCsrfHeaders(),
        body: formData,
      });
      const data = await res.json();

      if (!res.ok) {
        toast({
          title: "Upload failed",
          description: data.error || "Please try again.",
          variant: "destructive",
        });
        return;
      }

      setAvatarUrl(data.avatarUrl + "?v=" + Date.now());
      toast({ title: "Avatar updated!", variant: "success" });
    } catch {
      toast({ title: "Something went wrong", variant: "destructive" });
    } finally {
      setIsUploadingAvatar(false);
      // Reset the input so re-selecting the same file triggers onChange
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

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
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
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
        if (res.status === 403 && data.code === "PHONE_REVERIFICATION_REQUIRED") {
          toast({
            title: "Verification required",
            description: data.error,
            variant: "destructive",
          });
          return;
        }
        if (res.status === 429 && data.code === "PHONE_COOLDOWN") {
          toast({
            title: "Phone change unavailable",
            description: data.error,
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

      if (data.profile?.phone) {
        setPhone(sanitizeSaPhoneInput(data.profile.phone));
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
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
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
      setShowPasswordForm(false);
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

  async function handlePasswordSetupEmail() {
    if (!email) {
      toast({
        title: "Email unavailable",
        description: "Please reload the page and try again.",
        variant: "destructive",
      });
      return;
    }

    setIsSendingPasswordSetup(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ email }),
      });
      const data = await res.json();

      if (!res.ok) {
        toast({
          title: "Password setup failed",
          description: data.error || "Please try again.",
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Password setup email sent",
        description: "Check your Gmail inbox for the secure password setup link.",
        variant: "success",
      });
    } catch {
      toast({ title: "Something went wrong", variant: "destructive" });
    } finally {
      setIsSendingPasswordSetup(false);
    }
  }

  async function handleEmailChange(e: React.FormEvent) {
    e.preventDefault();
    if (!newEmail) return;
    setIsChangingEmail(true);
    try {
      const res = await fetch("/api/account/email/change", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ newEmail }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({
          title: "Email change failed",
          description: data.error || "Please try again.",
          variant: "destructive",
        });
        return;
      }
      setShowEmailForm(false);
      setNewEmail("");
      setEmailCooldownUntil(new Date(Date.now() + EMAIL_CHANGE_COOLDOWN_MS));
      toast({
        title: "Confirmation sent",
        description: "Check your new email address to complete the change.",
        variant: "success",
      });
    } catch {
      toast({ title: "Something went wrong", variant: "destructive" });
    } finally {
      setIsChangingEmail(false);
    }
  }

  async function handleSignOut() {
    if (!window.confirm("Are you sure you want to sign out?")) return;
    setIsSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  function handleDeleteDialogOpenChange(open: boolean) {
    setIsDeleteDialogOpen(open);
    if (!open) {
      setDeleteConfirmation("");
      setDeleteCurrentPassword("");
      setIsDeleteVerifying(false);
    }
  }

  async function handleStartDeleteRequest() {
    if (!email) {
      toast({
        title: "Email unavailable",
        description: "Please reload the page and try again.",
        variant: "destructive",
      });
      return;
    }

    if (isPasswordAccount && !deleteCurrentPassword) {
      toast({
        title: "Current password required",
        description: "Enter your current password to confirm this request.",
        variant: "destructive",
      });
      return;
    }

    setIsDeleteVerifying(true);
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          confirmation: deleteConfirmation,
          currentPassword: isPasswordAccount ? deleteCurrentPassword : undefined,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        toast({
          title: "Account deletion failed",
          description: data.error || "Please try again.",
          variant: "destructive",
        });
        return;
      }

      handleDeleteDialogOpenChange(false);
      toast({
        title: "Account deleted",
        description: "Your account has been permanently deleted.",
        variant: "success",
      });
      router.push("/");
      router.refresh();
    } catch {
      toast({ title: "Something went wrong", variant: "destructive" });
    } finally {
      setIsDeleteVerifying(false);
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
    <div className="mx-auto max-w-xl space-y-4">
      {/* Compact header — no breadcrumbs on mobile */}
      <div>
        <h1 className="text-xl font-display font-bold">My Profile</h1>
        <p className="text-sm text-muted-foreground">
          Manage your details, security, and account settings.
        </p>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="grid h-12 w-full grid-cols-3 p-1">
          <TabsTrigger value="profile" className="h-11 gap-1.5 text-xs sm:text-sm">
            <User className="h-3.5 w-3.5" />
            Profile
          </TabsTrigger>
          <TabsTrigger value="security" className="h-11 gap-1.5 text-xs sm:text-sm">
            <ShieldCheck className="h-3.5 w-3.5" />
            Security
          </TabsTrigger>
          <TabsTrigger value="account" className="h-11 gap-1.5 text-xs sm:text-sm">
            <Mail className="h-3.5 w-3.5" />
            Account
          </TabsTrigger>
        </TabsList>

        {/* ─── Profile Tab ─── */}
        <TabsContent value="profile">
          <Card>
            <CardContent className="pt-6 space-y-5">
              {/* Avatar */}
              <div className="flex flex-col items-center gap-2">
                <button
                  type="button"
                  className="relative group rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="Change profile photo"
                >
                  <Avatar className="h-20 w-20 border-2 border-brand-gold">
                    {avatarUrl ? (
                      <AvatarImage src={avatarUrl} alt={displayName || "Avatar"} />
                    ) : null}
                    <AvatarFallback className="bg-brand-gold text-amber-950 text-lg font-bold">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                    {isUploadingAvatar ? (
                      <Loader2 className="h-5 w-5 animate-spin text-white" />
                    ) : (
                      <Camera className="h-5 w-5 text-white" />
                    )}
                  </span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  onChange={handleAvatarChange}
                  aria-label="Upload avatar image"
                />
                <p className="text-xs text-muted-foreground">Tap to change photo</p>
              </div>

              <Separator />

              {/* Profile form */}
              <form noValidate onSubmit={handleSave} className="space-y-3">
                {(legalFirstName || legalLastName) && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="flex items-center gap-1.5">
                        Legal first name <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                      </Label>
                      <div className="flex h-10 w-full items-center rounded-md border border-input bg-muted px-3 text-sm text-muted-foreground cursor-not-allowed">
                        {legalFirstName || "-"}
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="flex items-center gap-1.5">
                        Legal surname <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                      </Label>
                      <div className="flex h-10 w-full items-center rounded-md border border-input bg-muted px-3 text-sm text-muted-foreground cursor-not-allowed">
                        {legalLastName || "-"}
                      </div>
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="displayName" className="flex items-center gap-1.5">
                    Display Name *
                    {isNameLocked && (
                      <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-label="Locked" />
                    )}
                  </Label>
                  <Input
                    id="displayName"
                    value={displayName}
                    onChange={
                      isNameLocked ? undefined : (e) => setDisplayName(e.target.value.slice(0, 50))
                    }
                    readOnly={isNameLocked}
                    disabled={isNameLocked}
                    placeholder="Your public display name"
                    maxLength={50}
                    required
                    className={isNameLocked ? "bg-muted cursor-not-allowed" : undefined}
                  />
                  {isNameLocked ? (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Lock className="h-3 w-3" /> Set from your verified ID — cannot be changed.
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">{displayName.length}/50</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="bio">Bio</Label>
                  <textarea
                    id="bio"
                    className="flex min-h-[72px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    placeholder="Tell people about yourself..."
                    maxLength={300}
                  />
                  <p className="text-xs text-muted-foreground">{bio.length}/300</p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="phone">Phone</Label>
                  <Input
                    id="phone"
                    type="tel"
                    inputMode="tel"
                    value={phone}
                    onChange={
                      phoneCooldownUntil
                        ? undefined
                        : (e) => setPhone(sanitizeSaPhoneInput(e.target.value))
                    }
                    readOnly={!!phoneCooldownUntil}
                    disabled={!!phoneCooldownUntil}
                    placeholder="082 000 0000"
                    autoComplete="tel"
                    pattern="^(\+27|0)[6-8][0-9]{8}$"
                    title="Enter a valid SA mobile number (e.g. 071 234 5678)"
                    className={phoneCooldownUntil ? "bg-muted cursor-not-allowed" : undefined}
                  />
                  {phoneCooldownUntil ? (
                    <p className="text-xs text-amber-600 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />
                      Phone changes unlock on{" "}
                      {phoneCooldownUntil.toLocaleDateString("en-ZA", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}
                      .
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      SA mobile: 0XX XXX XXXX or +27XX XXX XXXX
                    </p>
                  )}
                </div>

                {isLocationLocked ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="flex items-center gap-1.5">
                        Province <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                      </Label>
                      <div className="flex h-10 w-full items-center rounded-md border border-input bg-muted px-3 text-sm text-muted-foreground cursor-not-allowed">
                        {province || "—"}
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="flex items-center gap-1.5">
                        City <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                      </Label>
                      <div className="flex h-10 w-full items-center rounded-md border border-input bg-muted px-3 text-sm text-muted-foreground cursor-not-allowed">
                        {city || "—"}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="province">Province</Label>
                      <select
                        id="province"
                        title="Select province"
                        className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
                    <div className="space-y-1.5">
                      <Label htmlFor="city">City</Label>
                      <select
                        id="city"
                        title="Select city"
                        className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
                )}

                <Button type="submit" size="sm" className="h-11 w-full gap-2" disabled={isSaving}>
                  {isSaving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  {isSaving ? "Saving..." : "Save Profile"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Security Tab ─── */}
        <TabsContent value="security">
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Password</p>
                  <p className="text-xs text-muted-foreground">
                    {isPasswordAccount
                      ? "Update your password to keep your account secure."
                      : "Set a password so you can also sign in with email."}
                  </p>
                </div>
                {isPasswordAccount && !showPasswordForm && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowPasswordForm(true)}
                    className="h-11 gap-1.5 px-3"
                  >
                    <KeyRound className="h-3.5 w-3.5" />
                    Change
                  </Button>
                )}
                {!isPasswordAccount && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handlePasswordSetupEmail}
                    disabled={isSendingPasswordSetup}
                    className="h-11 gap-1.5 px-3"
                  >
                    {isSendingPasswordSetup ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <KeyRound className="h-3.5 w-3.5" />
                    )}
                    {isSendingPasswordSetup ? "Sending..." : "Set Password"}
                  </Button>
                )}
              </div>

              {isPasswordAccount && showPasswordForm && (
                <>
                  <Separator />
                  <form noValidate onSubmit={handlePasswordChange} className="space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="currentPassword">Current password</Label>
                      <Input
                        id="currentPassword"
                        type="password"
                        autoComplete="current-password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        placeholder="Enter current password"
                      />
                    </div>

                    <div className="space-y-1.5">
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
                          className="absolute right-1 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          onClick={() => setShowNewPassword(!showNewPassword)}
                          aria-label={showNewPassword ? "Hide password" : "Show password"}
                        >
                          {showNewPassword ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
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

                    <div className="space-y-1.5">
                      <Label htmlFor="confirmNewPassword">Confirm new password</Label>
                      <Input
                        id="confirmNewPassword"
                        type="password"
                        autoComplete="new-password"
                        value={confirmNewPassword}
                        onChange={(e) => setConfirmNewPassword(e.target.value)}
                        placeholder="Confirm new password"
                      />
                    </div>

                    <div className="flex gap-2">
                      <Button
                        type="submit"
                        size="sm"
                        className="h-11 flex-1 gap-2"
                        disabled={isChangingPassword}
                      >
                        {isChangingPassword ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <KeyRound className="h-4 w-4" />
                        )}
                        Update Password
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-11 px-4"
                        onClick={() => {
                          setShowPasswordForm(false);
                          setCurrentPassword("");
                          setNewPassword("");
                          setConfirmNewPassword("");
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </form>
                </>
              )}

              <Separator />

              {/* Forgot password link */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Forgot password?</p>
                  <p className="text-xs text-muted-foreground">
                    Reset via email if you can&apos;t remember it.
                  </p>
                </div>
                <Button asChild variant="outline" size="sm" className="h-11">
                  <Link href="/forgot-password">Reset Password</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Account Tab ─── */}
        <TabsContent value="account">
          <Card>
            <CardContent className="pt-6 space-y-4">
              {/* Email */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-muted-foreground">Email</p>
                    <p className="text-sm truncate">{email}</p>
                  </div>
                  {!showEmailForm &&
                    (emailCooldownUntil ? (
                      <div className="text-right shrink-0 ml-3">
                        <p className="text-xs text-muted-foreground">Change available</p>
                        <p className="text-xs font-medium">
                          {emailCooldownUntil.toLocaleDateString("en-ZA", {
                            day: "numeric",
                            month: "short",
                          })}
                        </p>
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowEmailForm(true)}
                        className="ml-3 h-11 shrink-0 gap-1.5 px-3"
                      >
                        <Mail className="h-3.5 w-3.5" />
                        Change
                      </Button>
                    ))}
                </div>
                {showEmailForm && (
                  <form noValidate onSubmit={handleEmailChange} className="space-y-2">
                    <Input
                      type="email"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      placeholder="New email address"
                      autoComplete="email"
                      required
                    />
                    <div className="flex gap-2">
                      <Button
                        type="submit"
                        size="sm"
                        className="h-11 flex-1 gap-2"
                        disabled={isChangingEmail}
                      >
                        {isChangingEmail ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Mail className="h-4 w-4" />
                        )}
                        Send Confirmation
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-11"
                        onClick={() => {
                          setShowEmailForm(false);
                          setNewEmail("");
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </form>
                )}
              </div>

              {/* Verification status */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Verification</p>
                  <div className="mt-0.5">{getVerificationBadge()}</div>
                </div>
                {verificationStatus !== "verified" && (
                  <Button asChild variant="outline" size="sm" className="h-11">
                    <Link href="/dashboard/verification">Verify</Link>
                  </Button>
                )}
              </div>

              <Separator />

              {/* Sign out */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Sign out</p>
                  <p className="text-xs text-muted-foreground">Sign out on this device.</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSignOut}
                  disabled={isSigningOut}
                  className="h-11 gap-1.5"
                >
                  {isSigningOut ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <LogOut className="h-4 w-4" />
                  )}
                  {isSigningOut ? "Signing out…" : "Sign Out"}
                </Button>
              </div>

              <Separator />

              {/* Delete account */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-destructive">Delete account</p>
                  <p className="text-xs text-muted-foreground">
                    Permanently delete your account and all personal data. This cannot be undone.
                  </p>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-11 gap-1.5"
                  onClick={() => setIsDeleteDialogOpen(true)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </Button>
              </div>

              <Dialog open={isDeleteDialogOpen} onOpenChange={handleDeleteDialogOpenChange}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Confirm account deletion</DialogTitle>
                    <DialogDescription>
                      This permanently deletes your account and personal data. This action cannot be
                      undone.
                    </DialogDescription>
                  </DialogHeader>

                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">
                      Type <strong>DELETE</strong> to continue.
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Your account will be removed immediately after confirmation.
                    </p>
                    {isPasswordAccount && (
                      <div className="space-y-1">
                        <Label htmlFor="deleteCurrentPassword">Current password</Label>
                        <Input
                          id="deleteCurrentPassword"
                          type="password"
                          autoComplete="current-password"
                          value={deleteCurrentPassword}
                          onChange={(e) => setDeleteCurrentPassword(e.target.value)}
                          placeholder="Enter current password"
                        />
                      </div>
                    )}
                    <Input
                      value={deleteConfirmation}
                      onChange={(e) => setDeleteConfirmation(e.target.value)}
                      placeholder="Type DELETE"
                      aria-label="Type DELETE to confirm"
                    />
                  </div>

                  <DialogFooter>
                    <Button
                      variant="outline"
                      className="h-11"
                      onClick={() => handleDeleteDialogOpenChange(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={handleStartDeleteRequest}
                      disabled={
                        isDeleteVerifying ||
                        deleteConfirmation.trim().toUpperCase() !== "DELETE" ||
                        (isPasswordAccount && !deleteCurrentPassword)
                      }
                      className="h-11 gap-1.5"
                    >
                      {isDeleteVerifying ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                      {isDeleteVerifying ? "Verifying..." : "Continue"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
