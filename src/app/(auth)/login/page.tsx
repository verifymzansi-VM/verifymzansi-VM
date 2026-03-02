"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Eye, EyeOff, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TurnstileWidget } from "@/components/ui/turnstile-widget";
import { loginSchema, type LoginInput } from "@/lib/validations/auth";
import { useToast } from "@/hooks/use-toast";
import { sanitizeReturnUrl } from "@/lib/utils/navigation";

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [turnstileError, setTurnstileError] = useState(false);
  const [turnstileLoaded, setTurnstileLoaded] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  // Read query params client-side to avoid useSearchParams + Suspense,
  // ensuring the full form renders on first paint for Playwright assertions.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
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
  }, [toast]);

  // Turnstile widget load timeout — show error if it doesn't load in 15s
  // Skip in dev mode (dummy keys) since the widget auto-bypasses.
  const isTurnstileDev =
    !process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ||
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY === "dummy_site_key";

  useEffect(() => {
    if (isTurnstileDev || turnstileLoaded) return;
    timeoutRef.current = setTimeout(() => {
      setTurnstileError(true);
    }, 15000);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [isTurnstileDev, turnstileLoaded, retryKey]);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setValue,
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
      turnstileToken: "",
    },
  });

  const handleTurnstileSuccess = useCallback(
    (token: string) => {
      setTurnstileError(false);
      setTurnstileLoaded(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setValue("turnstileToken", token, { shouldValidate: true });
    },
    [setValue]
  );

  const handleTurnstileLoad = useCallback(() => {
    setTurnstileLoaded(true);
    setTurnstileError(false);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  const handleTurnstileError = useCallback(() => {
    setTurnstileError(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    // When Turnstile widget errors, set a bypass token so the server
    // can decide whether to allow the request without CAPTCHA.
    setValue("turnstileToken", "turnstile-unavailable", { shouldValidate: true });
  }, [setValue]);

  const handleRetry = useCallback(() => {
    setTurnstileError(false);
    setTurnstileLoaded(false);
    setValue("turnstileToken", "", { shouldValidate: false });
    TurnstileWidget.retry();
    setRetryKey((k) => k + 1);
  }, [setValue]);

  async function onSubmit(data: LoginInput) {
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
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
      const returnUrl = new URLSearchParams(window.location.search).get("returnUrl") || "/";
      router.push(sanitizeReturnUrl(returnUrl));
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
      <div className="space-y-2">
        <h1 className="font-display text-2xl font-bold tracking-tight">Sign in to your account</h1>
        <p className="text-sm text-muted-foreground">
          Enter your email and password to access your dashboard.
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
            {...register("email")}
          />
          {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
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
          {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
        </div>

        <TurnstileWidget
          key={retryKey}
          onSuccess={handleTurnstileSuccess}
          onError={handleTurnstileError}
          onLoad={handleTurnstileLoad}
        />
        {errors.turnstileToken && !turnstileError && (
          <p className="text-xs text-destructive">{errors.turnstileToken.message}</p>
        )}
        {turnstileError && (
          <div className="flex items-center gap-2">
            <p className="text-xs text-destructive">Security verification failed to load.</p>
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

        <Button type="submit" className="w-full" variant="trust-verified" disabled={isSubmitting}>
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
