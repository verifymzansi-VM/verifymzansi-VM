"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  LAYOUT_TEMPLATES,
  LAYOUT_TEMPLATE_IDS,
  type LayoutTemplate,
} from "@/lib/business/layout-templates";
import { CATEGORY_LAYOUT_MAP } from "@/lib/business/category-layout-map";
import type { BusinessCategory } from "@/types/enums";

interface LayoutChooserProps {
  selected: LayoutTemplate;
  onChange: (id: LayoutTemplate) => void;
  category?: BusinessCategory;
}

/**
 * Three-card picker shown in Step 3 of create/edit business.
 * Highlights the category default with a subtle badge.
 */
export function LayoutChooser({ selected, onChange, category }: LayoutChooserProps) {
  const categoryDefault = category ? CATEGORY_LAYOUT_MAP[category] : undefined;

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-muted-foreground">
        Choose how your business profile will be displayed
      </p>
      <div
        className="grid grid-cols-1 gap-3 sm:grid-cols-3"
        role="group"
        aria-label="Layout template"
      >
        {LAYOUT_TEMPLATE_IDS.map((id) => {
          const meta = LAYOUT_TEMPLATES[id];
          const isSelected = selected === id;
          const isDefault = categoryDefault === id;

          return (
            <button
              key={id}
              type="button"
              onClick={() => onChange(id)}
              className={cn(
                "group relative flex flex-col items-center gap-2 rounded-xl border-2 p-4 text-center transition-all",
                isSelected
                  ? "border-brand-blue bg-brand-blue/5 ring-2 ring-brand-blue/30 shadow-md"
                  : "border-border hover:border-brand-blue/40 hover:bg-muted/50"
              )}
            >
              {/* Check mark */}
              {isSelected && (
                <div className="absolute -right-2 -top-2 rounded-full bg-brand-blue p-1 text-white shadow">
                  <Check className="h-3.5 w-3.5" />
                </div>
              )}

              {/* Icon */}
              <div
                className={cn(
                  "flex h-12 w-12 items-center justify-center rounded-xl text-2xl transition-colors",
                  isSelected ? "bg-brand-blue/10" : "bg-muted group-hover:bg-brand-blue/5"
                )}
              >
                {meta.icon}
              </div>

              {/* Name */}
              <span className="text-sm font-semibold">{meta.name}</span>

              {/* Tagline */}
              <span className="text-xs text-muted-foreground leading-tight">{meta.tagline}</span>

              {/* Category recommended badge */}
              {isDefault && (
                <span className="mt-1 inline-block rounded-full bg-brand-blue/10 px-2.5 py-0.5 text-[10px] font-medium text-brand-blue">
                  Recommended for your category
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
