import type { ComponentProps } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type InputProps = ComponentProps<typeof Input>;

export function AuthEmailField({
  inputProps,
  errorMessage,
  disabled,
}: {
  inputProps: InputProps;
  errorMessage?: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor="email">Email</Label>
      <Input
        id="email"
        type="email"
        placeholder="you@example.com"
        autoComplete="email"
        spellCheck={false}
        autoCapitalize="none"
        disabled={disabled}
        aria-invalid={!!errorMessage}
        aria-describedby={errorMessage ? "email-error" : undefined}
        {...inputProps}
      />
      {errorMessage && (
        <p id="email-error" className="inline-form-error" role="alert">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
