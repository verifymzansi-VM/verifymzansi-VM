"use client";

import { useState } from "react";
import {
  CATEGORIES,
  type CategoryDefinition,
  type AttributeField,
} from "@/lib/constants/categories";
import { getModelsForMake } from "@/lib/constants/sa-vehicles";
import type { ListingCategory } from "@/types/enums";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight } from "lucide-react";

/* ─── Collapsible field groups by category ──────────────────────── */
const COLLAPSIBLE_GROUPS: Partial<Record<ListingCategory, { label: string; fields: string[] }[]>> =
  {
    property: [
      {
        label: "Security & Features",
        fields: ["security_features", "pool", "garden", "domestic_quarters", "garage"],
      },
      {
        label: "Utilities",
        fields: ["energy_features", "water_source", "fibre"],
      },
    ],
    vehicles: [
      {
        label: "Extras & Features",
        fields: ["extras"],
      },
      {
        label: "History & Ownership",
        fields: ["service_history", "number_of_owners", "accident_free"],
      },
    ],
  };

interface CategoryPickerProps {
  value: ListingCategory | "";
  onChange: (category: ListingCategory) => void;
  attributes: Record<string, string | boolean | string[]>;
  onAttributeChange: (name: string, value: string | boolean | string[]) => void;
  errors?: Record<string, string>;
}

