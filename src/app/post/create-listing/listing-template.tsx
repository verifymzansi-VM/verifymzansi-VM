"use client";

import { ToastAction } from "@/components/ui/toast";
import type { toast as showToast } from "@/hooks/use-toast";
import { SHOW_POST_TEMPLATES } from "@/lib/hidden-features";
import { parsePostTemplateList, type PostTemplate } from "@/lib/post-templates";
import type { DraftEnvelope } from "@/lib/post-drafts/storage";

/** How long the form waits for a template before it opens the saved draft instead. */
const TEMPLATE_WAIT_MS = 5000;

/** What the "Post an item" form opens with. */
export type ListingStart<T> = {
  /** The form's autosaved draft, if any. */
  draft: DraftEnvelope<T> | null;
  /** The template it was opened with (?template=<id>), when it loaded. */
  template: PostTemplate | null;
  /** Opened with a template that could not be loaded. */
  templateFailed: boolean;
};

/**
 * Start from a template (SHOW_POST_TEMPLATES): reads the saved draft and, when
 * the address names one (/post/create-listing?template=<id>), the template.
 * The form applies the template when it loaded and the draft otherwise.
 */
export async function loadListingStart<T>(
  restoreDraft: () => Promise<DraftEnvelope<T> | null> | DraftEnvelope<T> | null
): Promise<ListingStart<T>> {
  const id = SHOW_POST_TEMPLATES
    ? new URLSearchParams(window.location.search).get("template")
    : null;
  const draftRead = Promise.resolve(restoreDraft());
  if (!id) return { draft: await draftRead, template: null, templateFailed: false };
  const template = await fetch("/api/post-templates", {
    cache: "no-store",
    signal: AbortSignal.timeout(TEMPLATE_WAIT_MS),
  })
    .then((res) => (res.ok ? res.json() : null))
    .then((body: unknown) =>
      body ? (parsePostTemplateList(body).templates.find((t) => t.id === id) ?? null) : null
    )
    .catch(() => null);
  return { draft: await draftRead, template, templateFailed: template === null };
}

/** Drops the template from the address once the form settled, so a reload
 * restores the form's autosaved draft instead. */
export function dropTemplateFromAddress() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("template")) return;
  url.searchParams.delete("template");
  window.history.replaceState(window.history.state, "", url);
}

/**
 * The "Started from <name>" message. When the template replaced an unfinished
 * draft, it offers Undo, which puts that draft back; the first edit of the
 * form (or Undo) ends the offer.
 */
export function announceTemplate(
  toast: typeof showToast,
  template: PostTemplate,
  undo: (() => void) | null
) {
  const shown = toast({
    title: `Started from "${template.name}"`,
    description: undo
      ? "Your unfinished post was set aside. Undo brings it back."
      : "Add the photos, title, price and the details of this item.",
    variant: "success",
    ...(undo
      ? {
          action: (
            <ToastAction altText="Bring back your unfinished post" onClick={() => undo()}>
              Undo
            </ToastAction>
          ),
        }
      : {}),
  });
  if (!undo) return;
  const endOffer = () => {
    shown.dismiss();
    document.removeEventListener("input", endOffer, true);
    document.removeEventListener("change", endOffer, true);
  };
  document.addEventListener("input", endOffer, true);
  document.addEventListener("change", endOffer, true);
}

/** The message when a template could not be loaded (the saved draft opens instead). */
export function announceTemplateFailed(toast: typeof showToast) {
  toast({
    title: "This template can't be opened",
    description: "It may have been deleted. You can fill in the form yourself.",
    variant: "destructive",
  });
}
