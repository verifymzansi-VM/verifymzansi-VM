"use client";

import { cn } from "@/lib/utils";
import {
  BUSINESS_DETAILS_SECTIONS,
  DAYS_OF_WEEK,
  stringifyListValue,
  type BusinessDetailsFieldConfig,
} from "@/lib/forms/business-type-details";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  OperatingHoursInput,
  formatHoursValue,
  parseHoursValue,
} from "@/components/ui/operating-hours-input";
import type { BusinessDetails } from "@/types/business-details";
import type { BusinessType } from "@/types/enums";

const RADIO_CARD =
  "flex flex-1 cursor-pointer items-start gap-3 rounded-xl border border-input bg-card px-3 py-3 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring";
const RADIO_CARD_ON =
  "border-brand-blue-600 bg-brand-blue-50 dark:border-brand-blue-400 dark:bg-brand-blue-950/40";

interface BusinessTypeDetailsFieldsProps {
  businessType: BusinessType;
  businessDetails: BusinessDetails;
  onBusinessDetailsChange: (name: string, value: unknown) => void;
  deliveryAvailable?: boolean;
  onDeliveryAvailableChange?: (deliveryAvailable: boolean) => void;
  storeNumber: string;
  onStoreNumberChange: (value: string) => void;
  serviceAreasInput: string;
  onServiceAreasChange: (value: string) => void;
  mapDirections: string;
  onMapDirectionsChange: (value: string) => void;
  fieldErrors: Record<string, string>;
  selectClassName: string;
}

function renderFieldValue(value: unknown, field: BusinessDetailsFieldConfig): string {
  if (field.kind === "list") return stringifyListValue(value);
  if (field.kind === "number") return typeof value === "number" ? String(value) : "";
  if (typeof value === "string") return value;
  return "";
}

