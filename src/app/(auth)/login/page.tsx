"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Mail, MailCheck, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TurnstileWidget } from "@/components/ui/turnstile-widget";
import { GoogleOAuthButton } from "@/components/ui/google-oauth-button";
import { AuthEmailField } from "@/components/auth/auth-email-field";
import { AuthPasswordField } from "@/components/auth/auth-password-field";
import {
  AuthDivider,
  AuthNotice,
  AuthPageHeader,
  AuthReassurance,
} from "@/components/auth/auth-ui";
import { AuthTurnstileFeedback } from "@/components/auth/auth-turnstile-feedback";
import { loginSchema, type LoginInput } from "@/lib/validations/auth";
import { useToast } from "@/hooks/use-toast";
import {
  TURNSTILE_DOMAIN_MISCONFIGURED_MESSAGE,
  TURNSTILE_UNAVAILABLE_MESSAGE,
  getTurnstileClientState,
} from "@/lib/turnstile-client";
import { TURNSTILE_AUTH_PAGE_LOAD_TIMEOUT_MS } from "@/lib/turnstile-constants";
import { sanitizeReturnUrl } from "@/lib/utils/navigation";
import { useHydrated } from "@/hooks/use-hydrated";
import { ensureCsrfTokenReady, withCsrfHeaders } from "@/lib/utils/csrf";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("AuthLoginPage");

const DEFAULT_SIGN_IN_DESCRIPTION = "Welcome back.";

/** Where people land after signing in, in words, keyed by route prefix. */
const RETURN_DESTINATIONS: ReadonlyArray<readonly [prefix: string, label: string]> = [
  ["/post", "your post"],
  ["/verification", "your verification"],
  ["/dashboard", "your dashboard"],
  ["/billing", "billing"],
];

