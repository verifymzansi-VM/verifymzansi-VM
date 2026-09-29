"use client";

import { useId, useMemo } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  getProvinceNames,
  getCitiesForProvince,
  getTownsForCity,
} from "@/lib/constants/sa-provinces";
import { cn } from "@/lib/utils";

const SELECT_CLASS =
  "flex h-11 w-full rounded-xl border border-input bg-card px-3.5 py-2 text-base shadow-xs transition-colors hover:border-foreground/30 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:h-10 sm:text-sm";

export interface LocationValue {
  province: string;
  city: string;
  town?: string;
  address?: string;
}

export interface LocationSelectorProps {
  value: LocationValue;
  onChange: (value: LocationValue) => void;
  /** Optional id prefix for inputs. Defaults to legacy ids (province, city, town, address). */
  idPrefix?: string;
  provinceLabel?: string;
  cityLabel?: string;
  /** Show the town / suburb combobox (default: true) */
  showTown?: boolean;
  /** Offer predefined town suggestions via datalist (default: true) */
  suggestTownOptions?: boolean;
  /** Show the detailed address textarea (default: false) */
  showAddress?: boolean;
  /** Mark town as required (default: false) */
  townRequired?: boolean;
  /** Mark address as required (default: false) */
  addressRequired?: boolean;
  disabled?: boolean;
  areaRequired?: boolean;
  /** Per-field error messages keyed by "province" | "city" | "town" | "address" */
  errors?: Partial<Record<"province" | "city" | "town" | "address", string>>;
  className?: string;
}

export function LocationSelector({
  value,
  onChange,
  idPrefix,
  provinceLabel = "Province",
  cityLabel = "City or town",
  showTown = true,
  suggestTownOptions = true,
  showAddress = false,
  townRequired = false,
  addressRequired = false,
  disabled = false,
  areaRequired = true,
  errors,
  className,
}: LocationSelectorProps) {
  const uid = useId();
  const provinces = useMemo(() => getProvinceNames(), []);
  const cities = useMemo(
    () => (value.province ? getCitiesForProvince(value.province) : []),
    [value.province]
  );
  const towns = useMemo(
    () =>
      suggestTownOptions && value.province && value.city
        ? getTownsForCity(value.province, value.city)
        : [],
    [suggestTownOptions, value.province, value.city]
  );

  const townListId = `${uid}-towns`;
  const provinceId = idPrefix ? `${idPrefix}-province` : "province";
  const cityId = idPrefix ? `${idPrefix}-city` : "city";
  const townId = idPrefix ? `${idPrefix}-town` : "town";
  const addressId = idPrefix ? `${idPrefix}-address` : "address";

  const errorId = (field: string) => `${uid}-${field}-error`;

  return (
    <div className={cn("space-y-4", className)}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* ── Province ─────────────────────────────────────── */}
        <div className="space-y-1.5">
          <Label htmlFor={provinceId} className="text-sm">
            {provinceLabel}{" "}
            <span className="font-normal text-muted-foreground">
              ({areaRequired ? "Required" : "Optional"})
            </span>
          </Label>
          <select
            id={provinceId}
            title="Province"
            aria-label={provinceLabel}
            aria-invalid={errors?.province ? true : undefined}
            aria-describedby={errors?.province ? errorId("province") : undefined}
            className={cn(SELECT_CLASS, errors?.province && "border-destructive")}
            value={value.province}
            disabled={disabled}
            onChange={(e) => {
              onChange({ province: e.target.value, city: "", town: "", address: "" });
              if (e.target.value) {
                requestAnimationFrame(() => document.getElementById(cityId)?.focus());
              }
            }}
          >
            <option value="">Select province…</option>
            {provinces.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          {errors?.province && (
            <p id={errorId("province")} className="inline-form-error">
              {errors.province}
            </p>
          )}
        </div>

        {/* ── City ─────────────────────────────────────────── */}
        <div className="space-y-1.5">
          <Label htmlFor={cityId} className="text-sm">
            {cityLabel}{" "}
            <span className="font-normal text-muted-foreground">
              ({areaRequired ? "Required" : "Optional"})
            </span>
          </Label>
          <select
            id={cityId}
            title="City"
            aria-label={cityLabel}
            aria-invalid={errors?.city ? true : undefined}
            aria-describedby={errors?.city ? errorId("city") : undefined}
            className={cn(SELECT_CLASS, errors?.city && "border-destructive")}
            value={value.city}
            disabled={disabled || !value.province}
            onChange={(e) => {
              onChange({ ...value, city: e.target.value, town: "", address: value.address ?? "" });
              if (e.target.value && showTown) {
                requestAnimationFrame(() => document.getElementById(townId)?.focus());
              }
            }}
          >
            <option value="">{value.province ? "Select city…" : "Select province first"}</option>
            {cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          {errors?.city && (
            <p id={errorId("city")} className="inline-form-error">
              {errors.city}
            </p>
          )}
        </div>
      </div>

      {/* ── Town / Suburb (combobox with datalist) ────────── */}
      {showTown && (
        <div className="space-y-1.5">
          <Label htmlFor={townId} className="text-sm">
            Town / Suburb{" "}
            {townRequired ? (
              <span className="font-normal text-muted-foreground">(Required)</span>
            ) : (
              <span className="font-normal text-muted-foreground">(Optional)</span>
            )}
          </Label>
          <Input
            id={townId}
            aria-label="Town / Suburb"
            aria-describedby={errors?.town ? errorId("town") : undefined}
            list={suggestTownOptions ? townListId : undefined}
            placeholder={value.city ? "Enter your town or suburb" : "Select city first"}
            value={value.town ?? ""}
            disabled={disabled || !value.city}
            maxLength={120}
            onChange={(e) => onChange({ ...value, town: e.target.value })}
          />
          {suggestTownOptions && towns.length > 0 && (
            <datalist id={townListId}>
              {towns.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          )}
          {errors?.town && (
            <p id={errorId("town")} className="inline-form-error">
              {errors.town}
            </p>
          )}
        </div>
      )}

      {/* ── Detailed Address ─────────────────────────────── */}
      {showAddress && (
        <div className="space-y-1.5">
          <Label htmlFor={addressId} className="text-sm">
            Detailed Address{" "}
            {addressRequired ? (
              <span className="font-normal text-muted-foreground">(Required)</span>
            ) : (
              <span className="font-normal text-muted-foreground">(Optional)</span>
            )}
          </Label>
          <Textarea
            id={addressId}
            aria-label="Detailed Address"
            aria-describedby={errors?.address ? errorId("address") : undefined}
            placeholder="e.g. 123 Main Street, Corner of 5th Avenue"
            value={value.address ?? ""}
            disabled={disabled || !value.city}
            maxLength={300}
            rows={2}
            className="resize-none"
            onChange={(e) => onChange({ ...value, address: e.target.value })}
          />
          {errors?.address && (
            <p id={errorId("address")} className="inline-form-error">
              {errors.address}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
