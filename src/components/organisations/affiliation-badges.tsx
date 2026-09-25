"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Landmark } from "lucide-react";
import type { PublicAffiliation } from "@/lib/organisations/affiliations";

/* Batch every badge rendered in the same tick into one request. */
const cache = new Map<string, PublicAffiliation[]>();
let pending = new Set<string>();
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function scheduleFetch() {
  if (inflight) return;
  inflight = new Promise<void>((resolve) => setTimeout(resolve, 30)).then(async () => {
    const ids = [...pending].filter((id) => !cache.has(id));
    pending = new Set();
    inflight = null;
    if (ids.length === 0) return;
    try {
      const res = await fetch(`/api/organisations/affiliations?ids=${ids.join(",")}`);
      const body = res.ok ? ((await res.json()) as { affiliations: PublicAffiliation[] }) : null;
      for (const id of ids) cache.set(id, []);
      for (const row of body?.affiliations ?? []) {
        cache.set(row.business_id, [...(cache.get(row.business_id) ?? []), row]);
      }
    } catch {
      for (const id of ids) cache.set(id, []);
    }
    listeners.forEach((notify) => notify());
  });
}

function useAffiliations(businessId: string | null | undefined): PublicAffiliation[] {
  const [, force] = useState(0);
  useEffect(() => {
    if (!businessId || cache.has(businessId)) return;
    const notify = () => force((n) => n + 1);
    listeners.add(notify);
    pending.add(businessId);
    scheduleFetch();
    return () => {
      listeners.delete(notify);
    };
  }, [businessId]);
  return businessId ? (cache.get(businessId) ?? []) : [];
}

/**
 * Small, secondary organisation line for a business card. The business stays
 * the main subject; VerifyMzansi verification is shown separately.
 */
export function AffiliationBadge({ businessId }: { businessId: string | null | undefined }) {
  const affiliations = useAffiliations(businessId);
  const first = affiliations[0];
  if (!first) return null;
  const text =
    first.sponsored && first.sponsorship_label
      ? first.sponsorship_label
      : `${first.label} — ${first.organisation_name}`;
  return (
    <p
      className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-muted-foreground"
      data-testid="affiliation-badge"
    >
      {first.logo_url ? (
        <Image
          src={first.logo_url}
          alt=""
          width={14}
          height={14}
          className="h-3.5 w-3.5 shrink-0 rounded-sm object-contain"
          unoptimized
        />
      ) : (
        <Landmark aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      )}
      <span className="truncate">{text}</span>
      {affiliations.length > 1 ? (
        <span className="shrink-0">+{affiliations.length - 1}</span>
      ) : null}
    </p>
  );
}
