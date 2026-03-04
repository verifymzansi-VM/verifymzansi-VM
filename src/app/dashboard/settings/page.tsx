"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { settingsDisplayNameSchema } from "@/lib/validations/profile";

export default function SettingsPage() {
  const [isLoading, setIsLoading] = useState(false);
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
        .from("seller_profiles")
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
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Settings"
        description="Manage your account and profile."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Settings" }]}
      />

      {/* Profile */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-display">Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={handleUpdateProfile} className="space-y-4 max-w-md">
            <div className="space-y-2">
              <Label htmlFor="displayName">Display name *</Label>
              <Input
                id="displayName"
                name="displayName"
                placeholder="Your name"
                maxLength={50}
                required
                minLength={2}
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
              <p className="text-xs text-muted-foreground">
                Sign out of your account on this device.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={handleSignOut}>
              Sign Out
            </Button>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Delete account</p>
              <p className="text-xs text-muted-foreground">
                Submit a DSAR request to delete all your data (POPIA).
              </p>
            </div>
            <Button variant="destructive" size="sm" asChild>
              <a href="/dsar">Request Deletion</a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
