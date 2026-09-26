"use client";

import { useMemo, useSyncExternalStore, type ComponentType } from "react";
import { CheckCircle2, Clock, Handshake, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ChecklistItem {
  id: string;
  text: string;
}

interface ChecklistPhase {
  id: string;
  title: string;
  icon: ComponentType<{ className?: string }>;
  items: ChecklistItem[];
}

const PHASES: ChecklistPhase[] = [
  {
    id: "before",
    title: "Before",
    icon: Clock,
    items: [
      { id: "badge", text: "Check their trust badge" },
      { id: "call", text: "Have a quick phone or video call" },
      { id: "tell", text: "Share your live location with someone" },
      { id: "daylight", text: "Meet in daylight" },
      { id: "public", text: "Pick a busy public place" },
      { id: "transport", text: "Use your own transport" },
    ],
  },
  {
    id: "during",
    title: "During",
    icon: Handshake,
    items: [
      { id: "open", text: "Stay in the open, not in a car" },
      { id: "inspect", text: "Inspect before any money changes hands" },
      { id: "cash", text: "Buyers: count cash privately first" },
      { id: "reset", text: "Sellers: reset devices in front of the buyer" },
      { id: "phone", text: "Keep your phone charged" },
      { id: "gut", text: "Leave if something feels wrong" },
    ],
  },
  {
    id: "after",
    title: "After",
    icon: CheckCircle2,
    items: [
      { id: "leave", text: "Put money away before you leave" },
      { id: "safe", text: "Tell your contact you're safe" },
      { id: "listing", text: "Mark your listing sold" },
      { id: "report", text: "Report anything suspicious" },
    ],
  },
];

const STORAGE_KEY = "vm-meeting-checklist";
const TOTAL = PHASES.reduce((sum, phase) => sum + phase.items.length, 0);

function itemKey(phaseId: string, itemId: string) {
  return `${phaseId}.${itemId}`;
}

// Ticks live in localStorage (per device) with an in-memory fallback when storage
// is blocked. useSyncExternalStore keeps the server render and hydration in sync.
let memorySnapshot = "{}";
const listeners = new Set<() => void>();

function readSnapshot(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? memorySnapshot;
  } catch {
    return memorySnapshot;
  }
}

function writeSnapshot(next: Record<string, boolean>) {
  memorySnapshot = JSON.stringify(next);
  try {
    window.localStorage.setItem(STORAGE_KEY, memorySnapshot);
  } catch {
    // Storage can be unavailable (private mode); the checklist still works in memory.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function parseSnapshot(snapshot: string): Record<string, boolean> {
  try {
    const parsed: unknown = JSON.parse(snapshot);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

export function MeetingChecklist() {
  const snapshot = useSyncExternalStore(subscribe, readSnapshot, () => "{}");
  const checked = useMemo(() => parseSnapshot(snapshot), [snapshot]);
  const update = writeSnapshot;

  const doneCount = useMemo(() => Object.values(checked).filter(Boolean).length, [checked]);
  const percent = Math.round((doneCount / TOTAL) * 100);

  return (
    <div className="space-y-6">
      <div className="surface-card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground" aria-live="polite">
            {doneCount === TOTAL
              ? "All done. Stay alert and enjoy the deal."
              : `${doneCount} of ${TOTAL} checked`}
          </p>
          <div
            className="mt-2 h-2 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label="Checklist progress"
            aria-valuemin={0}
            aria-valuemax={TOTAL}
            aria-valuenow={doneCount}
          >
            <div
              className="h-full rounded-full bg-brand-green-600 transition-[width] duration-300 ease-out motion-reduce:transition-none dark:bg-brand-green-400"
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Saved on this device only.</p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="h-11 shrink-0"
          onClick={() => update({})}
          disabled={doneCount === 0}
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Clear ticks
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {PHASES.map((phase) => {
          const PhaseIcon = phase.icon;
          const phaseDone = phase.items.filter(
            (item) => checked[itemKey(phase.id, item.id)]
          ).length;
          return (
            <section
              key={phase.id}
              aria-labelledby={`${phase.id}-title`}
              className="flex flex-col overflow-hidden rounded-3xl border border-border/70 bg-card elev-xs"
            >
              <header className="flex items-start gap-3 border-b border-border/60 p-5">
                <span className="icon-tile area-market-tile">
                  <PhaseIcon className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <h2
                    id={`${phase.id}-title`}
                    className="font-display text-lg font-bold leading-6 text-foreground"
                  >
                    {phase.title}
                  </h2>
                </div>
                <span className="chip shrink-0 tabular-nums">
                  {phaseDone}/{phase.items.length}
                </span>
              </header>
              <ul className="flex-1 space-y-1 p-2">
                {phase.items.map((item) => {
                  const key = itemKey(phase.id, item.id);
                  const isChecked = Boolean(checked[key]);
                  return (
                    <li key={item.id}>
                      <label
                        className={cn(
                          "flex min-h-12 cursor-pointer items-start gap-3 rounded-2xl px-3 py-3 transition-colors hover:bg-muted/70",
                          isChecked && "bg-brand-green/5 dark:bg-brand-green/10"
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => update({ ...checked, [key]: e.target.checked })}
                          className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer rounded accent-brand-green-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        />
                        <span
                          className={cn(
                            "flex-1 text-sm leading-6 text-foreground",
                            isChecked && "text-muted-foreground line-through decoration-1"
                          )}
                        >
                          {item.text}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
