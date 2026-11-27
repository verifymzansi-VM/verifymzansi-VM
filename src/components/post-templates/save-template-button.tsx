"use client";

import { useState } from "react";
import { FilePlus2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SHOW_POST_TEMPLATES } from "@/lib/hidden-features";
import type { PostTemplateData } from "@/lib/post-templates";
import { SaveTemplateDialog } from "./save-template-dialog";

/**
 * "Save as template" on a post form (SHOW_POST_TEMPLATES). Shown only while
 * the member's Multi-listing package runs (`packageRunning`, from the posting
 * allowance the page already loads); Individual members never see it.
 */
export function SaveTemplateButton({
  defaultName,
  data,
  packageRunning,
}: {
  defaultName: string;
  data: () => PostTemplateData;
  packageRunning: boolean;
}) {
  const [open, setOpen] = useState(false);

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
