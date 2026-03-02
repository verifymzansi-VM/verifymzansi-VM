"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VerificationStepType, VerificationStatus } from "@/types/enums";

interface VerificationProgressProps {
  steps: {
    type: VerificationStepType;
    status: VerificationStatus;
  }[];
  className?: string;
}

const STEP_ORDER: VerificationStepType[] = ["phone", "id_doc", "selfie", "location"];

const STEP_LABELS: Record<VerificationStepType, string> = {
  phone: "Phone",
  id_doc: "ID Document",
  selfie: "Selfie",
  location: "Location",
};

export function VerificationProgress({ steps, className }: VerificationProgressProps) {
  const stepMap = new Map(steps.map((s) => [s.type, s.status]));

  return (
    <div className={cn("flex items-center gap-1 sm:gap-2", className)}>
      {STEP_ORDER.map((stepType, i) => {
        const status = stepMap.get(stepType);
        const isApproved = status === "approved";
        const isPending = status === "pending";
        const isRejected = status === "rejected" || status === "needs_resubmission";
        const isLast = i === STEP_ORDER.length - 1;

        return (
          <div key={stepType} className="flex items-center gap-1 sm:gap-2">
            {/* Step circle */}
            <div className="flex flex-col items-center gap-1">
              <div
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-semibold transition-colors",
                  isApproved && "border-brand-green bg-brand-green text-white",
                  isPending && "border-brand-gold bg-brand-gold-50 text-brand-gold-800",
                  isRejected && "border-brand-red bg-brand-red-50 text-brand-red-800",
                  !status && "border-warm-300 bg-warm-50 text-warm-400"
                )}
              >
                {isApproved ? <Check className="h-4 w-4" /> : <span>{i + 1}</span>}
              </div>
              <span className="text-[10px] sm:text-xs text-muted-foreground whitespace-nowrap">
                {STEP_LABELS[stepType]}
              </span>
            </div>

            {/* Connector line */}
            {!isLast && (
              <div
                className={cn(
                  "h-0.5 w-4 sm:w-8 mb-4",
                  isApproved ? "bg-brand-green" : "bg-warm-200"
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