export function CategoryPicker({
  value,
  onChange,
  attributes,
  onAttributeChange,
  errors = {},
}: CategoryPickerProps) {
  const [expanded, setExpanded] = useState<ListingCategory | "">(value);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const selectedCategory = CATEGORIES.find((c) => c.value === expanded);

  function handleSelect(cat: CategoryDefinition) {
    setExpanded(cat.value);
    onChange(cat.value);

    // Auto-focus: after selecting a category, focus the first attribute field or fall back to the title input
    requestAnimationFrame(() => {
      if (cat.attributeFields.length > 0) {
        const firstFieldName = cat.attributeFields[0].name;
        const el = document.querySelector<HTMLElement>(
          `[data-listing-attribute="${firstFieldName}"]`
        );
        if (el) {
          el.focus();
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          return;
        }
      }
      const titleEl = document.getElementById("title");
      if (titleEl) {
        titleEl.focus();
        titleEl.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
  }

  function isConditionallyVisible(field: AttributeField) {
    if (!field.dependsOnValue || !field.dependsOn) {
      return true;
    }

    const parentValue = attributes[field.dependsOn];
    if (parentValue === undefined || parentValue === null || parentValue === "") {
      return false;
    }

    const allowedValues = Array.isArray(field.dependsOnValue)
      ? field.dependsOnValue
      : [field.dependsOnValue];
    return allowedValues.includes(String(parentValue));
  }

  return (
    <div className="space-y-4">
      <Label>Category *</Label>

      {/* Category Grid */}
      <div aria-label="Category" className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {CATEGORIES.map((cat) => {
          const Icon = cat.icon;
          const isSelected = expanded === cat.value;

          return (
            <button
              key={cat.value}
              type="button"
              aria-label={cat.label}
              onClick={() => handleSelect(cat)}
              className={cn(
                "relative flex flex-col items-center gap-1.5 rounded-xl border-2 p-3 text-center transition-all duration-200",
                "hover:border-brand-green/60 hover:bg-brand-green/5 hover:shadow-sm",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                isSelected
                  ? "border-brand-green bg-brand-green/10 shadow-md"
                  : "border-muted bg-background"
              )}
            >
              <div
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
                  isSelected ? "bg-brand-green text-white" : "bg-muted text-muted-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
              </div>
              <span
                className={cn(
                  "text-xs font-medium leading-tight",
                  isSelected ? "text-brand-green" : "text-foreground"
                )}
              >
                {cat.label}
              </span>
              {isSelected && (
                <ChevronRight className="absolute right-2 top-2 h-4 w-4 text-brand-green" />
              )}
            </button>
          );
        })}
      </div>

      {/* Expanded Attribute Fields */}
      {selectedCategory && selectedCategory.attributeFields.length > 0 && (
        <div className="rounded-xl border border-brand-green/30 bg-brand-green/5 p-3 space-y-3 animate-in fade-in-0 slide-in-from-top-2 duration-300">
          <p className="text-sm font-semibold text-brand-green flex items-center gap-1.5">
            <selectedCategory.icon className="h-4 w-4" />
            {selectedCategory.label} — Details
          </p>

          {/* Smart tip */}
          {selectedCategory.value === "property" && (
            <p className="text-xs text-muted-foreground bg-background/60 rounded-md px-2.5 py-1.5">
              💡 Listings with levy and security info get 40% more enquiries.
            </p>
          )}
          {selectedCategory.value === "vehicles" && (
            <p className="text-xs text-muted-foreground bg-background/60 rounded-md px-2.5 py-1.5">
              💡 Buyers filter by service history — fill it in to appear in more searches.
            </p>
          )}
          {selectedCategory.value === "jobs_services" && (
            <p className="text-xs text-muted-foreground bg-background/60 rounded-md px-2.5 py-1.5">
              💡 Include salary range to attract 3× more applicants.
            </p>
          )}

          {/* Required field legend */}
          <p className="text-xs text-muted-foreground">
            Fields marked <span className="font-medium text-foreground">*</span> are required.
            Optional fields help your listing stand out.
          </p>

          {(() => {
            const groups = COLLAPSIBLE_GROUPS[selectedCategory.value as ListingCategory] ?? [];
            const groupedFieldNames = new Set(groups.flatMap((g) => g.fields));
            const mainFields = selectedCategory.attributeFields.filter(
              (f) => !groupedFieldNames.has(f.name) && isConditionallyVisible(f)
            );

            function renderField(field: AttributeField) {
              return (
                <AttributeInput
                  key={field.name}
                  field={field}
                  value={
                    attributes[field.name] ??
                    (field.type === "boolean" ? false : field.type === "checklist" ? [] : "")
                  }
                  allAttributes={attributes}
                  onChange={(val) => {
                    onAttributeChange(field.name, val);
                    if (field.name === "make") {
                      onAttributeChange("model", "");
                    }
                  }}
                  error={errors[`attributes.${field.name}`]}
                />
              );
            }

            return (
              <>
                {mainFields.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {mainFields.map(renderField)}
                  </div>
                )}
                {groups.map((group) => {
                  const groupFields = group.fields
                    .map((name) => selectedCategory.attributeFields.find((f) => f.name === name))
                    .filter((f): f is AttributeField => !!f && isConditionallyVisible(f));
                  if (groupFields.length === 0) return null;
                  const isOpen = expandedGroups.has(group.label);
                  return (
                    <div key={group.label} className="rounded-lg border border-border/60">
                      <button
                        type="button"
                        onClick={() => {
                          setExpandedGroups((prev) => {
                            const next = new Set(prev);
                            if (next.has(group.label)) next.delete(group.label);
                            else next.add(group.label);
                            return next;
                          });
                        }}
                        className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <span>{group.label}</span>
                        <ChevronDown
                          className={cn(
                            "h-4 w-4 transition-transform duration-200",
                            isOpen && "rotate-180"
                          )}
                        />
                      </button>
                      {isOpen && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 px-3 pb-3 animate-in fade-in-0 slide-in-from-top-1 duration-200">
                          {groupFields.map(renderField)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}

/* ─── Individual Attribute Field Renderer ────────────────────────── */

function AttributeInput({
  field,
  value,
  allAttributes,
  onChange,
  error,
}: {
  field: AttributeField;
  value: string | boolean | string[];
  allAttributes: Record<string, string | boolean | string[]>;
  onChange: (value: string | boolean | string[]) => void;
  error?: string;
}) {
  const selectClass =
    "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

  switch (field.type) {
    case "select": {
      // Resolve options dynamically for cascading selects
      let options = field.options ?? [];
      if (field.dependsOn === "make") {
        const parentMake = allAttributes["make"] as string;
        options = parentMake ? [...getModelsForMake(parentMake), "Other"] : [];
      }

      const parentValue = field.dependsOn ? allAttributes[field.dependsOn] : undefined;
      const isDisabled = field.dependsOn && !parentValue;

      return (
        <div className="space-y-1.5">
          <Label>
            {field.label} {field.required && "*"}
          </Label>
          <select
            data-listing-attribute={field.name}
            aria-label={field.label}
            value={value as string}
            onChange={(e) => onChange(e.target.value)}
            required={field.required}
            disabled={!!isDisabled}
            className={cn(selectClass, error && "border-destructive")}
          >
            <option value="">
              {isDisabled
                ? `Select ${field.dependsOn} first`
                : `Select ${field.label.toLowerCase()}`}
            </option>
            {options.map((opt) => {
              const optionValue = typeof opt === "string" ? opt : opt.value;
              const optionLabel = typeof opt === "string" ? opt : opt.label;

              return (
                <option key={optionValue} value={optionValue}>
                  {optionLabel}
                </option>
              );
            })}
          </select>
          {error && <p className="inline-form-error">{error}</p>}
        </div>
      );
    }

    case "number":
      return (
        <div className="space-y-1.5">
          <Label>
            {field.label}
            {field.unit ? ` (${field.unit})` : ""}
            {field.required ? " *" : ""}
          </Label>
          <Input
            data-listing-attribute={field.name}
            type="number"
            inputMode="numeric"
            min="0"
            placeholder={field.placeholder}
            value={value as string}
            onChange={(e) => onChange(e.target.value)}
            required={field.required}
            className={cn(error && "border-destructive")}
          />
          {error && <p className="inline-form-error">{error}</p>}
        </div>
      );

    case "boolean":
      return (
        <div className="space-y-1">
          <label className="flex items-center gap-2 self-end pb-1">
            <input
              type="checkbox"
              aria-label={field.label}
              data-listing-attribute={field.name}
              className={cn(
                "h-4 w-4 rounded border-input text-brand-green focus:ring-brand-green",
                error && "border-destructive"
              )}
              checked={value as boolean}
              onChange={(e) => onChange(e.target.checked)}
            />
            <span className="cursor-pointer text-sm font-normal">{field.label}</span>
          </label>
          {error && <p className="inline-form-error">{error}</p>}
        </div>
      );

    case "text":
    default:
      return (
        <div className="space-y-1.5">
          <Label>
            {field.label} {field.required && "*"}
          </Label>
          <Input
            data-listing-attribute={field.name}
            placeholder={field.placeholder}
            value={value as string}
            onChange={(e) => onChange(e.target.value)}
            required={field.required}
            className={cn(error && "border-destructive")}
          />
          {error && <p className="inline-form-error">{error}</p>}
        </div>
      );

    case "checklist": {
      const options = field.options ?? [];
      const selected = Array.isArray(value) ? value : [];

      function toggleItem(optionValue: string) {
        const next = selected.includes(optionValue)
          ? selected.filter((v) => v !== optionValue)
          : [...selected, optionValue];
        onChange(next);
      }

      return (
        <div className="space-y-1.5 sm:col-span-2">
          <Label>
            {field.label} {field.required && "*"}
          </Label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {options.map((opt) => {
              const optionValue = typeof opt === "string" ? opt : opt.value;
              const optionLabel = typeof opt === "string" ? opt.replace(/_/g, " ") : opt.label;
              const isChecked = selected.includes(optionValue);

              return (
                <label
                  key={optionValue}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all",
                    isChecked
                      ? "border-brand-green bg-brand-green/10 text-brand-green"
                      : "border-input text-muted-foreground hover:border-brand-green/40 hover:bg-muted/50"
                  )}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleItem(optionValue)}
                    className="h-3.5 w-3.5 rounded border-input text-brand-green focus:ring-brand-green"
                  />
                  <span className="capitalize">{optionLabel}</span>
                </label>
              );
            })}
          </div>
          {error && <p className="inline-form-error">{error}</p>}
        </div>
      );
    }
  }
}
