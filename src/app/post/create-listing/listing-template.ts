"use client";

import { useEffect, useEffectEvent, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { SHOW_POST_TEMPLATES } from "@/lib/hidden-features";
import { formFieldsFromTemplate, parsePostTemplateList } from "@/lib/post-templates";

export type TemplateFormFields = ReturnType<typeof formFieldsFromTemplate>;

/**
 * Start from a template (SHOW_POST_TEMPLATES): /post/create-listing?template=<id>
 * fills the "Post an item" form with the template's fields once, then drops
 * the address parameter, so the form's autosave keeps the new post as its
 * draft from there (a reload restores that draft, not the template).
 *
 * Returns a ref holding, while the form was opened with a template, whether
 * the template filled the form: the form then waits for it and restores an
 * older autosaved draft only when the template could not be loaded.
 */
export function useListingTemplate(apply: (fields: TemplateFormFields) => void) {
  const fromTemplate = useRef<Promise<boolean> | null>(null);
  const { toast } = useToast();
  const applyFields = useEffectEvent(apply);
  const notify = useEffectEvent(toast);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("template");
    if (!SHOW_POST_TEMPLATES || !id) return;
    let applied: (filled: boolean) => void = () => undefined;
    fromTemplate.current = new Promise((resolve) => (applied = resolve));
    let cancelled = false;
    void fetch("/api/post-templates", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("unavailable"))))
      .then((body: unknown) => {
        if (cancelled) return;
        const template = parsePostTemplateList(body).templates.find((t) => t.id === id);
        if (!template) throw new Error("missing");
        applyFields(formFieldsFromTemplate(template.data));
        notify({
          title: `Started from "${template.name}"`,
          description: "Add the photos, title, price and the details of this item.",
          variant: "success",
        });
        applied(true);
      })
      .catch(() => {
        if (cancelled) return;
        notify({
          title: "This template can't be opened",
          description: "It may have been deleted. You can fill in the form yourself.",
          variant: "destructive",
        });
        applied(false);
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
