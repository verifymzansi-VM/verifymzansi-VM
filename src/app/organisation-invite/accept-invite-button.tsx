"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ensureCsrfTokenReady, withCsrfHeaders } from "@/lib/utils/csrf";

export function AcceptInviteButton({
  token,
  organisationName,
  foundation = false,
}: {
  token: string;
  organisationName: string;
  foundation?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (!(await ensureCsrfTokenReady())) throw new Error("Security check unavailable");
      const res = await fetch(
        foundation
          ? "/api/foundation/organisations/invites/accept"
          : "/api/organisations/invites/accept",
        {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          redirect: "error",
          headers: withCsrfHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ token }),
        }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "The invitation could not be accepted. Please try again.");
        return;
      }
      const slug = foundation ? body.organisation_slug : body.data?.organisationSlug;
      if (typeof slug !== "string" || slug.length > 120 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
        throw new Error("Invalid organisation destination");
      router.push(`/dashboard/organisation/${encodeURIComponent(slug)}`);
    } catch {
      setError("We could not confirm the response. Reload the invitation or open your dashboard.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button className="h-11 w-full rounded-full sm:w-auto" disabled={busy} onClick={accept}>
        {busy ? "Accepting…" : `Become an administrator of ${organisationName}`}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
