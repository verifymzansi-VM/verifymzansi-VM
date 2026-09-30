import type { ComponentProps } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { AuthFieldError, authInputClassName } from "@/components/auth/auth-ui";

type InputProps = ComponentProps<typeof Input>;

export function AuthEmailField({
  inputProps,
  errorMessage,
  disabled,
  label = "Email",
}: {
  inputProps: InputProps;
  errorMessage?: string;
  disabled?: boolean;
  /** Visible label. Keep the word "Email" in it: tests find the field by label. */
  label?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="email" className="text-sm font-semibold text-foreground">
        {label}
      </Label>
      <Input
        id="email"
        type="email"
        inputMode="email"
        placeholder="you@example.com"
        autoComplete="email"
        spellCheck={false}
        autoCapitalize="none"
        disabled={disabled}
        aria-invalid={!!errorMessage}
        aria-describedby={errorMessage ? "email-error" : undefined}
        {...inputProps}
        className={cn(authInputClassName, inputProps.className)}
      />
      <AuthFieldError id="email-error" message={errorMessage} />
    </div>
  );
}
