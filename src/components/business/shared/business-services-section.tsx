"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Wrench } from "lucide-react";

interface BusinessServicesSectionProps {
  services: string[];
  heading?: string;
  /** Render as standalone card or inline content. */
  asCard?: boolean;
}

export function BusinessServicesSection({
  services,
  heading = "Services Offered",
  asCard = true,
}: BusinessServicesSectionProps) {
  if (services.length === 0) return null;

  const inner = (
    <div className="flex flex-wrap gap-2">
      {services.map((service, index) => (
        <Badge key={index} variant="secondary">
          {service}
        </Badge>
      ))}
    </div>
  );

  if (!asCard) return inner;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Wrench className="h-4 w-4 text-muted-foreground" />
          {heading}
        </CardTitle>
      </CardHeader>
      <CardContent>{inner}</CardContent>
    </Card>
  );
}
