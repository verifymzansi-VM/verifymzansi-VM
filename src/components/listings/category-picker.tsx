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
import { ChevronRight } from "lucide-react";

interface CategoryPickerProps {
  value: ListingCategory | "";
  onChange: (category: ListingCategory) => void;
  attributes: Record<string, string | boolean>;
  onAttributeChange: (name: string, value: string | boolean) => void;
}

export function CategoryPicker({
  value,
  onChange,
  attributes,
  onAttributeChange,
}: CategoryPickerProps) {
  const [expanded, setExpanded] = useState<ListingCategory | "">(value);

  const selectedCategory = CATEGORIES.find((c) => c.value === expanded);

  function handleSelect(cat: CategoryDefinition) {
    setExpanded(cat.value);
    onChange(cat.value);
  }

  return (
    <div className="space-y-4">
      <Label>Category *</Label>

      {/* Category Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {CATEGORIES.map((cat) => {
          const Icon = cat.icon;
          const isSelected = expanded === cat.value;

          return (
            <button
              key={cat.value}
              type="button"
              onClick={() => handleSelect(cat)}
              className={cn(
                "relative flex flex-col items-center gap-2 rounded-xl border-2 p-4 text-center transition-all duration-200",
                "hover:border-brand-green/60 hover:bg-brand-green/5 hover:shadow-sm",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                isSelected
                  ? "border-brand-green bg-brand-green/10 shadow-md"
                  : "border-muted bg-background"
              )}
            >
              <div
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
                  isSelected ? "bg-brand-green text-white" : "bg-muted text-muted-foreground"
                )}
              >
                <Icon className="h-5 w-5" />
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
        <div className="rounded-xl border border-brand-green/30 bg-brand-green/5 p-4 space-y-4 animate-in fade-in-0 slide-in-from-top-2 duration-300">
          <p className="text-sm font-semibold text-brand-green flex items-center gap-1.5">
            <selectedCategory.icon className="h-4 w-4" />
            {selectedCategory.label} — Details
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {selectedCategory.attributeFields.map((field) => (
              <AttributeInput
                key={field.name}
                field={field}
                value={attributes[field.name] ?? (field.type === "boolean" ? false : "")}
                allAttributes={attributes}
                onChange={(val) => {
                  onAttributeChange(field.name, val);
                  // Clear dependent fields when parent changes
                  if (field.name === "make") {
                    onAttributeChange("model", "");
                  }
                }}
              />
            ))}
          </div>
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
}: {
  field: AttributeField;
  value: string | boolean;
  allAttributes: Record<string, string | boolean>;
  onChange: (value: string | boolean) => void;
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
          <Label htmlFor={field.name}>
            {field.label} {field.required && "*"}
          </Label>
          <select
            id={field.name}
            aria-label={field.label}
            className={selectClass}
            value={value as string}
            onChange={(e) => onChange(e.target.value)}
            required={field.required}
            disabled={!!isDisabled}
          >
            <option value="">
              {isDisabled
                ? `Select ${field.dependsOn} first`
                : `Select ${field.label.toLowerCase()}`}
            </option>
            {options.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>
      );
    }

    case "number":
      return (
        <div className="space-y-1.5">
          <Label htmlFor={field.name}>
            {field.label}
            {field.unit ? ` (${field.unit})` : ""}
            {field.required ? " *" : ""}
          </Label>
          <Input
            id={field.name}
            type="number"
            min="0"
            placeholder={field.placeholder}
            value={value as string}
            onChange={(e) => onChange(e.target.value)}
            required={field.required}
          />
        </div>
      );

    case "boolean":
      return (
        <div className="flex items-center gap-2 self-end pb-1">
          <input
            id={field.name}
            type="checkbox"
            className="h-4 w-4 rounded border-input text-brand-green focus:ring-brand-green"
            checked={value as boolean}
            onChange={(e) => onChange(e.target.checked)}
          />
          <Label htmlFor={field.name} className="cursor-pointer text-sm font-normal">
            {field.label}
          </Label>
        </div>
      );

    case "text":
    default:
      return (
        <div className="space-y-1.5">
          <Label htmlFor={field.name}>
            {field.label} {field.required && "*"}
          </Label>
          <Input
            id={field.name}
            placeholder={field.placeholder}
            value={value as string}
            onChange={(e) => onChange(e.target.value)}
            required={field.required}
          />
        </div>
      );
  }
}
