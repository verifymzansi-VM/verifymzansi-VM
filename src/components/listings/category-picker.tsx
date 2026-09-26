"use client";

import { useId, useState } from "react";
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
import { Check, ChevronDown, Lightbulb } from "lucide-react";

/** Native select styled to match `Input`. */
const SELECT_CLASS =
  "flex h-11 w-full rounded-xl border border-input bg-card px-3.5 py-2 text-base shadow-xs transition-colors hover:border-foreground/30 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:h-10 sm:text-sm";

const CATEGORY_TIPS: Partial<Record<ListingCategory, string>> = {
  property: "Add levies, rates and security. Buyers ask about these first.",
  vehicles: "Add mileage and service history. Buyers filter by them.",
  jobs_services: "Include the pay or rate range.",
};

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

  const tip = selectedCategory ? CATEGORY_TIPS[selectedCategory.value as ListingCategory] : null;

  return (
    <div className="space-y-4">
      <div>
        <p id="listing-category-label" className="text-sm font-semibold text-foreground">
          Category *
        </p>
      </div>

      {/* Category Grid */}
      <div
        role="group"
        aria-labelledby="listing-category-label"
        className="grid grid-cols-2 gap-2.5 sm:grid-cols-3"
      >
        {CATEGORIES.map((cat) => {
          const Icon = cat.icon;
          const isSelected = expanded === cat.value;

          return (
            <button
              key={cat.value}
              type="button"
              aria-label={cat.label}
              aria-pressed={isSelected}
              onClick={() => handleSelect(cat)}
              className={cn(
                "relative flex min-h-[4.5rem] items-center gap-3 rounded-2xl border p-3 text-left transition-colors duration-200",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                isSelected
                  ? "border-brand-green-600 bg-brand-green-50 ring-1 ring-brand-green-600 dark:border-brand-green-400 dark:bg-brand-green-950/50 dark:ring-brand-green-400"
                  : "border-border bg-card hover:border-foreground/25 hover:bg-muted/50"
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors",
                  isSelected
                    ? "bg-brand-green-600 text-white dark:bg-brand-green-400 dark:text-brand-green-950"
                    : "bg-muted text-foreground/70"
                )}
              >
                <Icon className="h-[18px] w-[18px]" />
              </span>
              <span
                className={cn(
                  "min-w-0 text-[13px] font-semibold leading-snug",
                  isSelected ? "text-brand-green-800 dark:text-brand-green-200" : "text-foreground"
                )}
              >
                {cat.label}
              </span>
              {isSelected && (
                <Check
                  aria-hidden="true"
                  strokeWidth={3}
                  className="absolute right-2 top-2 h-3.5 w-3.5 text-brand-green-700 dark:text-brand-green-300"
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Expanded Attribute Fields */}
      {selectedCategory && selectedCategory.attributeFields.length > 0 && (
        <div className="space-y-4 rounded-2xl border border-border bg-muted/30 p-4">
          <div className="flex items-start gap-2.5">
            <span
              aria-hidden="true"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg area-market-tile"
            >
              <selectedCategory.icon className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">
                {selectedCategory.label} details
              </p>
            </div>
          </div>

          {tip ? (
            <p className="flex items-start gap-2 rounded-xl bg-card px-3 py-2 text-xs leading-5 text-muted-foreground">
              <Lightbulb
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-gold-700 dark:text-brand-gold-300"
                aria-hidden="true"
              />
              {tip}
            </p>
          ) : null}

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
                    <div key={group.label} className="rounded-xl border border-border bg-card">
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        onClick={() => {
                          setExpandedGroups((prev) => {
                            const next = new Set(prev);
                            if (next.has(group.label)) next.delete(group.label);
                            else next.add(group.label);
                            return next;
                          });
                        }}
                        className="flex min-h-11 w-full items-center justify-between rounded-xl px-3 py-2 text-sm font-semibold text-foreground/80 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span>{group.label}</span>
                        <ChevronDown
                          aria-hidden="true"
                          className={cn(
                            "h-4 w-4 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none",
                            isOpen && "rotate-180"
                          )}
                        />
                      </button>
                      {isOpen && (
                        <div className="grid grid-cols-1 gap-3 px-3 pb-3 sm:grid-cols-2">
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
  const reactId = useId();
  const inputId = `listing-attribute-${field.name}`;
  const errorId = `${reactId}-error`;
  const describedBy = error ? errorId : undefined;
  const errorNode = error ? (
    <p id={errorId} className="inline-form-error">
      {error}
    </p>
  ) : null;

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
          <Label htmlFor={inputId}>
            {field.label} {field.required && "*"}
          </Label>
          <select
            id={inputId}
            data-listing-attribute={field.name}
            aria-label={field.label}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            value={value as string}
            onChange={(e) => onChange(e.target.value)}
            required={field.required}
            disabled={!!isDisabled}
            className={cn(SELECT_CLASS, error && "border-destructive")}
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
          {errorNode}
        </div>
      );
    }

    case "number":
      return (
        <div className="space-y-1.5">
          <Label htmlFor={inputId}>
            {field.label}
            {field.unit ? ` (${field.unit})` : ""}
            {field.required ? " *" : ""}
          </Label>
          <Input
            id={inputId}
            data-listing-attribute={field.name}
            type="number"
            inputMode="numeric"
            min="0"
            placeholder={field.placeholder}
            value={value as string}
            onChange={(e) => onChange(e.target.value)}
            required={field.required}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className={cn(error && "border-destructive")}
          />
          {errorNode}
        </div>
      );

    case "boolean":
      return (
        <div className="space-y-1 sm:self-end">
          <label className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl border border-input bg-card px-3 text-sm font-medium text-foreground transition-colors hover:border-foreground/30">
            <input
              id={inputId}
              type="checkbox"
              aria-label={field.label}
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy}
              data-listing-attribute={field.name}
              className={cn(
                "h-4 w-4 rounded border-input accent-brand-green-600",
                error && "border-destructive"
              )}
              checked={value as boolean}
              onChange={(e) => onChange(e.target.checked)}
            />
            <span>{field.label}</span>
          </label>
          {errorNode}
        </div>
      );

    case "text":
    default:
      return (
        <div className="space-y-1.5">
          <Label htmlFor={inputId}>
            {field.label} {field.required && "*"}
          </Label>
          <Input
            id={inputId}
            data-listing-attribute={field.name}
            placeholder={field.placeholder}
            value={value as string}
            onChange={(e) => onChange(e.target.value)}
            required={field.required}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className={cn(error && "border-destructive")}
          />
          {errorNode}
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
        <fieldset
          id={inputId}
          tabIndex={-1}
          aria-describedby={describedBy}
          className="space-y-1.5 sm:col-span-2"
        >
          <legend className="mb-1.5 text-sm font-medium leading-none">
            {field.label} {field.required && "*"}
          </legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {options.map((opt) => {
              const optionValue = typeof opt === "string" ? opt : opt.value;
              const optionLabel = typeof opt === "string" ? opt.replace(/_/g, " ") : opt.label;
              const isChecked = selected.includes(optionValue);

              return (
                <label
                  key={optionValue}
                  className={cn(
                    "flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium transition-colors",
                    isChecked
                      ? "border-brand-green-600 bg-brand-green-50 text-brand-green-800 dark:border-brand-green-400 dark:bg-brand-green-950/50 dark:text-brand-green-200"
                      : "border-input bg-card text-foreground/80 hover:border-foreground/30"
                  )}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleItem(optionValue)}
                    className="h-4 w-4 shrink-0 rounded border-input accent-brand-green-600"
                  />
                  <span className="first-letter:uppercase">{optionLabel}</span>
                </label>
              );
            })}
          </div>
          {errorNode}
        </fieldset>
      );
    }
  }
}
