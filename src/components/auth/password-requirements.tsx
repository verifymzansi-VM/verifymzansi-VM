"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Mirrors `passwordSchema` in `@/lib/validations/shared` so people see each
 * rule tick over as they type instead of discovering them on submit.
 */
export function getPasswordRequirements(
  password: string,
  lowercaseLabel = "Lowercase letter",
  uppercaseLabel = "Uppercase letter"
) {
  return [
    { label: "8+ characters", met: password.length >= 8 },
    { label: lowercaseLabel, met: /[a-z]/.test(password) },
    { label: uppercaseLabel, met: /[A-Z]/.test(password) },
    { label: "Number", met: /[0-9]/.test(password) },
  ];
}

export function PasswordRequirements({
  id,
  requirements,
}: {
  id?: string;
  requirements: Array<{ label: string; met: boolean }>;
}) {
  return (
    <div id={id}>
      <p className="sr-only">Your password needs:</p>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5 px-1">
        {requirements.map((requirement) => (
          <li
            key={requirement.label}
            className={cn(
              "flex items-center gap-2 text-[13px] leading-5 transition-colors duration-200",
              requirement.met
                ? "font-medium text-brand-green-700 dark:text-brand-green-300"
                : "text-muted-foreground"
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors duration-200",
                requirement.met
                  ? "border-brand-green-600 bg-brand-green-600 text-white dark:border-brand-green-400 dark:bg-brand-green-400 dark:text-brand-green-950"
                  : "border-muted-foreground/40"
              )}
            >
              {requirement.met ? <Check className="h-2.5 w-2.5" strokeWidth={3.5} /> : null}
            </span>
            {requirement.label}
            <span className="sr-only">{requirement.met ? " (done)" : " (not yet)"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
