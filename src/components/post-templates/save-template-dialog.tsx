"use client";

import { useId, useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import { SHOW_PACKAGE_TEAMS } from "@/lib/hidden-features";
import { POST_TEMPLATE_NAME_MAX, type PostTemplateData } from "@/lib/post-templates";

const KEEPS = [
  "Section and category",
  "Details: make, model, gearbox, fuel",
  "Description",
  "Location",
  "Which contact buttons to show (the numbers are always those of the person posting)",
];
const LEAVES_OUT = ["Title, price, year and mileage", "Photos and video"];

/**
 * Naming a post template (business tools plan picture bt-09): what it keeps
 * and leaves out, then api.save_my_post_template through
 * POST /api/post-templates. Saving under an existing name replaces that
 * template. A bottom sheet on phones, a dialog on wider screens.
 */
export function SaveTemplateDialog({
  open,
  onOpenChange,
  defaultName,
  data,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultName: string;
  /** The template's fields, read when the dialog saves. */
  data: () => PostTemplateData;
}) {
  const nameId = useId();
  const { toast } = useToast();
  const [name, setName] = useState(defaultName.slice(0, POST_TEMPLATE_NAME_MAX));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError("Give the template a name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/post-templates", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ name: name.trim(), data: data() }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        replaced?: unknown;
        error?: unknown;
      };
      if (!res.ok) {
        setError(typeof body.error === "string" ? body.error : "The template was not saved.");
        return;
      }
      toast({
        title: body.replaced === true ? "Template updated" : "Template saved",
        description: "Find it under Start from a template when you create a post.",
        variant: "success",
      });
      onOpenChange(false);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <DialogContent className="max-sm:bottom-0 max-sm:top-auto max-sm:w-full max-sm:max-w-none max-sm:translate-y-0 max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-b-0">
        <form onSubmit={save} className="grid gap-4">
          <DialogHeader className="text-left">
            <DialogTitle className="text-2xl">Save as a template</DialogTitle>
            <DialogDescription className="sr-only">
              A template fills in the post form next time. It never keeps photos or prices.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={nameId}>Template name</Label>
            <Input
              id={nameId}
              value={name}
              maxLength={POST_TEMPLATE_NAME_MAX}
              onChange={(event) => {
                setName(event.target.value);
                setError(null);
              }}
              aria-invalid={error ? true : undefined}
              className="h-12 rounded-xl"
              autoComplete="off"
            />
          </div>
          <ul className="space-y-2.5 text-sm">
            {KEEPS.map((item) => (
              <li key={item} className="flex gap-3">
                <Check
                  aria-label="Kept"
                  className="mt-0.5 h-4 w-4 shrink-0 text-brand-green-600 dark:text-brand-gold-300"
                />
                <span>{item}</span>
              </li>
            ))}
            {LEAVES_OUT.map((item) => (
              <li key={item} className="flex gap-3 text-muted-foreground">
                <X aria-label="Not kept" className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            {SHOW_PACKAGE_TEAMS ? "Your team can use it too. " : ""}You can keep up to 20.
          </p>
          {error ? (
            <p role="alert" className="inline-form-error">
              {error}
            </p>
          ) : null}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              className="h-11 rounded-xl px-5"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="trust-verified"
              className="h-11 rounded-xl px-5"
              disabled={busy}
            >
              {busy ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
              Save template
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
