"use client";

import { useEffect, useEffectEvent, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { SHOW_POST_TEMPLATES } from "@/lib/hidden-features";
import { formFieldsFromTemplate, postTemplateList } from "@/lib/post-templates";

export type TemplateFormFields = ReturnType<typeof formFieldsFromTemplate>;

/**
 * Start from a template (SHOW_POST_TEMPLATES): /post/create-listing?template=<id>
 * fills the "Post an item" form with the template's fields once, then drops
 * the address parameter, so the form's autosave keeps the new post as its
 * draft from there (a reload restores that draft, not the template).
 *
 * Returns a ref that is true while the form was opened from a template: the
 * form then does not restore an older autosaved draft over it.
 */
export function useListingTemplate(apply: (fields: TemplateFormFields) => void) {
  const fromTemplate = useRef(false);
  const { toast } = useToast();
  const applyFields = useEffectEvent(apply);
  const notify = useEffectEvent(toast);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("template");
    if (!SHOW_POST_TEMPLATES || !id) return;
    fromTemplate.current = true;
    let cancelled = false;
    void fetch("/api/post-templates", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("unavailable"))))
      .then((body: unknown) => {
        if (cancelled) return;
        const template = postTemplateList.parse(body).templates.find((t) => t.id === id);
        if (!template) throw new Error("missing");
        applyFields(formFieldsFromTemplate(template.data));
        notify({
          title: `Started from "${template.name}"`,
          description: "Add the photos, title, price and the details of this item.",
          variant: "success",
        });
      })
      .catch(() => {
        if (cancelled) return;
        notify({
          title: "This template can't be opened",
          description: "It may have been deleted. You can fill in the form yourself.",
          variant: "destructive",
        });
      })
      .finally(() => {
        if (cancelled) return;
        const url = new URL(window.location.href);
        url.searchParams.delete("template");
        window.history.replaceState(window.history.state, "", url);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return fromTemplate;
}
