"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { type z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TurnstileWidget } from "@/components/ui/turnstile-widget";
import { GoogleOAuthButton } from "@/components/ui/google-oauth-button";
import { AuthEmailField } from "@/components/auth/auth-email-field";
import { AuthPasswordField } from "@/components/auth/auth-password-field";
import { AuthTurnstileFeedback } from "@/components/auth/auth-turnstile-feedback";
import {
  getPasswordRequirements,
  PasswordRequirements,
} from "@/components/auth/password-requirements";
import { registerSchema, type RegisterInput } from "@/lib/validations/auth";
import { useToast } from "@/hooks/use-toast";
import {
  TURNSTILE_DOMAIN_MISCONFIGURED_MESSAGE,
  TURNSTILE_UNAVAILABLE_MESSAGE,
  getTurnstileClientState,
} from "@/lib/turnstile-client";
import { TURNSTILE_AUTH_PAGE_LOAD_TIMEOUT_MS } from "@/lib/turnstile-constants";
import { ensureCsrfTokenReady, withCsrfHeaders } from "@/lib/utils/csrf";
import { useHydrated } from "@/hooks/use-hydrated";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("AuthRegisterPage");

export default function RegisterPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [turnstileError, setTurnstileError] = useState<string | null>(null);
  const [turnstileLoaded, setTurnstileLoaded] = useState(false);
  const [turnstileRetryToken, setTurnstileRetryToken] = useState(0);
  const [turnstileUnavailableMessage, setTurnstileUnavailableMessage] = useState<string | null>(
    getTurnstileClientState().mode === "unavailable" ? TURNSTILE_UNAVAILABLE_MESSAGE : null
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
  const captchaUnavailable = Boolean(turnstileUnavailableMessage);
  const canRetryUnavailableCaptcha =
    turnstileState.mode === "configured" &&
    turnstileUnavailableMessage !== TURNSTILE_DOMAIN_MISCONFIGURED_MESSAGE;
  const skipTurnstileTimeout = turnstileState.mode !== "configured" || captchaUnavailable;

  const resetTurnstileChallenge = useCallback(() => {
    if (turnstileState.mode !== "configured") {
      return;
    }

    log.info("Resetting Turnstile challenge", {
      currentRetryToken: turnstileRetryToken,
    });

    setTurnstileError(null);
    setTurnstileLoaded(false);
    setTurnstileUnavailableMessage(null);
    setValue("turnstileToken", "", { shouldValidate: false });
    TurnstileWidget.retry();
    setTurnstileRetryToken((value) => value + 1);
  }, [setValue, turnstileRetryToken, turnstileState.mode]);

  useEffect(() => {
    if (skipTurnstileTimeout || turnstileLoaded) return;
    timeoutRef.current = setTimeout(() => {
      setTurnstileError("Security check failed to load. Please try again.");
      setTurnstileLoaded(false);
      setValue("turnstileToken", "", { shouldValidate: true });
    }, TURNSTILE_AUTH_PAGE_LOAD_TIMEOUT_MS);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [skipTurnstileTimeout, turnstileLoaded, turnstileRetryToken, setValue]);

  const handleTurnstileSuccess = useCallback(
    (token: string) => {
      setTurnstileUnavailableMessage(null);
      setTurnstileError(null);
      setTurnstileLoaded(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setValue("turnstileToken", token, { shouldValidate: true });
    },
    [setValue]
  );

  const handleTurnstileLoad = useCallback(() => {
    setTurnstileUnavailableMessage(null);
    setTurnstileError(null);
    setTurnstileLoaded(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    // Treat the widget as ready once Turnstile mounts. The token may still
    // arrive later or require user interaction, but the CAPTCHA itself is no
    // longer "failed to load" at that point.
  }, []);

  const handleTurnstileError = useCallback(() => {
    log.warn("Register Turnstile reported error callback");
    setTurnstileUnavailableMessage(null);
    setTurnstileError("Security check failed to load. Please try again.");
    setTurnstileLoaded(false);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setValue("turnstileToken", "", { shouldValidate: true });
  }, [setValue]);

  const handleTurnstileExpire = useCallback(() => {
    setTurnstileUnavailableMessage(null);
    setTurnstileError("Security check expired. Please verify again.");
    setValue("turnstileToken", "", { shouldValidate: true });
  }, [setValue]);

  const handleTurnstileUnavailable = useCallback(
    (message?: string) => {
      log.warn("Register Turnstile reported unavailable state");
      setTurnstileUnavailableMessage(message || TURNSTILE_UNAVAILABLE_MESSAGE);
      setTurnstileLoaded(false);
      setTurnstileError(message || TURNSTILE_UNAVAILABLE_MESSAGE);
      setValue("turnstileToken", "", { shouldValidate: false });
    },
    [setValue]
  );

  const handleRetry = useCallback(() => {
    resetTurnstileChallenge();
  }, [resetTurnstileChallenge]);

  const password = useWatch({ control, name: "password", defaultValue: "" });
  const requirements = getPasswordRequirements(password);

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
            <Label htmlFor="firstName">First name</Label>
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
            <Label htmlFor="lastName">Last name</Label>
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

        <AuthEmailField
          inputProps={register("email")}
          errorMessage={errors.email?.message}
          disabled={!isInteractive}
        />

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

        <AuthPasswordField
          id="password"
          label="Password"
          placeholder="Create a strong password"
          inputProps={register("password")}
          errorMessage={errors.password?.message}
          shown={showPassword}
          onToggleShown={() => setShowPassword(!showPassword)}
          describedBy="password-requirements"
          disabled={!isInteractive}
          toggleClassName="right-1 inline-flex h-11 w-11 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
        <PasswordRequirements id="password-requirements" requirements={requirements} />

        <AuthPasswordField
          id="confirmPassword"
          label="Confirm password"
          placeholder="Confirm your password"
          inputProps={register("confirmPassword")}
          errorMessage={errors.confirmPassword?.message}
          shown={showConfirmPassword}
          onToggleShown={() => setShowConfirmPassword(!showConfirmPassword)}
          disabled={!isInteractive}
          toggleClassName="right-1 inline-flex h-11 w-11 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />

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
        <AuthTurnstileFeedback
          tokenErrorMessage={errors.turnstileToken?.message}
          errorMessage={turnstileError}
          canRetryError={!captchaUnavailable || canRetryUnavailableCaptcha}
          onRetry={handleRetry}
        />

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