function describeSignIn(returnUrl: string | null): string {
  if (!returnUrl) return DEFAULT_SIGN_IN_DESCRIPTION;

  const safeUrl = sanitizeReturnUrl(returnUrl);
  if (safeUrl === "/") return DEFAULT_SIGN_IN_DESCRIPTION;

  const match = RETURN_DESTINATIONS.find(
    ([prefix]) =>
      safeUrl === prefix || safeUrl.startsWith(`${prefix}/`) || safeUrl.startsWith(`${prefix}?`)
  );
  return `Welcome back. We'll take you to ${match ? match[1] : "the page you were on"} next.`;
}

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [turnstileError, setTurnstileError] = useState(false);
  const [turnstileLoaded, setTurnstileLoaded] = useState(false);
  const [turnstileRetryToken, setTurnstileRetryToken] = useState(0);
  const [turnstileUnavailableMessage, setTurnstileUnavailableMessage] = useState<string | null>(
    getTurnstileClientState().mode === "unavailable" ? TURNSTILE_UNAVAILABLE_MESSAGE : null
  );
  const [resendPromptVisible, setResendPromptVisible] = useState(false);
  const [emailConfirmedVisible, setEmailConfirmedVisible] = useState(false);
  const [resendingEmail, setResendingEmail] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isInteractive = useHydrated();
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

  const loginPageFlags = isInteractive
    ? (() => {
        const params = new URLSearchParams(window.location.search);
        return {
          justRegistered: params.get("registered") === "true",
          emailConfirmed: params.get("confirmed") === "true",
          error: params.get("error"),
          reason: params.get("reason"),
          returnUrl: params.get("returnUrl"),
        };
      })()
    : {
        justRegistered: false,
        emailConfirmed: false,
        error: null as string | null,
        reason: null as string | null,
        returnUrl: null as string | null,
      };
  const justRegistered = resendPromptVisible || loginPageFlags.justRegistered;
  const emailConfirmed = emailConfirmedVisible || loginPageFlags.emailConfirmed;
  const headerDescription = describeSignIn(loginPageFlags.returnUrl);

  // Read query params client-side to avoid useSearchParams + Suspense,
  // ensuring the full form renders on first paint for Playwright assertions.
  useEffect(() => {
    if (!isInteractive) {
      return;
    }

    if (loginPageFlags.emailConfirmed) {
      // Defer past the synchronous effect body to avoid a cascading render
      // (react-hooks/set-state-in-effect).
      queueMicrotask(() => {
        setEmailConfirmedVisible(true);
        // Clean URL to prevent re-flash on refresh/back navigation
        window.history.replaceState({}, "", window.location.pathname);
      });
    }

    if (loginPageFlags.error === "auth_callback_failed") {
      toast({
        title: "Authentication failed",
        description:
          loginPageFlags.reason === "missing_code"
            ? "Your verification link appears incomplete. Please request a new email and try again."
            : "Your sign-in link has expired or is invalid. Please try again.",
        variant: "destructive",
      });
    } else if (loginPageFlags.error === "auth_unavailable") {
      toast({
        title: "Service temporarily unavailable",
        description: "Authentication is currently unavailable. Please try again shortly.",
        variant: "destructive",
      });
    }
  }, [
    isInteractive,
    loginPageFlags.emailConfirmed,
    loginPageFlags.error,
    loginPageFlags.reason,
    toast,
  ]);

  // Turnstile widget load timeout — show error if it doesn't load in 15s.
  // Skip in dev/test environments where the widget may be slow or unavailable,
  // and in dev mode (dummy keys) since the widget auto-bypasses.
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

    setTurnstileLoaded(false);
    setTurnstileError(false);
    setTurnstileUnavailableMessage(null);
    setValue("turnstileToken", "", { shouldValidate: false });
    TurnstileWidget.retry();
    setTurnstileRetryToken((value) => value + 1);
  }, [setValue, turnstileRetryToken, turnstileState.mode]);

  useEffect(() => {
    if (skipTurnstileTimeout || turnstileLoaded) return;
    timeoutRef.current = setTimeout(() => {
      setTurnstileLoaded(false);
      setTurnstileError(true);
      setValue("turnstileToken", "", { shouldValidate: true });
    }, TURNSTILE_AUTH_PAGE_LOAD_TIMEOUT_MS);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [setValue, skipTurnstileTimeout, turnstileLoaded, turnstileRetryToken]);

  const handleTurnstileSuccess = useCallback(
    (token: string) => {
      setTurnstileUnavailableMessage(null);
      setTurnstileError(false);
      setTurnstileLoaded(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setValue("turnstileToken", token, { shouldValidate: true });
    },
    [setValue]
  );

  const handleTurnstileLoad = useCallback(() => {
    setTurnstileUnavailableMessage(null);
    setTurnstileError(false);
    setTurnstileLoaded(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    // Treat the widget as ready once Turnstile mounts. The token may still
    // arrive later or require user interaction, but the CAPTCHA itself is no
    // longer "failed to load" at that point.
  }, []);

  const handleTurnstileError = useCallback(() => {
    log.warn("Login Turnstile reported error callback");
    setTurnstileUnavailableMessage(null);
    setTurnstileLoaded(false);
    setTurnstileError(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setValue("turnstileToken", "", { shouldValidate: true });
  }, [setValue]);

  const handleTurnstileExpire = useCallback(() => {
    setTurnstileUnavailableMessage(null);
    setTurnstileLoaded(false);
    setTurnstileError(true);
    setValue("turnstileToken", "", { shouldValidate: true });
  }, [setValue]);

  const handleTurnstileUnavailable = useCallback(
    (message?: string) => {
      log.warn("Login Turnstile reported unavailable state");
      setTurnstileUnavailableMessage(message || TURNSTILE_UNAVAILABLE_MESSAGE);
      setTurnstileLoaded(false);
      setTurnstileError(false);
      setValue("turnstileToken", "", { shouldValidate: false });
    },
    [setValue]
  );

  const handleRetry = useCallback(() => {
    resetTurnstileChallenge();
  }, [resetTurnstileChallenge]);

  // Clean up cooldown interval on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current);
    };
  }, []);

  // Pre-bootstrap CSRF token on mount to avoid race condition where user
  // submits form before ensureCsrfTokenReady completes during handleSubmit.
  useEffect(() => {
    void ensureCsrfTokenReady();
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

    const email = getValues("email");
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
      const csrfToken = await ensureCsrfTokenReady();
      if (!csrfToken) {
        toast({
          title: "Security check failed",
          description: "Please refresh the page and try again.",
          variant: "destructive",
        });
        return;
      }

      const res = await fetch("/api/auth/resend-confirmation", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
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
      resetTurnstileChallenge();
    }
  }

  async function onSubmit(data: LoginInput) {
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

      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(data),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        resetTurnstileChallenge();

        if (result.code === "email_not_confirmed") {
          setResendPromptVisible(true);
        }

        toast({
          title: typeof result.error === "string" ? result.error : "Sign in failed",
          description:
            typeof result.error === "string"
              ? undefined
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
    <div className="space-y-6">
      {emailConfirmed && (
        <AuthNotice tone="success" icon={<MailCheck />} title="Email confirmed!" role="status">
          <p>Your email address has been verified. You can now sign in to your account.</p>
        </AuthNotice>
      )}

      {justRegistered && !emailConfirmed && (
        <AuthNotice tone="info" icon={<Mail />} title="Check your email" role="status">
          <p>We&apos;ve sent a confirmation link to your email address.</p>
          <Button
            type="button"
            variant="outline"
            className="h-11 gap-2 bg-card px-4"
            onClick={handleResendConfirmation}
            disabled={resendingEmail || resendCooldown > 0}
          >
            {resendingEmail ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="h-4 w-4" aria-hidden="true" />
            )}
            {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend confirmation"}
          </Button>
        </AuthNotice>
      )}

      <AuthPageHeader title="Sign in to your account" description={headerDescription} />

      <GoogleOAuthButton mode="login" />

      <AuthDivider>or</AuthDivider>

      <form noValidate onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        <AuthEmailField
          inputProps={register("email")}
          errorMessage={errors.email?.message}
          disabled={!isInteractive}
        />

        <AuthPasswordField
          id="password"
          label="Password"
          placeholder="Enter your password"
          autoComplete="current-password"
          inputProps={register("password")}
          errorMessage={errors.password?.message}
          shown={showPassword}
          onToggleShown={() => setShowPassword(!showPassword)}
          disabled={!isInteractive}
          labelAction={
            <Link
              href="/forgot-password"
              className="-my-2 inline-flex min-h-9 items-center rounded-md text-sm font-medium text-brand-green-700 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-brand-green-300"
            >
              Forgot password?
            </Link>
          }
        />

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
          unavailableMessage={captchaUnavailable ? turnstileUnavailableMessage : null}
          errorMessage={turnstileError ? "Security check failed to load. Please try again." : null}
          canRetryUnavailable={canRetryUnavailableCaptcha}
          canRetryError={Boolean(turnstileError)}
          onRetry={handleRetry}
        />

        <Button
          type="submit"
          size="lg"
          className="h-12 w-full text-[15px]"
          variant="trust-verified"
          disabled={!isInteractive || isSubmitting || captchaUnavailable || turnstileError}
          aria-busy={isSubmitting || undefined}
        >
          {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          Sign in
        </Button>
      </form>

      <p className="text-center text-[15px] text-muted-foreground">
        New here?{" "}
        <Link
          href="/register"
          className="font-semibold text-brand-green-700 underline underline-offset-4 hover:text-brand-green-800 dark:text-brand-green-300 dark:hover:text-brand-green-200"
        >
          Create an account
        </Link>
      </p>

      <AuthReassurance />
    </div>
  );
}
