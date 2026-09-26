"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CATEGORIES, type AttributeField } from "@/lib/constants/categories";
import { getModelsForMake } from "@/lib/constants/sa-vehicles";
import { cn } from "@/lib/utils";
import { filterInputClass, filterSelectClass } from "./filter-controls";

type AttributeFilterValue = string | boolean | string[] | undefined;

interface ListingAttributeFiltersProps {
  category?: string;
  attributes: Record<string, AttributeFilterValue>;
  onAttributeChange: (name: string, value: AttributeFilterValue) => void;
  density?: "drawer" | "sidebar";
}

function numberRangeOptions(field: AttributeField): string[] | null {
  const countableFields = ["bedrooms", "bathrooms", "parking_spots"];
  if (countableFields.includes(field.name)) {
    return ["1", "2", "3", "4", "5+"];
  }
  return null;
}

function resolveOption(option: string | { value: string; label: string }) {
  return typeof option === "string" ? { value: option, label: option } : option;
}

function getFilterableAttributeFields(category?: string) {
  return (
    CATEGORIES.find((entry) => entry.value === category)?.attributeFields.filter(
      (field) =>
        field.type === "select" ||
        field.type === "boolean" ||
        field.type === "number" ||
        field.type === "text" ||
        field.type === "checklist"
    ) ?? []
  );
}

export function ListingAttributeFilters({
  category,
  attributes,
  onAttributeChange,
  density = "drawer",
}: ListingAttributeFiltersProps) {
  const selectedCategory = CATEGORIES.find((entry) => entry.value === category);
  const filterableAttributes = getFilterableAttributeFields(category);

  if (!selectedCategory || filterableAttributes.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3 rounded-xl border border-border/70 bg-muted/40 p-3.5">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <selectedCategory.icon
          className="h-4 w-4 text-brand-green-700 dark:text-brand-green-300"
          aria-hidden="true"
        />
        {selectedCategory.label} filters
      </p>

      {filterableAttributes.map((field) => (
        <FilterAttributeField
          key={field.name}
          field={field}
          value={attributes[field.name]}
          allAttributes={attributes}
          density={density}
          onChange={(nextValue) => {
            onAttributeChange(field.name, nextValue);
            if (field.name === "make") {
              onAttributeChange("model", undefined);
            }
          }}
        />
      ))}
    </div>
  );
}

function FilterAttributeField({
  field,
  value,
  allAttributes,
  density,
  onChange,
}: {
  field: AttributeField;
  value: AttributeFilterValue;
  allAttributes: Record<string, AttributeFilterValue>;
  density: "drawer" | "sidebar";
  onChange: (value: AttributeFilterValue) => void;
}) {
  const inputId = `listing-attr-${density}-${field.name}`;
  const selectClass = filterSelectClass;
  const labelClassName = "text-sm font-medium";

  switch (field.type) {
    case "select": {
      let options = field.options ?? [];
      if (field.dependsOn === "make") {
        const parentMake = allAttributes.make as string;
        options = parentMake ? [...getModelsForMake(parentMake), "Other"] : [];
      }

      const parentValue = field.dependsOn ? allAttributes[field.dependsOn] : undefined;
      const isDisabled = field.dependsOn && !parentValue;

      return (
        <div className="space-y-1.5">
          <Label htmlFor={inputId} className={labelClassName}>
            {field.label}
          </Label>
          <select
            id={inputId}
            aria-label={field.label}
            className={selectClass}
            value={(value as string) || ""}
            onChange={(event) => onChange(event.target.value || undefined)}
            disabled={!!isDisabled}
          >
            <option value="">
              {isDisabled ? `Select ${field.dependsOn} first` : `Any ${field.label.toLowerCase()}`}
            </option>
            {options.map((option) => {
              const resolved = resolveOption(option);
              return (
                <option key={resolved.value} value={resolved.value}>
                  {resolved.label}
                </option>
              );
            })}
          </select>
        </div>
      );
    }

    case "number": {
      const rangeOptions = numberRangeOptions(field);
      if (rangeOptions) {
        return (
          <div className="space-y-1.5">
            <Label htmlFor={inputId} className={labelClassName}>
              {field.label}
              {field.unit ? ` (${field.unit})` : ""}
            </Label>
            <select
              id={inputId}
              aria-label={field.label}
              className={selectClass}
              value={(value as string) || ""}
              onChange={(event) => onChange(event.target.value || undefined)}
            >
              <option value="">Any</option>
              {rangeOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
        );
      }

      return (
        <div className="space-y-1.5">
          <Label htmlFor={inputId} className={labelClassName}>
            {field.label}
            {field.unit ? ` (${field.unit})` : ""}
          </Label>
          <Input
            id={inputId}
            type="number"
            inputMode="numeric"
            min={0}
            placeholder={field.placeholder || "Any"}
            className={filterInputClass}
            value={(value as string) || ""}
            onChange={(event) => onChange(event.target.value || undefined)}
          />
        </div>
      );
    }

    case "boolean":
      return (
        <label className="flex min-h-11 items-center gap-2.5 lg:min-h-9" htmlFor={inputId}>
          <input
            id={inputId}
            type="checkbox"
            aria-label={field.label}
            className="h-4 w-4 rounded border-input text-brand-green focus:ring-brand-green"
            checked={(value as boolean) || false}
            onChange={(event) => onChange(event.target.checked ? true : undefined)}
          />
          <span className={cn("cursor-pointer font-normal", labelClassName)}>{field.label}</span>
        </label>
      );

    case "text":
      return (
        <div className="space-y-1.5">
          <Label htmlFor={inputId} className={labelClassName}>
            {field.label}
          </Label>
          <Input
            id={inputId}
            type="text"
            placeholder={field.placeholder || `Any ${field.label.toLowerCase()}`}
            className={filterInputClass}
            value={(value as string) || ""}
            onChange={(event) => onChange(event.target.value || undefined)}
          />
        </div>
      );

    case "checklist": {
      const options = field.options ?? [];
      const selected = Array.isArray(value) ? value : [];

      function toggleFilterItem(optionValue: string) {
        const next = selected.includes(optionValue)
          ? selected.filter((v) => v !== optionValue)
          : [...selected, optionValue];
        onChange(next.length > 0 ? next : undefined);
      }

      return (
        <div className="space-y-1.5">
          <p className={labelClassName}>{field.label}</p>
          <div className="flex flex-wrap gap-1.5">
            {options.map((opt) => {
              const optVal = typeof opt === "string" ? opt : opt.value;
              const optLabel =
                typeof opt === "string"
                  ? opt.charAt(0).toUpperCase() + opt.slice(1).replace(/_/g, " ")
                  : opt.label;
              const isChecked = selected.includes(optVal);

              return (
                <label
                  key={optVal}
                  className={cn(
                    "flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors focus-within:ring-2 focus-within:ring-ring",
                    isChecked
                      ? "border-brand-green-600 bg-brand-green-50 text-brand-green-800 dark:bg-brand-green/15 dark:text-brand-green-200"
                      : "border-border bg-card text-muted-foreground hover:border-foreground/25"
                  )}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleFilterItem(optVal)}
                    className="h-3.5 w-3.5 rounded border-input text-brand-green focus:ring-brand-green"
                  />
                  <span>{optLabel}</span>
                </label>
              );
            })}
          </div>
        </div>
      );
    }

    default:
      return null;
  }
}
