"use client";

import { Check } from "lucide-react";

export function getPasswordRequirements(
  password: string,
  lowercaseLabel = "Lowercase",
  uppercaseLabel = "Uppercase"
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
    <div id={id} className="grid grid-cols-2 gap-1">
      {requirements.map((requirement) => (
        <span
          key={requirement.label}
          className={`text-xs flex items-center gap-1 ${
            requirement.met ? "text-brand-green" : "text-muted-foreground"
          }`}
        >
          <Check className={`h-3 w-3 ${requirement.met ? "" : "opacity-30"}`} />
          {requirement.label}
        </span>
      ))}
    </div>
  );
}
