"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, LogOut, Save } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { settingsDisplayNameSchema } from "@/lib/validations/profile";
import { ACCOUNT_PROFILE_WRITE_TABLE } from "@/lib/account/compat";

export default function SettingsPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  async function handleUpdateProfile(formData: FormData) {
    setIsLoading(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const displayName = ((formData.get("displayName") as string) || "").trim();

      // Validate with Zod schema
      const result = settingsDisplayNameSchema.safeParse({ displayName });
      if (!result.success) {
        const firstError = result.error.issues[0];
        toast({
          title: "Validation error",
          description: firstError?.message || "Please check your input",
          variant: "destructive",
        });
        return;
      }

      const { error } = await supabase
        .from(ACCOUNT_PROFILE_WRITE_TABLE)
        .update({ display_name: result.data.displayName })
        .eq("user_id", user.id);

      if (error) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
        return;
      }

      toast({ title: "Profile updated", variant: "success" });
      router.refresh();
    } finally {
      setIsLoading(false);
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

  return (
    <div className="space-y-4">
      <PageHeader
        title="Settings"
        description="Account and profile settings."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Settings" }]}
      />

      {/* Profile */}
      <Card>
        <CardHeader>
          <CardTitle as="h2" className="text-base font-display">
            Profile
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form noValidate action={handleUpdateProfile} className="space-y-4 max-w-md">
            <div className="space-y-2">
              <Label htmlFor="displayName">Display name *</Label>
              <Input
                id="displayName"
                name="displayName"
                placeholder="Your name"
                maxLength={50}
                required
                minLength={2}
                autoComplete="name"
                autoCapitalize="words"
              />
              <p className="text-xs text-muted-foreground">2–50 characters</p>
            </div>
            <Button
              type="submit"
              variant="trust-verified"
              size="sm"
              disabled={isLoading}
              className="gap-2"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Danger zone */}
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-base font-display text-destructive">Danger Zone</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Sign out</p>
              <p className="text-xs text-muted-foreground">Sign out on this device.</p>
            </div>
            <Button variant="outline" size="sm" onClick={handleSignOut} disabled={isSigningOut}>
              {isSigningOut ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" /> Signing out…
                </>
              ) : (
                <>
                  <LogOut className="h-4 w-4 mr-1" /> Sign Out
                </>
              )}
            </Button>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Delete account</p>
              <p className="text-xs text-muted-foreground">Delete your data under POPIA.</p>
            </div>
            <Button variant="destructive" size="sm" asChild>
              <Link href="/dsar">Request Deletion</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
