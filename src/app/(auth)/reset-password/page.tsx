"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, AlertTriangle, ArrowLeft } from "lucide-react";

import { AuthPasswordField } from "@/components/auth/auth-password-field";
import {
  getPasswordRequirements,
  PasswordRequirements,
} from "@/components/auth/password-requirements";
import { Button } from "@/components/ui/button";
import { resetPasswordSchema, type ResetPasswordInput } from "@/lib/validations/auth";
import { useToast } from "@/hooks/use-toast";
import { withCsrfHeaders } from "@/lib/utils/csrf";

export default function ResetPasswordPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [sessionValid, setSessionValid] = useState<boolean | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  // Check if the user has a valid recovery session (set by the reset link)
  useEffect(() => {
    async function checkSession() {
      try {
        const res = await fetch("/api/auth/reset-password");
        const data = await res.json();
        setSessionValid(data.valid === true);
      } catch {
        setSessionValid(false);
      }
    }

    void checkSession();
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
  const requirements = getPasswordRequirements(password, "Lowercase letter", "Uppercase letter");

  async function onSubmit(data: ResetPasswordInput) {
    try {
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
          setSessionValid(false);
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
      toast({
        title: "Something went wrong",
        description: "Please try again later.",
        variant: "destructive",
      });
    }
  }

  // Loading state while checking session
  if (sessionValid === null) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // No valid session — show helpful message
  if (!sessionValid) {
    return (
      <div className="space-y-4 text-center">
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-amber-500/10 text-amber-600 mx-auto">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <h1 className="font-display text-2xl font-bold">Reset link expired</h1>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          This password reset link has expired or is invalid. Please request a new one.
        </p>
        <div className="flex flex-col gap-3">
          <Button asChild variant="trust-verified">
            <Link href="/forgot-password">Request new reset link</Link>
          </Button>
          <Button asChild variant="outline" className="gap-2">
            <Link href="/login">
              <ArrowLeft className="h-4 w-4" />
              Back to sign in
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-bold tracking-tight">Set a new password</h1>
      </div>

      <form noValidate onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <AuthPasswordField
          id="password"
          label="New password"
          placeholder="Create a strong password"
          inputProps={register("password")}
          errorMessage={errors.password?.message}
          shown={showPassword}
          onToggleShown={() => setShowPassword(!showPassword)}
          describedBy="password-requirements"
          toggleTabIndex={-1}
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
          toggleLabel={{ show: "Show confirm password", hide: "Hide confirm password" }}
          toggleTabIndex={-1}
        />

        <Button type="submit" className="w-full" variant="trust-verified" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {isSubmitting ? "Updating..." : "Update Password"}
        </Button>
      </form>
    </div>
  );
}
