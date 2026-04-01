"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Eye, EyeOff, Check, RefreshCw } from "lucide-react";
import { type z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TurnstileWidget } from "@/components/ui/turnstile-widget";
import { GoogleOAuthButton } from "@/components/ui/google-oauth-button";
import { registerSchema, type RegisterInput } from "@/lib/validations/auth";
import { useToast } from "@/hooks/use-toast";
import { TURNSTILE_UNAVAILABLE_MESSAGE, getTurnstileClientState } from "@/lib/turnstile-client";
import { ensureCsrfTokenReady, withCsrfHeaders } from "@/lib/utils/csrf";
import { useHydrated } from "@/hooks/use-hydrated";

export default function RegisterPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [turnstileError, setTurnstileError] = useState<string | null>(null);
  const [turnstileLoaded, setTurnstileLoaded] = useState(false);
  const [turnstileRetryToken, setTurnstileRetryToken] = useState(0);
  const [captchaUnavailable, setCaptchaUnavailable] = useState(
    getTurnstileClientState().mode === "unavailable"
  );
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isInteractive = useHydrated();
  const router = useRouter();
  const { toast } = useToast();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    control,
    setValue,
  } = useForm<z.input<typeof registerSchema>, unknown, RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      password: "",
      confirmPassword: "",
      acceptTerms: false as unknown as true,
      turnstileToken: "",
    },
  });

  // Pre-bootstrap CSRF token on mount to avoid race condition where user
  // submits form before ensureCsrfTokenReady completes during handleSubmit.
  useEffect(() => {
    void ensureCsrfTokenReady();
  }, []);

  // Turnstile widget load timeout — show error if it doesn't load in 15s.
  const turnstileState = getTurnstileClientState();
  const skipTurnstileTimeout = turnstileState.mode !== "configured" || captchaUnavailable;

  const resetTurnstileChallenge = useCallback(() => {
    if (turnstileState.mode !== "configured") {
      return;
    }

    setTurnstileError(null);
    setTurnstileLoaded(false);
    setCaptchaUnavailable(false);
    setValue("turnstileToken", "", { shouldValidate: false });
    TurnstileWidget.retry();
    setTurnstileRetryToken((value) => value + 1);
  }, [setValue, turnstileState.mode]);

  useEffect(() => {
    if (skipTurnstileTimeout || turnstileLoaded) return;
    timeoutRef.current = setTimeout(() => {
      setTurnstileError("Security check failed to load. Please try again.");
      setTurnstileLoaded(false);
      setValue("turnstileToken", "", { shouldValidate: true });
    }, 15000);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [skipTurnstileTimeout, turnstileLoaded, turnstileRetryToken, setValue]);

  const handleTurnstileSuccess = useCallback(
    (token: string) => {
      setCaptchaUnavailable(false);
      setTurnstileError(null);
      setTurnstileLoaded(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setValue("turnstileToken", token, { shouldValidate: true });
    },
    [setValue]
  );

  const handleTurnstileLoad = useCallback(() => {
    setCaptchaUnavailable(false);
    setTurnstileError(null);
    // Don't set turnstileLoaded or clear the timeout here — only
    // handleTurnstileSuccess should do that once a real token arrives.
    // This ensures the 15 s safety timeout still fires when the script
    // loads but the challenge iframe never renders (e.g. headless CI).
  }, []);

  const handleTurnstileError = useCallback(() => {
    setCaptchaUnavailable(false);
    setTurnstileError("Security check failed to load. Please try again.");
    setTurnstileLoaded(false);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setValue("turnstileToken", "", { shouldValidate: true });
  }, [setValue]);

  const handleTurnstileExpire = useCallback(() => {
    setTurnstileError("Security check expired. Please verify again.");
    setValue("turnstileToken", "", { shouldValidate: true });
  }, [setValue]);

  const handleTurnstileUnavailable = useCallback(() => {
    setCaptchaUnavailable(true);
    setTurnstileLoaded(false);
    setTurnstileError(TURNSTILE_UNAVAILABLE_MESSAGE);
    setValue("turnstileToken", "", { shouldValidate: false });
  }, [setValue]);

  const handleRetry = useCallback(() => {
    resetTurnstileChallenge();
  }, [resetTurnstileChallenge]);

  const password = useWatch({ control, name: "password", defaultValue: "" });
  const requirements = [
    { label: "8+ chars", met: password.length >= 8 },
    { label: "Lowercase", met: /[a-z]/.test(password) },
    { label: "Uppercase", met: /[A-Z]/.test(password) },
    { label: "Number", met: /[0-9]/.test(password) },
  ];

  async function onSubmit(data: RegisterInput) {
    try {
      const csrfToken = await ensureCsrfTokenReady();
      if (!csrfToken) {
        toast({
          title: "Security check failed",
          description: "Please refresh the page and try again.",
          variant: "destructive",
        });
        return;
      }

      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(data),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        resetTurnstileChallenge();

        toast({
          title: "Registration failed",
          description: typeof result.error === "string" ? result.error : "Please try again.",
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Account created!",
        description: "Check your email to confirm, then complete your account verification.",
        variant: "success",
      });
      router.push("/login?registered=true");
    } catch {
      toast({
        title: "Something went wrong",
        description: "Please try again later.",
        variant: "destructive",
      });
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-bold tracking-tight">Create your account</h1>
      </div>

      <GoogleOAuthButton mode="register" />

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background px-2 text-muted-foreground">or continue with email</span>
        </div>
      </div>

      <form noValidate onSubmit={handleSubmit(onSubmit)} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="firstName">Name</Label>
            <Input
              id="firstName"
              placeholder="Thabo"
              autoComplete="given-name"
              autoCapitalize="words"
              disabled={!isInteractive}
              aria-invalid={!!errors.firstName}
              aria-describedby={errors.firstName ? "firstName-error" : undefined}
              {...register("firstName")}
            />
            {errors.firstName && (
              <p id="firstName-error" className="inline-form-error" role="alert">
                {errors.firstName.message}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="lastName">Surname</Label>
            <Input
              id="lastName"
              placeholder="Mokoena"
              autoComplete="family-name"
              autoCapitalize="words"
              disabled={!isInteractive}
              aria-invalid={!!errors.lastName}
              aria-describedby={errors.lastName ? "lastName-error" : undefined}
              {...register("lastName")}
            />
            {errors.lastName && (
              <p id="lastName-error" className="inline-form-error" role="alert">
                {errors.lastName.message}
              </p>
            )}
          </div>
        </div>

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
          <Label htmlFor="phone">SA mobile number</Label>
          <Input
            id="phone"
            type="tel"
            inputMode="tel"
            placeholder="071 234 5678"
            autoComplete="tel"
            disabled={!isInteractive}
            aria-invalid={!!errors.phone}
            aria-describedby={errors.phone ? "phone-error" : undefined}
            {...register("phone")}
          />
          {errors.phone && (
            <p id="phone-error" className="inline-form-error" role="alert">
              {errors.phone.message}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              placeholder="Create a strong password"
              autoComplete="new-password"
              spellCheck={false}
              autoCapitalize="none"
              disabled={!isInteractive}
              aria-invalid={!!errors.password}
              aria-describedby={
                ["password-requirements", errors.password ? "password-error" : undefined]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
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
          {/* Password strength indicators */}
          <div id="password-requirements" className="grid grid-cols-2 gap-1">
            {requirements.map((req) => (
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
          {errors.password && (
            <p id="password-error" className="inline-form-error" role="alert">
              {errors.password.message}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirm password</Label>
          <div className="relative">
            <Input
              id="confirmPassword"
              type={showConfirmPassword ? "text" : "password"}
              placeholder="Confirm your password"
              autoComplete="new-password"
              spellCheck={false}
              autoCapitalize="none"
              disabled={!isInteractive}
              aria-invalid={!!errors.confirmPassword}
              aria-describedby={errors.confirmPassword ? "confirmPassword-error" : undefined}
              {...register("confirmPassword")}
            />
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              disabled={!isInteractive}
              tabIndex={-1}
              aria-label={showConfirmPassword ? "Hide password" : "Show password"}
            >
              {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {errors.confirmPassword && (
            <p id="confirmPassword-error" className="inline-form-error" role="alert">
              {errors.confirmPassword.message}
            </p>
          )}
        </div>

        <div className="flex items-start gap-2">
          <input
            type="checkbox"
            id="acceptTerms"
            disabled={!isInteractive}
            className="mt-1 h-4 w-4 rounded border-warm-300 text-brand-green focus:ring-brand-green dark:border-warm-600 dark:bg-warm-900"
            {...register("acceptTerms")}
          />
          <Label htmlFor="acceptTerms" className="text-xs text-muted-foreground leading-tight">
            I agree to the{" "}
            <Link
              href="/terms"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-green underline"
            >
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link
              href="/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-green underline"
            >
              Privacy Policy
            </Link>
          </Label>
        </div>
        {errors.acceptTerms && (
          <p className="inline-form-error" role="alert">
            {errors.acceptTerms.message}
          </p>
        )}

        <TurnstileWidget
          retryToken={turnstileRetryToken}
          onSuccess={handleTurnstileSuccess}
          onError={handleTurnstileError}
          onExpire={handleTurnstileExpire}
          onLoad={handleTurnstileLoad}
          onUnavailable={handleTurnstileUnavailable}
        />
        {turnstileError && (
          <div className="flex items-center gap-2">
            <p className="inline-form-error">{turnstileError}</p>
            {!captchaUnavailable && (
              <button
                type="button"
                onClick={handleRetry}
                className="inline-flex items-center gap-1 text-xs font-medium text-brand-green underline hover:text-brand-green/80"
              >
                <RefreshCw className="h-3 w-3" />
                Retry
              </button>
            )}
          </div>
        )}
        {errors.turnstileToken && !turnstileError && (
          <p className="inline-form-error">{errors.turnstileToken.message}</p>
        )}

        <Button
          type="submit"
          className="w-full"
          variant="trust-verified"
          disabled={!isInteractive || isSubmitting || captchaUnavailable || Boolean(turnstileError)}
        >
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Create Account
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-brand-green underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
