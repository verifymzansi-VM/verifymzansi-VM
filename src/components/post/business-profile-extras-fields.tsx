"use client";

import { FieldHelp } from "./field-help";
import { PostLabel as Label } from "./post-label";
import { PostSelect } from "./post-select";
import { Input } from "@/components/ui/input";

const SELECT_CLASS =
  "flex h-11 w-full rounded-xl border border-input bg-card px-3.5 py-2 text-base shadow-xs transition-colors hover:border-foreground/30 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 sm:h-10 sm:text-sm";

export type BusinessProfileExtras = {
  yearEstablished: string;
  numberOfEmployees: string;
  cipcRegistration: string;
  bbbeeLevel: string;
  languagesSpoken: string;
  loadSheddingReady: boolean;
};

export const EMPTY_BUSINESS_PROFILE_EXTRAS: BusinessProfileExtras = {
  yearEstablished: "",
  numberOfEmployees: "",
  cipcRegistration: "",
  bbbeeLevel: "",
  languagesSpoken: "",
  loadSheddingReady: false,
};

/** Read the extras the API folds into `category_details.business_profile`. */
export function readBusinessProfileExtras(categoryDetails: unknown): BusinessProfileExtras {
  const details =
    categoryDetails && typeof categoryDetails === "object"
      ? (categoryDetails as Record<string, unknown>)
      : {};
  const profile =
    details.business_profile && typeof details.business_profile === "object"
      ? (details.business_profile as Record<string, unknown>)
      : {};
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  return {
    yearEstablished:
      typeof profile.year_established === "number" ? String(profile.year_established) : "",
    numberOfEmployees: text(profile.number_of_employees),
    cipcRegistration: text(profile.cipc_registration),
    bbbeeLevel: text(profile.bbbee_level),
    languagesSpoken: text(profile.languages_spoken),
    loadSheddingReady: profile.load_shedding_ready === true,
  };
}

/** API body fields for the extras (undefined when blank). */
export function businessProfileExtrasPayload(extras: BusinessProfileExtras) {
  return {
    year_established: extras.yearEstablished ? Number(extras.yearEstablished) : undefined,
    cipc_registration: extras.cipcRegistration.trim() || undefined,
    bbbee_level: extras.bbbeeLevel || undefined,
    languages_spoken: extras.languagesSpoken.trim() || undefined,
    load_shedding_ready: extras.loadSheddingReady || undefined,
    number_of_employees: extras.numberOfEmployees || undefined,
  };
}

export function BusinessProfileExtrasFields({
  values,
  onChange,
}: {
  values: BusinessProfileExtras;
  onChange: (patch: Partial<BusinessProfileExtras>) => void;
}) {
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="yearEstablished">Year Established</Label>
          <Input
            id="yearEstablished"
            type="number"
            min={1900}
            max={new Date().getFullYear()}
            value={values.yearEstablished}
            onChange={(e) => onChange({ yearEstablished: e.target.value })}
            placeholder="e.g. 2018"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="numberOfEmployees">Number of Employees</Label>
          <PostSelect
            id="numberOfEmployees"
            aria-label="Number of employees"
            className={SELECT_CLASS}
            value={values.numberOfEmployees}
            onChange={(e) => onChange({ numberOfEmployees: e.target.value })}
          >
            <option value="">Select…</option>
            <option value="1">1 (Solo)</option>
            <option value="2_5">2 – 5</option>
            <option value="6_10">6 – 10</option>
            <option value="11_50">11 – 50</option>
            <option value="51_200">51 – 200</option>
            <option value="200_plus">200+</option>
          </PostSelect>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="cipcRegistration">Company registration number (CIPC) (Optional)</Label>
          <FieldHelp label="company registration number">
            Add your company registration number if you have one. You can leave this blank.
          </FieldHelp>
          <Input
            id="cipcRegistration"
            value={values.cipcRegistration}
            onChange={(e) => onChange({ cipcRegistration: e.target.value })}
            placeholder="e.g. 2023/123456/07"
            maxLength={30}
          />
          <p className="text-xs text-muted-foreground">
            Shown as provided. We verify people, not company records.
          </p>
        </div>

        <div className="space-y-1">
          <Label htmlFor="bbbeeLevel">B-BBEE Level</Label>
          <PostSelect
            id="bbbeeLevel"
            aria-label="B-BBEE level"
            className={SELECT_CLASS}
            value={values.bbbeeLevel}
            onChange={(e) => onChange({ bbbeeLevel: e.target.value })}
          >
            <option value="">Select…</option>
            <option value="level_1">Level 1</option>
            <option value="level_2">Level 2</option>
            <option value="level_3">Level 3</option>
            <option value="level_4">Level 4</option>
            <option value="level_5">Level 5</option>
            <option value="level_6">Level 6</option>
            <option value="level_7">Level 7</option>
            <option value="level_8">Level 8</option>
            <option value="non_compliant">Non-Compliant</option>
            <option value="exempt">Exempt (EME)</option>
          </PostSelect>
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="languagesSpoken">Languages Spoken</Label>
        <Input
          id="languagesSpoken"
          value={values.languagesSpoken}
          onChange={(e) => onChange({ languagesSpoken: e.target.value })}
          placeholder="e.g. English, isiZulu, Afrikaans"
          maxLength={200}
        />
      </div>

      <label className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl border border-input bg-card px-3 text-sm">
        <input
          type="checkbox"
          checked={values.loadSheddingReady}
          onChange={(e) => onChange({ loadSheddingReady: e.target.checked })}
          className="h-4 w-4 rounded accent-brand-blue-600"
        />
        Load-shedding ready (generator / inverter / solar)
      </label>
    </>
  );
}
