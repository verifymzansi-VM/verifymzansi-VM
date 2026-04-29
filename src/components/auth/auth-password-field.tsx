"use client";

import { Eye, EyeOff } from "lucide-react";
import type { UseFormRegisterReturn } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

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
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={shown ? "text" : "password"}
          placeholder={placeholder}
          autoComplete="new-password"
          spellCheck={false}
          autoCapitalize="none"
          disabled={disabled}
          aria-invalid={!!errorMessage}
          aria-describedby={ariaDescribedBy || undefined}
          {...inputProps}
        />
        <button
          type="button"
          className={cn(
            "absolute top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground",
            toggleClassName ?? "right-3"
          )}
          onClick={onToggleShown}
          disabled={disabled}
          tabIndex={toggleTabIndex}
          aria-label={shown ? toggleLabel.hide : toggleLabel.show}
        >
          {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {errorMessage && (
        <p id={errorId} className="inline-form-error" role="alert">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
