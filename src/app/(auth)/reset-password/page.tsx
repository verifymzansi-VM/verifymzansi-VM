"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, KeyRound, Loader2, RotateCw, TimerOff, WifiOff } from "lucide-react";

import { AuthPasswordField } from "@/components/auth/auth-password-field";
import {
  getPasswordRequirements,
  PasswordRequirements,
} from "@/components/auth/password-requirements";
import { AuthIconTile, AuthPageHeader } from "@/components/auth/auth-ui";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { resetPasswordSchema, type ResetPasswordInput } from "@/lib/validations/auth";
import { useToast } from "@/hooks/use-toast";
import { ensureCsrfTokenReady, withCsrfHeaders } from "@/lib/utils/csrf";

/**
 * - checking: request in flight
 * - valid: recovery session confirmed
 * - invalid: the server answered and the link is expired/used/missing
 * - unavailable: the check itself failed (offline, timeout, 5xx) — retryable
 */
type RecoverySessionState = "checking" | "valid" | "invalid" | "unavailable";

const SESSION_CHECK_FAILED_MESSAGE =
  "We couldn't check your reset link. Check your connection and try again.";
const SUBMIT_NETWORK_FAILED_MESSAGE =
  "We couldn't save your new password. Check your connection and try again.";

async function fetchRecoverySessionState(): Promise<Exclude<RecoverySessionState, "checking">> {
  try {
    const res = await fetch("/api/auth/reset-password", { cache: "no-store" });
    // A rejected session is an auth answer, not an outage.
    if (res.status === 401 || res.status === 403) return "invalid";
    if (!res.ok) return "unavailable";
    const data: unknown = await res.json();
    if (!data || typeof data !== "object" || !("valid" in data)) return "unavailable";
    return (data as { valid: unknown }).valid === true ? "valid" : "invalid";
  } catch {
    return "unavailable";
  }
}

export default function ResetPasswordPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [sessionState, setSessionState] = useState<RecoverySessionState>("checking");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  const checkSession = useCallback(async () => {
    setSessionState("checking");
    setSessionState(await fetchRecoverySessionState());
  }, []);

  // Check if the user has a valid recovery session (set by the reset link)
  useEffect(() => {
    let cancelled = false;
    void fetchRecoverySessionState().then((state) => {
      if (!cancelled) setSessionState(state);
    });
    void ensureCsrfTokenReady();
    return () => {
      cancelled = true;
    };
  }, []);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    control,
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const password = useWatch({ control, name: "password", defaultValue: "" });
  const requirements = getPasswordRequirements(password);

  async function onSubmit(data: ResetPasswordInput) {
    setSubmitError(null);
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
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          password: data.password,
          confirmPassword: data.confirmPassword,
        }),
      });

      const result = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 401) {
          setSessionState("invalid");
          return;
        }
        toast({
          title: "Password reset failed",
          description: typeof result.error === "string" ? result.error : "Please try again.",
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Password updated!",
        description: "You can now sign in with your new password.",
        variant: "success",
      });
      router.push("/login");
    } catch {
      // Network failure: keep the typed passwords and show an inline,
      // persistent error so the user can simply press Save again.
      setSubmitError(SUBMIT_NETWORK_FAILED_MESSAGE);
    }
  }

  // Loading state while checking the recovery session
  if (sessionState === "checking") {
    return (
      <div aria-busy="true">
        <span className="sr-only" role="status">
          Checking your reset link…
        </span>
        <div aria-hidden="true" className="space-y-6">
          <div className="space-y-3">
            <Skeleton className="h-14 w-14 rounded-2xl" />
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-4 w-full max-w-xs" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-12 w-full rounded-xl" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-12 w-full rounded-xl" />
          </div>
          <Skeleton className="h-12 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  // The check itself failed (offline, timeout, server error): the link may be
  // fine, so offer a retry instead of telling the user it expired.
  if (sessionState === "unavailable") {
    return (
      <div className="space-y-6">
        <AuthPageHeader
          icon={
            <AuthIconTile tone="gold">
              <WifiOff />
            </AuthIconTile>
          }
          title="Couldn't check your link"
          description="Your reset link may still work."
        />
        <p
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {SESSION_CHECK_FAILED_MESSAGE}
        </p>
        <div className="flex flex-col gap-3">
          <Button
            type="button"
            variant="trust-verified"
            size="lg"
            className="h-12 w-full gap-2 text-[15px]"
            onClick={() => void checkSession()}
          >
            <RotateCw className="h-4 w-4" aria-hidden="true" />
            Retry
          </Button>
          <Button asChild variant="ghost" size="lg" className="h-12 w-full gap-2 text-[15px]">
            <Link href="/login">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back to sign in
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  // No valid session: the link expired, was already used, or was opened elsewhere
  if (sessionState === "invalid") {
    return (
      <div className="space-y-6">
        <AuthPageHeader
          icon={
            <AuthIconTile tone="gold">
              <TimerOff />
            </AuthIconTile>
          }
          title="Reset link expired"
          description="Request a new link to reset your password."
        />
        <div className="flex flex-col gap-3">
          <Button asChild variant="trust-verified" size="lg" className="h-12 w-full text-[15px]">
            <Link href="/forgot-password">Request a new link</Link>
          </Button>
          <Button asChild variant="ghost" size="lg" className="h-12 w-full gap-2 text-[15px]">
            <Link href="/login">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back to sign in
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AuthPageHeader
        icon={
          <AuthIconTile>
            <KeyRound />
          </AuthIconTile>
        }
        title="Set a new password"
        description="Use one you don't use anywhere else."
      />

      <form noValidate onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        <AuthPasswordField
          id="password"
          label="New password"
          placeholder="Create a strong password"
          inputProps={register("password")}
          errorMessage={errors.password?.message}
          shown={showPassword}
          onToggleShown={() => setShowPassword(!showPassword)}
          describedBy="password-requirements"
        >
          <PasswordRequirements id="password-requirements" requirements={requirements} />
        </AuthPasswordField>

        <AuthPasswordField
          id="confirmPassword"
          label="Confirm password"
          placeholder="Type your new password again"
          inputProps={register("confirmPassword")}
          errorMessage={errors.confirmPassword?.message}
          shown={showConfirmPassword}
          onToggleShown={() => setShowConfirmPassword(!showConfirmPassword)}
          toggleLabel={{ show: "Show confirm password", hide: "Hide confirm password" }}
        />

        {submitError && (
          <p
            role="alert"
            className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
          >
            {submitError}
          </p>
        )}

        <Button
          type="submit"
          size="lg"
          className="h-12 w-full text-[15px]"
          variant="trust-verified"
          disabled={isSubmitting}
          aria-busy={isSubmitting || undefined}
        >
          {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {isSubmitting ? "Saving…" : "Save password"}
        </Button>
      </form>
    </div>
  );
}
