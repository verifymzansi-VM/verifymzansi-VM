import Link from "next/link";
import { ShieldCheck, PlusCircle, Building2, CheckCircle2, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface OnboardingStep {
  label: string;
  description: string;
  href: string;
  icon: React.ElementType;
  completed: boolean;
}

interface DashboardOnboardingProps {
  isVerified: boolean;
  hasListings: boolean;
  hasBusinesses: boolean;
}

export function DashboardOnboarding({
  isVerified,
  hasListings,
  hasBusinesses,
}: DashboardOnboardingProps) {
  const steps: OnboardingStep[] = [
    {
      label: "Complete your verification",
      description: "Build trust with buyers by verifying your identity",
      href: "/verification",
      icon: ShieldCheck,
      completed: isVerified,
    },
    {
      label: "Post your first listing",
      description: "Create a listing so buyers can start contacting you",
      href: "/post/create",
      icon: PlusCircle,
      completed: hasListings,
    },
    {
      label: "Add your business profile",
      description: "Showcase your brand and connect it to your listings",
      href: "/post/create-business",
      icon: Building2,
      completed: hasBusinesses,
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-display">Next steps</CardTitle>
        <p className="text-sm text-muted-foreground">
          Finish the basics once, then come back here to manage your account faster.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {steps.map((step) => {
          const Icon = step.icon;
          return (
            <Link
              key={step.label}
              href={step.href}
              className={cn(
                "flex items-center gap-4 rounded-lg border p-4 transition-colors",
                step.completed
                  ? "bg-brand-green-50/50 border-brand-green-200 dark:bg-brand-green-950/30 dark:border-brand-green-800"
                  : "hover:bg-muted/50"
              )}
            >
              <div
                className={cn(
                  "inline-flex items-center justify-center w-10 h-10 rounded-full flex-shrink-0",
                  step.completed
                    ? "bg-brand-green-100 text-brand-green dark:bg-brand-green-900"
                    : "bg-warm-100 text-warm-500 dark:bg-warm-800"
                )}
              >
                {step.completed ? (
                  <CheckCircle2 className="h-5 w-5" />
                ) : (
                  <Icon className="h-5 w-5" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p
                  className={cn(
                    "text-sm font-medium",
                    step.completed && "line-through text-muted-foreground"
                  )}
                >
                  {step.label}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>
              </div>
              {!step.completed && (
                <Button variant="ghost" size="sm" className="flex-shrink-0 gap-1" tabIndex={-1}>
                  Start
                  <ArrowRight className="h-3 w-3" />
                </Button>
              )}
            </Link>
          );
        })}
      </CardContent>
    </Card>
  );
}
