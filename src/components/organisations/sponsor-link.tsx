"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { trackSponsorClick, type SponsorSurface } from "@/lib/analytics/commercial-events";

/** A link to a programme partner that records the click for its activity report. */
export function SponsorLink({
  organisationId,
  surface,
  onClick,
  ...props
}: ComponentProps<typeof Link> & { organisationId: string; surface: SponsorSurface }) {
  return (
    <Link
      {...props}
      onClick={(event) => {
        trackSponsorClick(organisationId, surface);
        onClick?.(event);
      }}
    />
  );
}
