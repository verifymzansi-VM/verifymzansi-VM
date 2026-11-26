"use client";

import { useEffect, useState } from "react";
import { FilePlus2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SHOW_POST_TEMPLATES } from "@/lib/hidden-features";
import type { PostTemplateData } from "@/lib/post-templates";
import { SaveTemplateDialog } from "./save-template-dialog";

/**
 * "Save as template" on a post form (SHOW_POST_TEMPLATES). Shown only while
 * the member's Multi-listing package runs (read from GET /api/post-templates);
 * Individual members never see it.
 */
export function SaveTemplateButton({
  defaultName,
  data,
}: {
  defaultName: string;
  data: () => PostTemplateData;
}) {
  const [packageRunning, setPackageRunning] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!SHOW_POST_TEMPLATES) return;
    let cancelled = false;
    void fetch("/api/post-templates", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { package_running?: unknown } | null) => {
        if (!cancelled) setPackageRunning(body?.package_running === true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!SHOW_POST_TEMPLATES || !packageRunning) return null;
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-11 gap-1.5 rounded-xl px-4"
        onClick={() => setOpen(true)}
      >
        <FilePlus2 aria-hidden="true" className="h-4 w-4" />
        Save as template
      </Button>
      {open ? (
        <SaveTemplateDialog open onOpenChange={setOpen} defaultName={defaultName} data={data} />
      ) : null}
    </>
  );
}
