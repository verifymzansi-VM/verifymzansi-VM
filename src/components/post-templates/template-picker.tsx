"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Loader2, MoreVertical, Pencil, Trash2 } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { buildPostCategoryHref } from "@/app/post/_lib/post-access";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import {
  POST_TEMPLATE_LIMIT,
  POST_TEMPLATE_NAME_MAX,
  templateSummary,
  type PostTemplate,
} from "@/lib/post-templates";
import type { AccountVerificationStatus } from "@/types/enums";

type Change = { kind: "rename" | "delete"; template: PostTemplate };

/**
 * "Start from a template" on Create Post (business tools plan picture bt-08,
 * SHOW_POST_TEMPLATES): one card per template with "Use", which opens the
 * "Post an item" form filled in, and its own menu with Rename and Delete.
 * Shown only once a template exists. After the Multi-listing package ends, Use
 * is off (a template is part of the package) but Rename and Delete still work.
 */
export function TemplatePicker({
  templates,
  packageRunning,
  verificationStatus,
}: {
  templates: PostTemplate[];
  packageRunning: boolean;
  verificationStatus: AccountVerificationStatus | null;
}) {
  const [change, setChange] = useState<Change | null>(null);
  return (
    <section aria-labelledby="post-templates-title" className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2
          id="post-templates-title"
          className="font-display text-xl font-bold tracking-tight text-foreground sm:text-2xl"
        >
          Start from a template
        </h2>
        <p className="shrink-0 text-sm text-muted-foreground">
          {templates.length} of {POST_TEMPLATE_LIMIT}
        </p>
      </div>
      {packageRunning ? (
        <p className="text-sm text-muted-foreground">
          Category, details, description and contact choices are filled in. You add the photos,
          title and price.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Your Multi-listing package has ended.{" "}
          <Link href="/dashboard/slots" className="font-semibold text-foreground underline">
            Renew
          </Link>{" "}
          to use templates.
        </p>
      )}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {templates.map((template) => (
          <li key={template.id} className="surface-card flex flex-col gap-3 p-4">
            <div className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-950/60 dark:text-brand-gold-300"
              >
                <FileText className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-base font-semibold text-foreground">
                  {template.name}
                </h3>
                <p className="text-sm text-muted-foreground">{templateSummary(template.data)}</p>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="-mr-2 -mt-1 h-11 w-11 p-0"
                    aria-label={`More actions for ${template.name}`}
                  >
                    <MoreVertical aria-hidden="true" className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-40">
                  <DropdownMenuItem
                    className="min-h-11 gap-2"
                    onSelect={() => setChange({ kind: "rename", template })}
                  >
                    <Pencil aria-hidden="true" className="h-4 w-4" />
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="min-h-11 gap-2 text-destructive focus:text-destructive"
                    onSelect={() => setChange({ kind: "delete", template })}
                  >
                    <Trash2 aria-hidden="true" className="h-4 w-4" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {packageRunning ? (
              <Button asChild variant="outline" className="h-11 w-full rounded-xl">
                <Link
                  href={buildPostCategoryHref(
                    `/post/create-listing?template=${template.id}`,
                    verificationStatus
                  )}
                  aria-label={`Use ${template.name}`}
                >
                  Use
                </Link>
              </Button>
            ) : (
              <Button
                variant="outline"
                className="h-11 w-full rounded-xl"
                disabled
                aria-label={`Use ${template.name}`}
              >
                Use
              </Button>
            )}
          </li>
        ))}
      </ul>
      <p className="flex items-center gap-3 pt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Or pick a section
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
      </p>
      {change ? (
        <ChangeTemplateDialog
          key={`${change.kind}-${change.template.id}`}
          change={change}
          onClose={() => setChange(null)}
        />
      ) : null}
    </section>
  );
}

/** Rename (a new name) or Delete (a confirmation) one template. */
function ChangeTemplateDialog({ change, onClose }: { change: Change; onClose: () => void }) {
  const router = useRouter();
  const nameId = useId();
  const [name, setName] = useState(change.template.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const renaming = change.kind === "rename";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (renaming && !name.trim()) {
      setError("Give the template a name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/post-templates/${change.template.id}`, {
        method: renaming ? "PATCH" : "DELETE",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(renaming ? { name: name.trim() } : {}),
      });
      if (!res.ok && res.status !== 404) {
        const body = (await res.json().catch(() => ({}))) as { error?: unknown };
        setError(typeof body.error === "string" ? body.error : "That did not work. Try again.");
        return;
      }
      onClose();
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      {/* Rename has no description; Radix then needs aria-describedby unset. */}
      <DialogContent {...(renaming ? { "aria-describedby": undefined } : {})}>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{renaming ? "Rename template" : "Delete this template?"}</DialogTitle>
            {renaming ? null : (
              <DialogDescription>
                {`"${change.template.name}" goes for good. Posts made from it stay as they are.`}
              </DialogDescription>
            )}
          </DialogHeader>
          {renaming ? (
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
          ) : null}
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
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant={renaming ? "trust-verified" : "destructive"}
              className="h-11 rounded-xl px-5"
              disabled={busy}
            >
              {busy ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
              {renaming ? "Save name" : "Delete"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
