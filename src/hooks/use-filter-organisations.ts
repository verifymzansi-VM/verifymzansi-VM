"use client";

import { useEffect, useState } from "react";

export interface FilterOrganisation {
  slug: string;
  name: string;
}

/**
 * Listed organisations for the "Programme partner" business filter, loaded on
 * demand. Shared by the desktop sidebar and the mobile filter drawer so both
 * offer the same list.
 */
export function useFilterOrganisations(enabled: boolean): FilterOrganisation[] {
  const [organisations, setOrganisations] = useState<FilterOrganisation[]>([]);
  useEffect(() => {
    if (!enabled || organisations.length > 0) return;
    const controller = new AbortController();
    fetch("/api/organisations/search?purpose=filter", { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : { organisations: [] }))
      .then((data: { organisations?: FilterOrganisation[] }) =>
        setOrganisations((data.organisations ?? []).map(({ slug, name }) => ({ slug, name })))
      )
      .catch(() => undefined);
    return () => controller.abort();
  }, [enabled, organisations.length]);
  return organisations;
}
