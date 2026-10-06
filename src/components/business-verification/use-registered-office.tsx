"use client";

import { Building2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import type { LocationValue } from "@/components/ui/location-selector";
import type { RegisteredOffice } from "@/lib/cipc/address";

/** Location fields from a CIPC-verified registered office. */
export function officeToLocation(office: RegisteredOffice): LocationValue | null {
  if (!office.province || !office.city) return null;
  return {
    province: office.province,
    city: office.city,
    town: office.suburb ?? "",
    address: office.streetLines.join(", "),
  };
}

/**
 * One-tap pre-fill of the trading location from the CIPC registered office.
 * Shown only when the business holds the CIPC sticker; the owner can still
 * change every field afterwards, and nothing is filled unless they tap it.
 */
export function UseRegisteredOffice({
  businessId,
  onUse,
}: {
  businessId: string;
  onUse: (location: LocationValue) => void;
}) {
  const [location, setLocation] = useState<LocationValue | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/businesses/${businessId}/verification`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const office = data?.stickers?.cipc?.registeredOffice as RegisteredOffice | null;
        if (!cancelled && office) setLocation(officeToLocation(office));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  if (!location) return null;
  return (
    <Button type="button" variant="outline" size="sm" onClick={() => onUse(location)}>
      <Building2 aria-hidden="true" className="h-4 w-4" />
      Use registered office
    </Button>
  );
}
