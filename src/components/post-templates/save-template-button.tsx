"use client";

import { useEffect, useState } from "react";
import { FilePlus2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SHOW_POST_TEMPLATES } from "@/lib/hidden-features";
import type { PostTemplateData } from "@/lib/post-templates";
import { useAuthStore } from "@/stores/auth-store";
import { SaveTemplateDialog } from "./save-template-dialog";

/** How long this tab trusts its last "is the package running?" answer. */
const PACKAGE_RUNNING_TTL_MS = 5 * 60 * 1000;
let lastAnswer: { userId: string; running: boolean; at: number } | null = null;

/** This tab's answer for this member, while it is fresh; null otherwise. */
function rememberedAnswer(userId: string | undefined): boolean | null {
  if (!lastAnswer || !userId || lastAnswer.userId !== userId) return null;
  return Date.now() - lastAnswer.at < PACKAGE_RUNNING_TTL_MS ? lastAnswer.running : null;
}

/** Forgets the remembered answer (tests). */
export function forgetPackageRunning() {
  lastAnswer = null;
}

/**
 * "Save as template" on a post form (SHOW_POST_TEMPLATES). Shown only while
 * the member's Multi-listing package runs (read from GET /api/post-templates);
 * Individual members never see it. The answer is remembered in this tab for 5
 * minutes for the same signed-in member, so opening several posts to edit does
 * not read every template each time; saving is checked by the database anyway.
 */
export function SaveTemplateButton({
  defaultName,
  data,
}: {
  defaultName: string;
  data: () => PostTemplateData;
}) {
  // Read once, when the form opens: a remembered answer for this member, if any.
  const [remembered] = useState(() => rememberedAnswer(useAuthStore.getState().user?.id));
  const [packageRunning, setPackageRunning] = useState(remembered ?? false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!SHOW_POST_TEMPLATES || remembered !== null) return;
    let cancelled = false;
    void fetch("/api/post-templates", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { package_running?: unknown } | null) => {
        const running = body?.package_running === true;
        const userId = useAuthStore.getState().user?.id;
        if (body && userId) lastAnswer = { userId, running, at: Date.now() };
        if (!cancelled) setPackageRunning(running);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [remembered]);

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
