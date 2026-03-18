"use client";

import { useState, useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Eye, EyeOff, RefreshCw, MailCheck, Mail, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TurnstileWidget } from "@/components/ui/turnstile-widget";
import { GoogleOAuthButton } from "@/components/ui/google-oauth-button";
import { loginSchema, type LoginInput } from "@/lib/validations/auth";
import { useToast } from "@/hooks/use-toast";
import { TURNSTILE_UNAVAILABLE_MESSAGE, getTurnstileClientState } from "@/lib/turnstile-client";
import { sanitizeReturnUrl } from "@/lib/utils/navigation";

function subscribeToHydrationState() {
  return () => {};
}

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [turnstileError, setTurnstileError] = useState(false);
  const [turnstileLoaded, setTurnstileLoaded] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [captchaUnavailable, setCaptchaUnavailable] = useState(
    getTurnstileClientState().mode === "unavailable"
  );
  const [justRegistered, setJustRegistered] = useState(false);
  const [emailNotConfirmed, setEmailNotConfirmed] = useState(false);
  const [emailConfirmed, setEmailConfirmed] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null);
  const [resendingEmail, setResendingEmail] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isInteractive = useSyncExternalStore(
    subscribeToHydrationState,
    () => true,
    () => false
  );
  const router = useRouter();
  const { toast } = useToast();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setValue,
    getValues,
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
      turnstileToken: "",
    },
  });

  // Read query params client-side to avoid useSearchParams + Suspense,
  // ensuring the full form renders on first paint for Playwright assertions.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("registered") === "true") {
      setJustRegistered(true);
    }
    if (params.get("confirmed") === "true") {
      setEmailConfirmed(true);
      // Clean URL to prevent re-flash on refresh/back navigation
      window.history.replaceState({}, "", window.location.pathname);
    }
    // Pre-fill email from query param (e.g. after registration redirect)
    const emailParam = params.get("email");
    if (emailParam) {
      setValue("email", emailParam);
      setRegisteredEmail(emailParam);
    }
    const error = params.get("error");
    if (error === "auth_callback_failed") {
      toast({
        title: "Authentication failed",
        description: "Your sign-in link has expired or is invalid. Please try again.",
        variant: "destructive",
      });
    } else if (error === "auth_unavailable") {
      toast({
        title: "Service temporarily unavailable",
        description: "Authentication is currently unavailable. Please try again shortly.",
        variant: "destructive",
      });
    }
  }, [toast, setValue]);

  // Turnstile widget load timeout — show error if it doesn't load in 15s.
  // Skip in dev/test environments where the widget may be slow or unavailable,
  // and in dev mode (dummy keys) since the widget auto-bypasses.
  const turnstileState = getTurnstileClientState();
  const skipTurnstileTimeout = turnstileState.mode !== "configured" || captchaUnavailable;

  useEffect(() => {
    if (skipTurnstileTimeout || turnstileLoaded) return;
    timeoutRef.current = setTimeout(() => {
      setTurnstileError(true);
    }, 15000);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [skipTurnstileTimeout, turnstileLoaded, retryKey]);

  const handleTurnstileSuccess = useCallback(
    (token: string) => {
      setCaptchaUnavailable(false);
      setTurnstileError(false);
      setTurnstileLoaded(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setValue("turnstileToken", token, { shouldValidate: true });
    },
    [setValue]
  );

  const handleTurnstileLoad = useCallback(() => {
    setCaptchaUnavailable(false);
    setTurnstileError(false);
    // Don't set turnstileLoaded or clear the timeout here — only
    // handleTurnstileSuccess should do that once a real token arrives.
    // This ensures the 15 s safety timeout still fires when the script
    // loads but the challenge iframe never renders (e.g. headless CI).
  }, []);

  const handleTurnstileError = useCallback(() => {
    setCaptchaUnavailable(false);
    setTurnstileError(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    // When Turnstile widget errors, set a bypass token so the server
    // can decide whether to allow the request without CAPTCHA.
    setValue("turnstileToken", "turnstile-unavailable", { shouldValidate: true });
  }, [setValue]);

  const handleRetry = useCallback(() => {
    setCaptchaUnavailable(false);
    setTurnstileError(false);
    setTurnstileLoaded(false);
    setValue("turnstileToken", "", { shouldValidate: false });
    TurnstileWidget.retry();
    setRetryKey((k) => k + 1);
  }, [setValue]);

  // Clean up cooldown interval on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current);
    };
  }, []);

  function startCooldown() {
    setResendCooldown(60);
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    cooldownRef.current = setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) {
          if (cooldownRef.current) clearInterval(cooldownRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  async function handleResendConfirmation() {
    if (resendCooldown > 0) return;

    const email = getValues("email") || registeredEmail;
    const turnstileToken = getValues("turnstileToken");
    if (!email) {
      toast({
        title: "Enter your email",
        description: "Please enter your email address in the field above, then try again.",
        variant: "destructive",
      });
      return;
    }
    if (!turnstileToken) {
      toast({
        title: "Complete the security check",
        description: "Please complete the CAPTCHA before resending the confirmation email.",
        variant: "destructive",
      });
      return;
    }
    setResendingEmail(true);
    try {
      const res = await fetch("/api/auth/resend-confirmation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, turnstileToken }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        toast({
          title: "Failed to resend",
          description:
            typeof data.error === "string"
              ? data.error
              : "Something went wrong. Please try again later.",
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Confirmation email sent",
        description: data.message || "Check your inbox for the new confirmation link.",
        variant: "success",
      });
      startCooldown();
    } catch {
      toast({
        title: "Failed to resend",
        description: "Something went wrong. Please try again later.",
        variant: "destructive",
      });
    } finally {
      setResendingEmail(false);
    }
  }

  async function onSubmit(data: LoginInput) {
    setEmailNotConfirmed(false);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (
          response.status === 403 &&
          typeof result.error === "string" &&
          /confirm|verif/i.test(result.error)
        ) {
          setEmailNotConfirmed(true);
        }
        toast({
          title: "Sign in failed",
          description:
            typeof result.error === "string"
              ? result.error
              : "Please check your credentials and try again.",
          variant: "destructive",
        });
        return;
      }

      toast({ title: "Welcome back!", variant: "success" });
      router.refresh();
      const returnUrl = sanitizeReturnUrl(
        new URLSearchParams(window.location.search).get("returnUrl")
      );
      router.push(returnUrl);
    } catch {
      toast({
        title: "Something went wrong",
        description: "Please try again later.",
        variant: "destructive",
      });
    }
  }

  return (
    <div className="space-y-4">
      {emailConfirmed && (
        <div className="flex items-start gap-3 rounded-lg border border-brand-green/30 bg-brand-green/5 p-4">
          <MailCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-green" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">Email confirmed!</p>
            <p className="text-sm text-muted-foreground">
              Your email address has been verified. You can now sign in to your account.
            </p>
          </div>
        </div>
      )}

      {justRegistered && !emailConfirmed && (
        <div className="flex items-start gap-3 rounded-lg border border-brand-green/30 bg-brand-green/5 p-4">
          <MailCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-green" />
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Check your email</p>
            <p className="text-sm text-muted-foreground">
              We&apos;ve sent a confirmation link
              {registeredEmail ? (
                <>
                  {" "}
                  to <strong className="text-foreground">{registeredEmail}</strong>
                </>
              ) : (
                <> to your email address</>
              )}
              . Please click the link to verify your account before signing in.
            </p>
            <button
              type="button"
              onClick={handleResendConfirmation}
              disabled={resendingEmail || resendCooldown > 0}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-green underline hover:text-brand-green/80 disabled:opacity-50 disabled:no-underline"
            >
              {resendingEmail ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              {resendCooldown > 0
                ? `Resend available in ${resendCooldown}s`
                : "Didn't receive it? Resend"}
            </button>
          </div>
        </div>
      )}

      {emailNotConfirmed && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
          <Mail className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Email not confirmed</p>
            <p className="text-sm text-muted-foreground">
              Your email address hasn&apos;t been confirmed yet. Check your inbox for the
              confirmation link, or request a new one.
            </p>
            <button
              type="button"
              onClick={handleResendConfirmation}
              disabled={resendingEmail || resendCooldown > 0}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-green underline hover:text-brand-green/80 disabled:opacity-50 disabled:no-underline"
            >
              {resendingEmail ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              {resendCooldown > 0
                ? `Resend available in ${resendCooldown}s`
                : "Resend confirmation email"}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-1">
        <h1 className="font-display text-2xl font-bold tracking-tight">Sign in to your account</h1>
      </div>

      <GoogleOAuthButton mode="login" />

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background px-2 text-muted-foreground">or continue with email</span>
        </div>
      </div>

      <form noValidate onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
            spellCheck={false}
            autoCapitalize="none"
            disabled={!isInteractive}
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? "email-error" : undefined}
            {...register("email")}
          />
          {errors.email && (
            <p id="email-error" className="inline-form-error" role="alert">
              {errors.email.message}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link href="/forgot-password" className="text-xs text-brand-green underline">
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              placeholder="••••••••"
              autoComplete="current-password"
              spellCheck={false}
              autoCapitalize="none"
              disabled={!isInteractive}
              aria-invalid={!!errors.password}
              aria-describedby={errors.password ? "password-error" : undefined}
              {...register("password")}
            />
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setShowPassword(!showPassword)}
              disabled={!isInteractive}
              tabIndex={-1}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {errors.password && (
            <p id="password-error" className="inline-form-error" role="alert">
              {errors.password.message}
            </p>
          )}
        </div>

        <TurnstileWidget
          key={retryKey}
          onSuccess={handleTurnstileSuccess}
          onError={handleTurnstileError}
          onLoad={handleTurnstileLoad}
          onUnavailable={() => {
            setCaptchaUnavailable(true);
            setTurnstileLoaded(false);
            setTurnstileError(false);
            setValue("turnstileToken", "", { shouldValidate: false });
          }}
        />
        {errors.turnstileToken && !turnstileError && (
          <p className="inline-form-error">{errors.turnstileToken.message}</p>
        )}
        {captchaUnavailable && <p className="inline-form-error">{TURNSTILE_UNAVAILABLE_MESSAGE}</p>}
        {turnstileError && (
          <div className="flex items-center gap-2">
            <p className="inline-form-error">Security check failed to load.</p>
            <button
              type="button"
              onClick={handleRetry}
              className="inline-flex items-center gap-1 text-xs font-medium text-brand-green underline hover:text-brand-green/80"
            >
              <RefreshCw className="h-3 w-3" />
              Retry
            </button>
          </div>
        )}

        <Button
          type="submit"
          className="w-full"
          variant="trust-verified"
          disabled={!isInteractive || isSubmitting || captchaUnavailable}
        >
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Sign In
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{" "}
        <Link href="/register" className="font-medium text-brand-green underline">
          Register
        </Link>
      </p>
    </div>
  );
}
