import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function PaymentStatusResult({
  icon,
  title,
  description,
  children,
  primaryAction,
  secondaryAction,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children?: ReactNode;
  primaryAction: {
    href: string;
    label: string;
  };
  secondaryAction: {
    href: string;
    label: string;
  };
}) {
  return (
    <div className="container-page max-w-md space-y-4 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        {icon}
      </div>

      <h1 className="font-display text-xl font-bold">{title}</h1>

      <Card>
        <CardContent className="space-y-3 p-4">
          <p className="text-sm text-muted-foreground">{description}</p>
          {children}
        </CardContent>
      </Card>

      <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Button asChild className="h-11 w-full gap-2 sm:w-auto">
          <Link href={primaryAction.href}>
            {primaryAction.label}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
        <Button asChild variant="outline" className="h-11 w-full sm:w-auto">
          <Link href={secondaryAction.href}>{secondaryAction.label}</Link>
        </Button>
      </div>
    </div>
  );
}
