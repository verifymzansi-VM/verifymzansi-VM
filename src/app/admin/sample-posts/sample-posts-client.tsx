"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Film, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import { fetchStaffEvidence } from "@/lib/auth/staff-evidence-fetch";
import type { SamplePostArea } from "@/lib/sample-posts/catalogue";

export interface StaffSampleRow {
  slug: string;
  title: string;
  area: SamplePostArea;
  place: string;
  posterUrl: string;
}

const AREA_LABELS: Record<SamplePostArea, string> = {
  market: "Mzansi Market",
  business: "Mzansi Business",
  tourism: "Tourism · Tourism & Events",
  event: "Events · Tourism & Events",
};

export function SamplePostsClient({
  samples,
  initialHidden,
  switchedOn,
}: {
  samples: StaffSampleRow[];
  /** null: the hide-list could not be read (every sample is then off the site). */
  initialHidden: string[] | null;
  switchedOn: boolean;
}) {
  const [hidden, setHidden] = useState(() => new Set(initialHidden ?? []));
  const [busy, setBusy] = useState<string | null>(null);
  const sending = useRef(false);
  const router = useRouter();
  const { toast } = useToast();
  const available = initialHidden !== null;

  async function change(slug: string, hide: boolean) {
    if (sending.current) return;
    sending.current = true;
    setBusy(slug);
    try {
      const response = await fetchStaffEvidence("/api/admin/sample-posts", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ slug, hidden: hide }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        sample?: { slug: string; hidden: boolean };
      };
      if (!response.ok || data.sample?.slug !== slug || data.sample.hidden !== hide)
        throw new Error(data.error || "The change could not be confirmed. Reload the page.");
      setHidden((previous) => {
        const next = new Set(previous);
        if (hide) next.add(slug);
        else next.delete(slug);
        return next;
      });
      toast({
        title: hide ? "Sample removed" : "Sample restored",
        description: hide
          ? "It no longer shows in the showrooms."
          : "It shows in the showrooms again while samples are on.",
        variant: "success",
      });
      router.refresh();
    } catch (error) {
      toast({
        title: "Not changed",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      sending.current = false;
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {switchedOn
          ? "Samples are on: each sample below that is not removed shows after the real posts."
          : "Samples are off on this site (SAMPLE_POSTS_ENABLED), so visitors see none. Removals still apply when they are switched on."}
      </p>
      {!available ? (
        <p role="alert" className="text-sm text-destructive">
          The list of removed samples could not be read, so no sample shows to visitors. Reload the
          page to try again.
        </p>
      ) : null}

      {samples.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-6 text-muted-foreground">
            <Film className="mb-3 h-8 w-8" aria-hidden="true" />
            <p className="text-lg font-medium">No samples in the catalogue</p>
          </CardContent>
        </Card>
      ) : (
        <ul className="divide-y rounded-xl border bg-card" data-staff-sample-list>
          {samples.map((sample) => {
            const isHidden = hidden.has(sample.slug);
            return (
              <li
                key={sample.slug}
                className="flex flex-wrap items-center gap-3 p-3 sm:flex-nowrap"
                data-sample-slug={sample.slug}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- small staff thumbnail from the catalogue's own media */}
                <img
                  src={sample.posterUrl}
                  alt=""
                  width={48}
                  height={64}
                  className="h-16 w-12 shrink-0 rounded-md bg-muted object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{sample.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {AREA_LABELS[sample.area]} · {sample.place}
                  </p>
                </div>
                <Badge variant={isHidden ? "draft" : "live"}>
                  {isHidden ? "Removed" : "Shown"}
                </Badge>
                <Button
                  size="sm"
                  variant={isHidden ? "default" : "outline"}
                  className="h-10 min-w-28 gap-2"
                  disabled={!available || busy !== null}
                  onClick={() => void change(sample.slug, !isHidden)}
                  aria-label={`${isHidden ? "Restore" : "Remove"} ${sample.title}`}
                >
                  {busy === sample.slug ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : isHidden ? (
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                  )}
                  {isHidden ? "Restore" : "Remove"}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
