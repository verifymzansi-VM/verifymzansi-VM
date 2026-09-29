"use client";

import { useId, useState } from "react";
import {
  BUSINESS_CATEGORIES,
  ALL_BUSINESS_CATEGORIES,
  businessCategoryMatches,
} from "@/lib/constants/categories";
import type { BusinessCategory } from "@/types/enums";
import { FieldHelp } from "./field-help";

export function BusinessCategoryPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: BusinessCategory) => void;
}) {
  const [query, setQuery] = useState("");
  const id = useId();
  const choices = BUSINESS_CATEGORIES.filter((c) => businessCategoryMatches(c, query));
  const selected = ALL_BUSINESS_CATEGORIES.find((c) => c.value === value);
  return (
    <fieldset id="business-category-group" tabIndex={-1} className="space-y-2">
      <legend className="text-sm font-medium">What does your business mainly do? (Required)</legend>
      <p id={`${id}-hint`} className="text-sm text-muted-foreground">
        Choose one main activity. You will describe your location later.
      </p>
      <FieldHelp label="business category">
        Choose what customers come to you for. A hair salon belongs under Beauty &amp; Personal Care
        even if you work from home. Use Products and services for other things you offer.
      </FieldHelp>
      <label htmlFor={id} className="text-sm">
        Find a category
      </label>
      <input
        id={id}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="For example: braids, plumber or spaza"
        aria-describedby={`${id}-hint`}
        className="h-11 w-full rounded-xl border border-input bg-background px-3"
      />
      {selected && (
        <p className="text-sm">
          Selected: <strong>{selected.label}</strong>
          {!BUSINESS_CATEGORIES.some((c) => c.value === value) &&
            " — previous category; choose a more specific category when you are ready."}
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {choices.map((c) => (
          <button
            key={c.value}
            type="button"
            aria-pressed={value === c.value}
            onClick={() => onChange(c.value)}
            className={`rounded-xl border p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${value === c.value ? "border-primary bg-primary/10" : "border-input"}`}
          >
            <span className="block text-sm font-semibold">{c.label}</span>
            <span className="mt-1 block text-xs leading-5 text-muted-foreground">
              {c.description || "A business that does not fit the categories above"}
            </span>
          </button>
        ))}
      </div>
      {!choices.length && (
        <p role="status" className="text-sm">
          No matching category. Try another word or clear your search to see all categories.
        </p>
      )}
    </fieldset>
  );
}