export function BusinessTypeDetailsFields({
  businessType,
  businessDetails,
  onBusinessDetailsChange,
  deliveryAvailable = false,
  onDeliveryAvailableChange,
  storeNumber,
  onStoreNumberChange,
  serviceAreasInput,
  onServiceAreasChange,
  mapDirections,
  onMapDirectionsChange,
  fieldErrors,
  selectClassName,
}: BusinessTypeDetailsFieldsProps) {
  const section = BUSINESS_DETAILS_SECTIONS[businessType];
  const visibleFields = section.fields.filter(
    (field) =>
      businessType !== "online_only" || field.name !== "delivery_regions" || deliveryAvailable
  );

  return (
    <div className="space-y-4 rounded-2xl border border-border bg-muted/30 p-4">
      <div className="space-y-0.5">
        <h4 className="text-sm font-semibold text-foreground">{section.title}</h4>
        <p className="text-xs leading-5 text-muted-foreground">{section.description}</p>
      </div>

      {businessType === "online_only" && onDeliveryAvailableChange && (
        <div className="space-y-3">
          <p className="text-sm font-medium">Does this business deliver?</p>
          <div
            className="flex flex-col gap-3 sm:flex-row"
            role="radiogroup"
            aria-label="Delivery availability"
          >
            <label
              htmlFor="online-delivery-yes"
              className={cn(RADIO_CARD, deliveryAvailable && RADIO_CARD_ON)}
            >
              <input
                id="online-delivery-yes"
                type="radio"
                name="online-delivery-available"
                aria-label="Yes, this business offers delivery"
                checked={deliveryAvailable}
                onChange={() => onDeliveryAvailableChange(true)}
                className="mt-0.5 h-4 w-4 accent-brand-blue-600"
              />
              <span>
                <span className="block font-medium">Yes, this business offers delivery</span>
              </span>
            </label>
            <label
              htmlFor="online-delivery-no"
              className={cn(RADIO_CARD, !deliveryAvailable && RADIO_CARD_ON)}
            >
              <input
                id="online-delivery-no"
                type="radio"
                name="online-delivery-available"
                aria-label="No, delivery is not available"
                checked={!deliveryAvailable}
                onChange={() => onDeliveryAvailableChange(false)}
                className="mt-0.5 h-4 w-4 accent-brand-blue-600"
              />
              <span>
                <span className="block font-medium">No, delivery is not available</span>
              </span>
            </label>
          </div>
        </div>
      )}

      {businessType === "mall_store" && (
        <div className="grid grid-cols-1 gap-4">
          <div className="space-y-2">
            <Label htmlFor="storeNumber">Store Number *</Label>
            <Input
              id="storeNumber"
              value={storeNumber}
              onChange={(event) => onStoreNumberChange(event.target.value)}
              placeholder="e.g. Store 42, Ground Floor"
              maxLength={20}
              className={cn(fieldErrors.store_number && "border-destructive")}
            />
            {fieldErrors.store_number && (
              <p className="inline-form-error">{fieldErrors.store_number}</p>
            )}
          </div>
        </div>
      )}

      {businessType === "mobile_service" && (
        <div className="space-y-2">
          <Label htmlFor="serviceAreas">Service Areas *</Label>
          <Input
            id="serviceAreas"
            value={serviceAreasInput}
            onChange={(event) => onServiceAreasChange(event.target.value)}
            placeholder="e.g. Sandton, Randburg, Fourways, Midrand"
            className={cn(fieldErrors.service_areas && "border-destructive")}
          />
          <p className="text-xs text-muted-foreground">Separate areas with commas.</p>
          {fieldErrors.service_areas && (
            <p className="inline-form-error">{fieldErrors.service_areas}</p>
          )}
        </div>
      )}

      {["mall_store", "standalone_shop", "home_business", "market_stall"].includes(
        businessType
      ) && (
        <div className="space-y-2">
          <Label htmlFor="mapDirections">Map directions URL</Label>
          <Input
            id="mapDirections"
            value={mapDirections}
            onChange={(event) => onMapDirectionsChange(event.target.value)}
            placeholder="https://maps.google.com/..."
            className={cn(fieldErrors.map_directions && "border-destructive")}
          />
          <p className="text-xs text-muted-foreground">Optional. Paste a Google Maps link.</p>
          {fieldErrors.map_directions && (
            <p className="inline-form-error">{fieldErrors.map_directions}</p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {visibleFields.map((field) => {
          const path = `business_details.${field.name}`;
          const error = fieldErrors[path];
          const value = (businessDetails as unknown as Record<string, unknown>)[field.name];
          const isWide =
            field.kind === "textarea" || field.kind === "list" || field.kind === "day_select";

          if (field.kind === "day_select") {
            const selectedDays = Array.isArray(value) ? (value as string[]) : [];
            return (
              <fieldset key={field.name} className="space-y-2 sm:col-span-2">
                <legend className="text-sm font-medium">
                  {field.label}
                  {field.required ? " *" : ""}
                </legend>
                <div className="flex flex-wrap gap-2">
                  {DAYS_OF_WEEK.map((day) => {
                    const checked = selectedDays.includes(day.value);
                    return (
                      <label
                        key={day.value}
                        htmlFor={`business-detail-${field.name}-${day.value}`}
                        className={cn(
                          "flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-xl border px-3 text-sm font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2",
                          checked
                            ? "border-brand-blue-600 bg-brand-blue-50 text-brand-blue-800 dark:border-brand-blue-400 dark:bg-brand-blue-950/40 dark:text-brand-blue-200"
                            : "border-input bg-card hover:bg-muted/50"
                        )}
                      >
                        <input
                          id={`business-detail-${field.name}-${day.value}`}
                          type="checkbox"
                          className="sr-only"
                          checked={checked}
                          onChange={() => {
                            const next = checked
                              ? selectedDays.filter((d) => d !== day.value)
                              : [...selectedDays, day.value];
                            onBusinessDetailsChange(field.name, next);
                          }}
                        />
                        {day.label}
                      </label>
                    );
                  })}
                </div>
                {error && <p className="inline-form-error">{error}</p>}
              </fieldset>
            );
          }

          if (field.kind === "checkbox") {
            return (
              <label
                key={field.name}
                htmlFor={`business-detail-${field.name}`}
                className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-input bg-card px-3 py-2.5 text-sm"
              >
                <input
                  id={`business-detail-${field.name}`}
                  type="checkbox"
                  checked={Boolean(value)}
                  onChange={(event) => onBusinessDetailsChange(field.name, event.target.checked)}
                  className="h-4 w-4 rounded accent-brand-blue-600"
                />
                <span>{field.label}</span>
              </label>
            );
          }

          if (field.kind === "time_range") {
            const parsed = parseHoursValue(typeof value === "string" ? value : "");
            return (
              <div key={field.name} className="space-y-2 sm:col-span-2">
                <Label htmlFor={`business-detail-${field.name}`}>
                  {field.label}
                  {field.required ? " *" : ""}
                </Label>
                <OperatingHoursInput
                  id={`business-detail-${field.name}`}
                  label={field.label}
                  open={parsed.open}
                  close={parsed.close}
                  closed={parsed.closed}
                  onOpenChange={(v) => {
                    const next = { ...parsed, open: v };
                    onBusinessDetailsChange(
                      field.name,
                      formatHoursValue(next.open, next.close, next.closed)
                    );
                  }}
                  onCloseChange={(v) => {
                    const next = { ...parsed, close: v };
                    onBusinessDetailsChange(
                      field.name,
                      formatHoursValue(next.open, next.close, next.closed)
                    );
                  }}
                  onClosedChange={(v) => {
                    const next = { ...parsed, closed: v };
                    onBusinessDetailsChange(
                      field.name,
                      formatHoursValue(next.open, next.close, next.closed)
                    );
                  }}
                  hideClosed={field.required}
                  selectClassName={selectClassName}
                />
                {field.description && (
                  <p className="text-xs text-muted-foreground">{field.description}</p>
                )}
                {error && <p className="inline-form-error">{error}</p>}
              </div>
            );
          }

          if (field.kind === "select") {
            return (
              <div key={field.name} className="space-y-2">
                <Label htmlFor={`business-detail-${field.name}`}>
                  {field.label}
                  {field.required ? " *" : ""}
                </Label>
                <select
                  id={`business-detail-${field.name}`}
                  aria-label={field.label}
                  className={cn(selectClassName, error && "border-destructive")}
                  value={typeof value === "string" ? value : ""}
                  onChange={(event) =>
                    onBusinessDetailsChange(field.name, event.target.value || undefined)
                  }
                >
                  <option value="">Select an option</option>
                  {field.options?.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {field.description && (
                  <p className="text-xs text-muted-foreground">{field.description}</p>
                )}
                {error && <p className="inline-form-error">{error}</p>}
              </div>
            );
          }

          if (field.kind === "textarea") {
            return (
              <div key={field.name} className="space-y-2 sm:col-span-2">
                <Label htmlFor={`business-detail-${field.name}`}>
                  {field.label}
                  {field.required ? " *" : ""}
                </Label>
                <Textarea
                  id={`business-detail-${field.name}`}
                  value={renderFieldValue(value, field)}
                  onChange={(event) => onBusinessDetailsChange(field.name, event.target.value)}
                  placeholder={field.placeholder}
                  rows={3}
                  className={cn(error && "border-destructive")}
                />
                {field.description && (
                  <p className="text-xs text-muted-foreground">{field.description}</p>
                )}
                {error && <p className="inline-form-error">{error}</p>}
              </div>
            );
          }

          return (
            <div key={field.name} className={cn("space-y-2", isWide && "sm:col-span-2")}>
              <Label htmlFor={`business-detail-${field.name}`}>
                {field.label}
                {field.required ? " *" : ""}
              </Label>
              <Input
                id={`business-detail-${field.name}`}
                type={field.kind === "number" ? "number" : field.kind === "url" ? "url" : "text"}
                inputMode={field.kind === "number" ? "numeric" : undefined}
                min={field.kind === "number" ? field.min : undefined}
                step={field.kind === "number" ? field.step : undefined}
                value={renderFieldValue(value, field)}
                onChange={(event) => {
                  if (field.kind === "number") {
                    const nextValue = event.target.value;
                    onBusinessDetailsChange(
                      field.name,
                      nextValue === "" ? undefined : Number(nextValue)
                    );
                    return;
                  }
                  if (field.kind === "list") {
                    onBusinessDetailsChange(
                      field.name,
                      event.target.value
                        .split(",")
                        .map((item) => item.trim())
                        .filter(Boolean)
                    );
                    return;
                  }
                  onBusinessDetailsChange(field.name, event.target.value);
                }}
                placeholder={field.placeholder}
                className={cn(error && "border-destructive")}
              />
              {field.description && (
                <p className="text-xs text-muted-foreground">{field.description}</p>
              )}
              {error && <p className="inline-form-error">{error}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
