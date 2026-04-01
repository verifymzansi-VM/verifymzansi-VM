"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle2, Loader2, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { useToast } from "@/hooks/use-toast";
import { createClient } from "@/lib/supabase/client";
import { saPhoneSchema } from "@/lib/validations/shared";
import { ACCOUNT_PHONE_IN_USE_ERROR, sanitizeSaPhoneInput } from "@/lib/utils/phone";
import { formatPhone } from "@/lib/utils/format";
import { ACCOUNT_PROFILE_TABLE } from "@/lib/account/compat";
import { sanitizeReturnUrl } from "@/lib/utils/navigation";
import { withCsrfHeaders } from "@/lib/utils/csrf";

/** Step 1: enter phone and request OTP. Step 2: enter OTP code to verify. */
type Step = "phone" | "otp" | "verified";

const OTP_RESEND_COOLDOWN_SECONDS = 30;

export default function CompleteProfilePage() {
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const { toast } = useToast();
  const router = useRouter();

  useEffect(() => {
    async function load() {
      const returnUrl = sanitizeReturnUrl(
        new URLSearchParams(window.location.search).get("returnUrl")
      );
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
        .select("display_name, phone, pending_phone")
        .eq("user_id", user.id)
        .maybeSingle();

      if (profile?.phone) {
        // Canonical OTP-verified phone already exists — skip this step.
        router.push(returnUrl);
        return;
      }

      // Pre-fill from pending_phone so manual-registration users don't re-type their number.
      if (profile?.pending_phone) {
        setPhone(sanitizeSaPhoneInput(profile.pending_phone));
      }
      setIsLoading(false);
    }

    void load();
  }, [router]);

  // Resend countdown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setInterval(() => {
      setResendCooldown((c) => (c <= 1 ? 0 : c - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendCooldown]);

  function getReturnUrl(): string {
    return sanitizeReturnUrl(new URLSearchParams(window.location.search).get("returnUrl"));
  }

  function getContinueLabel(): string {
    return getReturnUrl() === "/dashboard" ? "Continue to dashboard" : "Continue";
  }

  /**
   * Send OTP to the entered phone number.
   * Called both by the "Send Verification Code" button and the "Resend code" button.
   */
  const doSendOtp = useCallback(async () => {
    const phoneResult = saPhoneSchema.safeParse(phone);
    if (!phoneResult.success) {
      toast({
        title: "Invalid phone number",
        description: phoneResult.error.issues[0]?.message || "Enter a valid SA mobile number",
        variant: "destructive",
      });
      return;
    }

    setIsSending(true);
    try {
      const res = await fetch("/api/otp/send", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ phone }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        retryAfter?: number;
      };

      if (!res.ok) {
        if (data.retryAfter) setResendCooldown(data.retryAfter);
        toast({
          title: "Could not send verification code",
          description: data.error || "Please try again.",
          variant: "destructive",
        });
        return;
      }

      setOtpCode("");
      setStep("otp");
      setResendCooldown(OTP_RESEND_COOLDOWN_SECONDS);
      toast({
        title: "Code sent",
        description: `A 6-digit code was sent to ${formatPhone(phone)}. Valid for 5 minutes.`,
        variant: "success",
      });
    } catch {
      toast({
        title: "Could not send verification code",
        description: "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSending(false);
    }
  }, [phone, toast]);

  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault();
    await doSendOtp();
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();

    if (!/^\d{6}$/.test(otpCode)) {
      toast({
        title: "Enter the 6-digit code",
        description: "Use the code sent to your phone.",
        variant: "destructive",
      });
      return;
    }

    setIsVerifying(true);
    try {
      const res = await fetch("/api/otp/verify", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ phone, otp: otpCode }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };

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
          title: "Verification failed",
          description: data.error || "Invalid or expired code. Please try again.",
          variant: "destructive",
        });
        return;
      }

      setOtpCode("");
      setStep("verified");
      toast({ title: "Phone number verified!", variant: "success" });
    } catch {
      toast({
        title: "Verification failed",
        description: "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsVerifying(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading your profile...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Verify Your Phone Number"
        description="Verify your phone number before you continue."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Verify Phone" }]}
      />

      <Card className="mx-auto w-full max-w-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Phone className="h-5 w-5" />
            {step === "phone"
              ? "Add Your Phone Number"
              : step === "otp"
                ? "Enter Verification Code"
                : "Phone Number Verified"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {step === "phone" ? (
            <>
              <p className="mb-4 text-sm text-muted-foreground">
                Enter your SA mobile number to continue.
              </p>
              <form noValidate onSubmit={handleSendOtp} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="phone">SA mobile number *</Label>
                  <Input
                    id="phone"
                    type="tel"
                    inputMode="tel"
                    value={phone}
                    onChange={(e) => setPhone(sanitizeSaPhoneInput(e.target.value))}
                    placeholder="071 234 5678"
                    autoComplete="tel"
                    pattern="^(\+27|0)[6-8][0-9]{8}$"
                    title="Enter a valid SA mobile number (e.g. 071 234 5678)"
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Format: 0XX XXX XXXX. One number per account.
                  </p>
                </div>

                <Button type="submit" className="gap-2" disabled={isSending}>
                  {isSending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ArrowRight className="h-4 w-4" />
                  )}
                  Send Verification Code
                </Button>
              </form>
            </>
          ) : step === "otp" ? (
            <>
              <p className="mb-4 text-sm text-muted-foreground">
                A 6-digit code was sent to <strong>{formatPhone(phone)}</strong>. Enter it below.
              </p>
              <form noValidate onSubmit={handleVerifyOtp} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="otp">6-digit code</Label>
                  <Input
                    id="otp"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="123456"
                    autoComplete="one-time-code"
                    required
                  />
                  <p className="text-xs text-muted-foreground">Valid for 5 minutes.</p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button type="submit" className="gap-2" disabled={isVerifying}>
                    {isVerifying ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" />
                    )}
                    Verify
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setStep("phone")}
                    disabled={isVerifying}
                  >
                    Change number
                  </Button>

                  {resendCooldown > 0 ? (
                    <p className="text-xs text-muted-foreground">Resend in {resendCooldown}s</p>
                  ) : (
                    <Button type="button" variant="ghost" disabled={isSending} onClick={doSendOtp}>
                      {isSending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                      Resend code
                    </Button>
                  )}
                </div>
              </form>
            </>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg border border-brand-green/30 bg-brand-green-50 p-4 text-sm text-brand-green-950">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 text-brand-green" />
                  <div className="space-y-1">
                    <p className="font-semibold">This phone number is verified.</p>
                    <p>
                      <strong>{formatPhone(phone)}</strong> has been verified successfully and is
                      now linked to this account.
                    </p>
                  </div>
                </div>
              </div>

              <Button type="button" className="gap-2" onClick={() => router.push(getReturnUrl())}>
                <ArrowRight className="h-4 w-4" />
                {getContinueLabel()}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
