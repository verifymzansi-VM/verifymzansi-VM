"use client";

import type { ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import type { UseFormRegisterReturn } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { AuthFieldError, authInputClassName } from "@/components/auth/auth-ui";

interface AuthPasswordFieldProps {
  id: string;
  label: string;
  placeholder: string;
  inputProps: UseFormRegisterReturn;
  errorMessage?: string;
  shown: boolean;
  onToggleShown: () => void;
  describedBy?: string;
  disabled?: boolean;
  /** `new-password` for sign-up/reset, `current-password` for sign-in. */
  autoComplete?: "new-password" | "current-password";
  /** Optional element shown at the end of the label row (e.g. "Forgot password?"). */
  labelAction?: ReactNode;
  /** Optional content rendered between the input and its error (e.g. requirements). */
  children?: ReactNode;
  toggleLabel?: {
    show: string;
    hide: string;
  };
  toggleClassName?: string;
  toggleTabIndex?: number;
}

export function AuthPasswordField({
  id,
  label,
  placeholder,
  inputProps,
  errorMessage,
  shown,
  onToggleShown,
  describedBy,
  disabled,
  autoComplete = "new-password",
  labelAction,
  children,
  toggleLabel = { show: "Show password", hide: "Hide password" },
  toggleClassName,
  toggleTabIndex,
}: AuthPasswordFieldProps) {
  const errorId = `${id}-error`;
  const ariaDescribedBy = [describedBy, errorMessage ? errorId : undefined]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="space-y-2">
      <div className="flex min-h-5 items-center justify-between gap-3">
        <Label htmlFor={id} className="text-sm font-semibold text-foreground">
          {label}
        </Label>
        {labelAction}
      </div>
      <div className="relative">
        <Input
          id={id}
          type={shown ? "text" : "password"}
          placeholder={placeholder}
          autoComplete={autoComplete}
          spellCheck={false}
          autoCapitalize="none"
          disabled={disabled}
          aria-invalid={!!errorMessage}
          aria-describedby={ariaDescribedBy || undefined}
          className={cn(authInputClassName, "pr-12")}
          {...inputProps}
        />
        <button
          type="button"
          className={cn(
            "absolute right-0.5 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
            toggleClassName
          )}
          onClick={onToggleShown}
          disabled={disabled}
          tabIndex={toggleTabIndex}
          aria-label={shown ? toggleLabel.hide : toggleLabel.show}
        >
          {shown ? (
            <EyeOff className="h-[18px] w-[18px]" aria-hidden="true" />
          ) : (
            <Eye className="h-[18px] w-[18px]" aria-hidden="true" />
          )}
        </button>
      </div>
      {children}
      <AuthFieldError id={errorId} message={errorMessage} />
    </div>
  );
}
