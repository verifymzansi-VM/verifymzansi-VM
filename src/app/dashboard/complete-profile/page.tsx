"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Phone, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { useToast } from "@/hooks/use-toast";
import { createClient } from "@/lib/supabase/client";
import { saPhoneSchema } from "@/lib/validations/shared";
import { ACCOUNT_PHONE_IN_USE_ERROR } from "@/lib/utils/phone";
import { ACCOUNT_PROFILE_TABLE } from "@/lib/account/compat";

export default function CompleteProfilePage() {
  const [phone, setPhone] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const { toast } = useToast();
  const router = useRouter();

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
        .from(ACCOUNT_PROFILE_TABLE)
        .select("display_name, phone")
        .eq("user_id", user.id)
        .maybeSingle();

      if (profile?.phone) {
        // Phone already set — redirect to dashboard
        router.push("/dashboard");
        return;
      }

      setDisplayName(profile?.display_name || "");
      setIsLoading(false);
    }

    void load();
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const phoneResult = saPhoneSchema.safeParse(phone);
    if (!phoneResult.success) {
      toast({
        title: "Invalid phone number",
        description: phoneResult.error.issues[0]?.message || "Enter a valid SA mobile number",
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    try {
      const res = await fetch("/api/profile/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: displayName || "User",
          phone,
        }),
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
          title: "Failed to save",
          description: data.error || "Please try again.",
          variant: "destructive",
        });
        return;
      }

      toast({ title: "Phone number saved!", variant: "success" });
      router.push("/dashboard/profile");
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
        title="Complete Your Profile"
        description="Add your phone number to access all features."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Complete Profile" }]}
      />

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Phone className="h-5 w-5" />
            Add Your Phone Number
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">
            A valid South African mobile number is required to use marketplace features, verify your
            identity, and receive important notifications.
          </p>
          <form noValidate onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="phone">SA mobile number *</Label>
              <Input
                id="phone"
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="071 234 5678"
                autoComplete="tel"
                pattern="^(\+27|0)[6-8][0-9]{8}$"
                title="Enter a valid SA mobile number (e.g. 071 234 5678)"
                required
              />
              <p className="text-xs text-muted-foreground">
                Format: 0XX XXX XXXX or +27XX XXX XXXX. Each phone number can only belong to one
                account.
              </p>
            </div>

            <Button type="submit" className="gap-2" disabled={isSaving}>
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save &amp; Continue
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
