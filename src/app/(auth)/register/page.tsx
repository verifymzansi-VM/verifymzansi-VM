"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Eye, EyeOff, Check, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TurnstileWidget } from "@/components/ui/turnstile-widget";
import { GoogleOAuthButton } from "@/components/ui/google-oauth-button";
import { registerSchema, type RegisterInput } from "@/lib/validations/auth";
import { useToast } from "@/hooks/use-toast";
import { TURNSTILE_UNAVAILABLE_MESSAGE, getTurnstileClientState } from "@/lib/turnstile-client";

export default function RegisterPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [turnstileError, setTurnstileError] = useState<string | null>(null);
  const [turnstileLoaded, setTurnstileLoaded] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [captchaUnavailable, setCaptchaUnavailable] = useState(
    getTurnstileClientState().mode === "unavailable"
  );
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    control,
    setValue,
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      displayName: "",
      email: "",
      phone: "",
      password: "",
      confirmPassword: "",
      acceptTerms: false as unknown as true,
      turnstileToken: "",
    },
  });

  // Turnstile widget load timeout — show error if it doesn't load in 15s.
  const turnstileState = getTurnstileClientState();
  const skipTurnstileTimeout = turnstileState.mode !== "configured" || captchaUnavailable;

  useEffect(() => {
    if (skipTurnstileTimeout || turnstileLoaded) return;
    timeoutRef.current = setTimeout(() => {
      setTurnstileError("Security verification failed to load.");
      setValue("turnstileToken", "turnstile-unavailable", { shouldValidate: true });
    }, 15000);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [skipTurnstileTimeout, turnstileLoaded, retryKey, setValue]);

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
    setTurnstileLoaded(true);
    setTurnstileError(null);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  const handleTurnstileError = useCallback(() => {
    setCaptchaUnavailable(false);
    setTurnstileError("CAPTCHA verification failed. Please try again.");
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setValue("turnstileToken", "turnstile-unavailable", { shouldValidate: true });
  }, [setValue]);

  const handleTurnstileExpire = useCallback(() => {
    setTurnstileError("CAPTCHA expired. Please verify again.");
    setValue("turnstileToken", "", { shouldValidate: true });
  }, [setValue]);

  const handleRetry = useCallback(() => {
    setCaptchaUnavailable(false);
    setTurnstileError(null);
    setTurnstileLoaded(false);
    setValue("turnstileToken", "", { shouldValidate: false });
    TurnstileWidget.retry();
    setRetryKey((k) => k + 1);
  }, [setValue]);

  const password = useWatch({ control, name: "password", defaultValue: "" });
  const requirements = [
    { label: "8+ characters", met: password.length >= 8 },
    { label: "Lowercase letter", met: /[a-z]/.test(password) },
    { label: "Uppercase letter", met: /[A-Z]/.test(password) },
    { label: "Number", met: /[0-9]/.test(password) },
  ];

  async function onSubmit(data: RegisterInput) {
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
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
      const encodedEmail = encodeURIComponent(data.email);
      router.push(`/login?registered=true&email=${encodedEmail}`);
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
          <span className="bg-background px-2 text-muted-foreground">or register with email</span>
        </div>
      </div>

      <form noValidate onSubmit={handleSubmit(onSubmit)} className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="displayName">Full name</Label>
          <Input
            id="displayName"
            placeholder="Thabo Mokoena"
            autoComplete="name"
            autoCapitalize="words"
            aria-invalid={!!errors.displayName}
            aria-describedby={errors.displayName ? "displayName-error" : undefined}
            {...register("displayName")}
          />
          {errors.displayName && (
            <p id="displayName-error" className="inline-form-error" role="alert">
              {errors.displayName.message}
            </p>
          )}
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
              aria-invalid={!!errors.password}
              aria-describedby={errors.password ? "password-error" : undefined}
              {...register("password")}
            />
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setShowPassword(!showPassword)}
              tabIndex={-1}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {/* Password strength indicators */}
          <div className="grid grid-cols-2 gap-1">
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
              aria-invalid={!!errors.confirmPassword}
              aria-describedby={errors.confirmPassword ? "confirmPassword-error" : undefined}
              {...register("confirmPassword")}
            />
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
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
            className="mt-1 rounded border-warm-300 dark:border-warm-600"
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
          key={retryKey}
          onSuccess={handleTurnstileSuccess}
          onError={handleTurnstileError}
          onExpire={handleTurnstileExpire}
          onLoad={handleTurnstileLoad}
          onUnavailable={() => {
            setCaptchaUnavailable(true);
            setTurnstileLoaded(false);
            setTurnstileError(TURNSTILE_UNAVAILABLE_MESSAGE);
            setValue("turnstileToken", "", { shouldValidate: false });
          }}
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
          disabled={isSubmitting || captchaUnavailable}
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
