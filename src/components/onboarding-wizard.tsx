"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ShieldCheck,
  UserCircle,
  Camera,
  MapPin,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STEPS = [
  {
    id: "welcome",
    title: "Welcome to VerifyMzansi",
    description: "SA's trusted marketplace. Let's get you set up.",
    icon: ShieldCheck,
  },
  {
    id: "profile",
    title: "Complete Your Profile",
    description: "Add your display name and profile picture.",
    icon: UserCircle,
    action: "/dashboard/settings",
  },
  {
    id: "verify",
    title: "Verify Your Identity",
    description: "Verify your SA ID to unlock selling.",
    icon: Camera,
    action: "/verification",
  },
  {
    id: "location",
    title: "Set Your Location",
    description: "Set your province and city.",
    icon: MapPin,
    action: "/dashboard/settings",
  },
  {
    id: "done",
    title: "You're All Set!",
    description: "Browse the marketplace. Verify to start selling.",
    icon: CheckCircle2,
    action: "/mzansi-market",
  },
] as const;

/**
 * Guided onboarding wizard for new users.
 *
 * Walks through: welcome → profile → KYC verify → location → done.
 * Each step has a skip/next option and links to the relevant page.
 */
export function OnboardingWizard({ onComplete }: { onComplete?: () => void }) {
  const [currentStep, setCurrentStep] = useState(0);
  const router = useRouter();
  const step = STEPS[currentStep];
  const isLast = currentStep === STEPS.length - 1;
  const isFirst = currentStep === 0;

  function handleNext() {
    if (isLast) {
      onComplete?.();
      if ("action" in step && step.action) router.push(step.action);
      return;
    }
    setCurrentStep((s) => s + 1);
  }

  function handleBack() {
    if (!isFirst) setCurrentStep((s) => s - 1);
  }

  function handleGoToAction() {
    if ("action" in step && step.action) {
      router.push(step.action);
    }
  }

  const Icon = step.icon;

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      {/* Progress indicator */}
      <div className="mb-4 flex items-center justify-center gap-2">
        {STEPS.map((_, i) => (
          <div
            key={i}
            className={cn(
              "h-2 rounded-full transition-all duration-300",
              i === currentStep
                ? "w-8 bg-brand-green"
                : i < currentStep
                  ? "w-3 bg-brand-green/50"
                  : "w-3 bg-muted"
            )}
          />
        ))}
      </div>

      {/* Step content */}
      <div className="flex flex-col items-center text-center">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-green/10">
          <Icon className="h-6 w-6 text-brand-green" />
        </div>

        <h2 className="text-xl font-display font-bold">{step.title}</h2>
        <p className="mt-3 max-w-sm text-muted-foreground">{step.description}</p>

        {/* Action button (for steps with a destination) */}
        {"action" in step && step.action && !isLast && (
          <Button variant="outline" className="mt-6" onClick={handleGoToAction}>
            Go to {step.title.toLowerCase()}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Navigation */}
      <div className="mt-6 flex items-center justify-between">
        <Button
          variant="ghost"
          onClick={handleBack}
          disabled={isFirst}
          className={cn(isFirst && "invisible")}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>

        <Button onClick={handleNext} variant={isLast ? "trust-verified" : "default"}>
          {isLast ? "Start Exploring" : "Next"}
          {!isLast && <ArrowRight className="ml-2 h-4 w-4" />}
        </Button>
      </div>

      {/* Skip link */}
      {!isLast && (
        <div className="mt-4 text-center">
          <button
            onClick={() => {
              onComplete?.();
              router.push("/dashboard");
            }}
            className="text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            Skip onboarding — go to dashboard
          </button>
        </div>
      )}
    </div>
  );
}
