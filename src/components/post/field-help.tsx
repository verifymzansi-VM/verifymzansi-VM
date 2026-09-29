"use client";

import { useId, useState, type ReactNode } from "react";
import { CircleHelp } from "lucide-react";

/** In-flow help works on touch screens and never changes a form answer. */
export function FieldHelp({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <div className="my-1">
      <button
        type="button"
        aria-label={`Help with ${label}`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="inline-flex min-h-11 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <CircleHelp aria-hidden="true" className="h-4 w-4" />
        <span>Help me choose</span>
      </button>
      <div
        id={id}
        hidden={!open}
        className="rounded-xl border border-border bg-muted/40 p-3 text-sm leading-6 text-foreground"
      >
        {children}
      </div>
    </div>
  );
}
