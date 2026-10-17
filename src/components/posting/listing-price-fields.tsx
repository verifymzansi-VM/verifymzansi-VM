"use client";

import { useEffect, useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ListingCategory } from "@/types/enums";
import {
  changeListingPriceMode,
  changeListingPriceCategory,
  type ListingPriceForm,
} from "@/lib/domains/listings/price-form";

export function ListingPriceFields({
  value,
  onChange,
  category,
  disabled = false,
  error,
}: {
  value: ListingPriceForm;
  onChange: (next: ListingPriceForm) => void;
  category: ListingCategory;
  disabled?: boolean;
  error?: string;
}) {
  const id = useId();
  const isJob = category === "jobs_services";
  useEffect(() => {
    const normalized = changeListingPriceCategory(value, category);
    if (normalized.mode !== value.mode || normalized.negotiable !== value.negotiable)
      onChange(normalized);
  }, [category, value, onChange]);
  const choices = [
    { mode: "amount" as const, label: isJob ? "Salary amount" : "Enter a price" },
    ...(!isJob ? [{ mode: "free" as const, label: "Free" }] : []),
    { mode: "on_request" as const, label: isJob ? "Salary not provided" : "Price on request" },
  ];
  return (
    <fieldset
      disabled={disabled}
      className="space-y-3"
      aria-describedby={error ? `${id}-error` : undefined}
    >
      <legend className="text-sm font-medium">{isJob ? "Salary" : "Price"}</legend>
      <div className="flex flex-wrap gap-4">
        {choices.map(({ mode, label }) => (
          <label key={mode} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name={`${id}-mode`}
              value={mode}
              checked={value.mode === mode}
              onChange={() => onChange(changeListingPriceMode(value, mode))}
            />
            {label}
          </label>
        ))}
      </div>
      {value.mode === "amount" && (
        <div className="space-y-2">
          <Label htmlFor={`${id}-amount`}>{isJob ? "Salary (R)" : "Price (R)"}</Label>
          <Input
            id={`${id}-amount`}
            inputMode="decimal"
            type="text"
            maxLength={16}
            value={value.amount}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `${id}-error` : undefined}
            placeholder="0.00"
            onChange={(event) => onChange({ ...value, amount: event.target.value })}
          />
        </div>
      )}
      {!isJob && (value.mode === "amount" || value.mode === "on_request") && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value.negotiable}
            onChange={(event) => onChange({ ...value, negotiable: event.target.checked })}
          />
          Price negotiable
        </label>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </fieldset>
  );
}
