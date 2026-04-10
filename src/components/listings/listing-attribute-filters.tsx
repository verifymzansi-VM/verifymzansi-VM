"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CATEGORIES, type AttributeField } from "@/lib/constants/categories";
import { getModelsForMake } from "@/lib/constants/sa-vehicles";
import { cn } from "@/lib/utils";

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
  const compact = density === "sidebar";

  if (!selectedCategory || filterableAttributes.length === 0) {
    return null;
  }

  return (
    <div className="rounded-xl border border-brand-green/30 bg-brand-green/5 p-3 space-y-3 animate-in fade-in-0 slide-in-from-top-2 duration-300">
      <p
        className={cn(
          "font-semibold text-brand-green flex items-center gap-1.5",
          compact ? "text-xs" : "text-sm"
        )}
      >
        <selectedCategory.icon className={cn(compact ? "h-3.5 w-3.5" : "h-4 w-4")} />
        {selectedCategory.label} Filters
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
  const compact = density === "sidebar";
  const fieldId = `filter-${density}-${field.name}`;
  const selectClass = cn(
    "w-full rounded-md border border-input bg-background px-3 py-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
    compact ? "text-xs" : "text-sm"
  );
  const labelClassName = compact ? "text-xs" : "text-sm";

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
        <div className={compact ? "space-y-1" : "space-y-1.5"}>
          <Label htmlFor={fieldId} className={labelClassName}>
            {field.label}
          </Label>
          <select
            id={fieldId}
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
          <div className={compact ? "space-y-1" : "space-y-1.5"}>
            <Label htmlFor={fieldId} className={labelClassName}>
              {field.label}
              {field.unit ? ` (${field.unit})` : ""}
            </Label>
            <select
              id={fieldId}
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
        <div className={compact ? "space-y-1" : "space-y-1.5"}>
          <Label htmlFor={fieldId} className={labelClassName}>
            {field.label}
            {field.unit ? ` (${field.unit})` : ""}
          </Label>
          <Input
            id={fieldId}
            type="number"
            inputMode="numeric"
            min={0}
            placeholder={field.placeholder || "Any"}
            className={compact ? "h-8 text-xs" : undefined}
            value={(value as string) || ""}
            onChange={(event) => onChange(event.target.value || undefined)}
          />
        </div>
      );
    }

    case "boolean":
      return (
        <div className="flex items-center gap-2">
          <input
            id={fieldId}
            type="checkbox"
            aria-label={field.label}
            className={cn(
              "rounded border-input text-brand-green focus:ring-brand-green",
              compact ? "h-3.5 w-3.5" : "h-4 w-4"
            )}
            checked={(value as boolean) || false}
            onChange={(event) => onChange(event.target.checked ? true : undefined)}
          />
          <Label htmlFor={fieldId} className={cn("cursor-pointer font-normal", labelClassName)}>
            {field.label}
          </Label>
        </div>
      );

    case "text":
      return (
        <div className={compact ? "space-y-1" : "space-y-1.5"}>
          <Label htmlFor={fieldId} className={labelClassName}>
            {field.label}
          </Label>
          <Input
            id={fieldId}
            type="text"
            placeholder={field.placeholder || `Any ${field.label.toLowerCase()}`}
            className={compact ? "h-8 text-xs" : undefined}
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
        <div className={compact ? "space-y-1" : "space-y-1.5"}>
          <Label className={labelClassName}>{field.label}</Label>
          <div className="flex flex-wrap gap-1.5">
            {options.map((opt) => {
              const optVal = typeof opt === "string" ? opt : opt.value;
              const optLabel = typeof opt === "string" ? opt.replace(/_/g, " ") : opt.label;
              const isChecked = selected.includes(optVal);

              return (
                <label
                  key={optVal}
                  className={cn(
                    "flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 transition-all",
                    compact ? "text-[10px]" : "text-xs",
                    isChecked
                      ? "border-brand-green bg-brand-green/10 text-brand-green"
                      : "border-input text-muted-foreground hover:border-brand-green/40"
                  )}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleFilterItem(optVal)}
                    className={cn(
                      "rounded border-input text-brand-green focus:ring-brand-green",
                      compact ? "h-3 w-3" : "h-3.5 w-3.5"
                    )}
                  />
                  <span className="capitalize">{optLabel}</span>
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
