"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowRight, CheckCircle2, Loader2, Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { useToast } from "@/hooks/use-toast";
import { getRestoredFoundationBrowserClient as createClient } from "@/lib/foundation/restored-browser-client";
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
  // Shown under the field it is about (the number, or the code), never as a
  // corner toast that is easy to miss. Cleared when that field is edited.
  const [fieldError, setFieldError] = useState<{ message: string; rateLimited: boolean } | null>(
    null
  );
  const { toast } = useToast();
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const returnUrl = sanitizeReturnUrl(
        new URLSearchParams(window.location.search).get("returnUrl")
      );
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!user) {
        router.push("/login");
        return;
      }

      const { data: profile } = await supabase
        .from(ACCOUNT_PROFILE_TABLE)
        .select("display_name, phone, pending_phone")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;

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
    return () => {
      cancelled = true;
    };
  }, [router]);

  // Resend countdown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setInterval(() => {
      setResendCooldown((c) => (c <= 1 ? 0 : c - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendCooldown]);

  // A "too many attempts" message stops showing once its wait is over.
  const shownError = fieldError?.rateLimited && resendCooldown === 0 ? null : fieldError;

  const showFieldError = useCallback(
    (message: string, rateLimited = false) => setFieldError({ message, rateLimited }),
    []
  );
  // Editing the field clears its message, except a wait that is still running.
  const clearFieldError = () => {
    if (!shownError?.rateLimited) setFieldError(null);
  };

  function getReturnUrl(): string {
    const returnUrl = new URLSearchParams(window.location.search).get("returnUrl");
    return returnUrl ? sanitizeReturnUrl(returnUrl) : "/dashboard";
  }

  function getContinueLabel(): string {
    return getReturnUrl() === "/dashboard" ? "Continue to dashboard" : "Continue";
  }

  /**
   * Send OTP to the entered phone number.
   * Called both by the "Send code" button and the "Resend code" button.
   */
  const doSendOtp = useCallback(async () => {
    const phoneResult = saPhoneSchema.safeParse(phone);
    if (!phoneResult.success) {
      showFieldError(phoneResult.error.issues[0]?.message || "Enter a valid SA mobile number");
      return;
    }

    setIsSending(true);
    setFieldError(null);
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
        const retryAfter = Number(data.retryAfter ?? res.headers?.get("Retry-After") ?? 0);
        if (retryAfter > 0) setResendCooldown(retryAfter);
        showFieldError(
          data.error || "Could not send the code. Please try again.",
          res.status === 429 && retryAfter > 0
        );
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
      showFieldError("Could not send the code. Check your connection and try again.");
    } finally {
      setIsSending(false);
    }
  }, [phone, showFieldError, toast]);

  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault();
    await doSendOtp();
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();

    if (!/^\d{6}$/.test(otpCode)) {
      showFieldError("Enter the 6-digit code sent to your phone.");
      return;
    }

    setIsVerifying(true);
    setFieldError(null);
    try {
      const res = await fetch("/api/otp/verify", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ phone, otp: otpCode }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };

      if (!res.ok) {
        // 409 here means another account verified the number meanwhile.
        showFieldError(
          res.status === 409
            ? ACCOUNT_PHONE_IN_USE_ERROR
            : data.error || "Invalid or expired code. Please try again."
        );
        return;
      }

      setOtpCode("");
      setStep("verified");
      toast({ title: "Phone number verified!", variant: "success" });
    } catch {
      showFieldError("Could not check the code. Check your connection and try again.");
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
        title="Verify your phone number"
        description="We send a 6-digit code by SMS to confirm the number is yours."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Verify phone" }]}
      />

      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Phone className="h-5 w-5" />
            {step === "phone"
              ? "Your mobile number"
              : step === "otp"
                ? "Enter the code"
                : "Phone number verified"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {step === "phone" ? (
            <>
              <form noValidate onSubmit={handleSendOtp} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="phone">SA mobile number *</Label>
                  <Input
                    id="phone"
                    type="tel"
                    inputMode="tel"
                    value={phone}
                    onChange={(e) => {
                      setPhone(sanitizeSaPhoneInput(e.target.value));
                      clearFieldError();
                    }}
                    placeholder="071 234 5678"
                    autoComplete="tel"
                    pattern="^(\+27|0)[6-8][0-9]{8}$"
                    title="Enter a valid SA mobile number (e.g. 071 234 5678)"
                    required
                    aria-invalid={shownError ? "true" : undefined}
                    aria-describedby={shownError ? "phone-error" : "phone-hint"}
                    className={cn(shownError && "border-destructive")}
                  />
                  {shownError ? (
                    <p id="phone-error" role="alert" className="inline-form-error flex gap-1.5">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>{shownError.message}</span>
                    </p>
                  ) : (
                    <p id="phone-hint" className="text-xs text-muted-foreground">
                      Format: 0XX XXX XXXX. One number per account.
                    </p>
                  )}
                </div>

                <Button
                  type="submit"
                  className="gap-2"
                  disabled={isSending || Boolean(shownError?.rateLimited)}
                >
                  {isSending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ArrowRight className="h-4 w-4" />
                  )}
                  Send code
                </Button>
              </form>
            </>
          ) : step === "otp" ? (
            <>
              <p className="mb-4 text-sm text-muted-foreground">
                We sent a 6-digit code to <strong>{formatPhone(phone)}</strong>. Enter it below.
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
                    onChange={(e) => {
                      setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                      clearFieldError();
                    }}
                    placeholder="123456"
                    autoComplete="one-time-code"
                    required
                    aria-invalid={shownError ? "true" : undefined}
                    aria-describedby={shownError ? "otp-error" : "otp-hint"}
                    className={cn(shownError && "border-destructive")}
                  />
                  {shownError ? (
                    <p id="otp-error" role="alert" className="inline-form-error flex gap-1.5">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>{shownError.message}</span>
                    </p>
                  ) : (
                    <p id="otp-hint" className="text-xs text-muted-foreground">
                      Valid for 5 minutes.
                    </p>
                  )}
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
                    onClick={() => {
                      setStep("phone");
                      setFieldError(null);
                    }}
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
