"use client";
import { CUSTOMER_ACCESS_OPTIONS, type CustomerAccess } from "@/lib/forms/customer-access";
import { FieldHelp } from "./field-help";

export function CustomerAccessFields({
  value,
  onChange,
}: {
  value: CustomerAccess;
  onChange: (value: CustomerAccess) => void;
}) {
  const update = (patch: Partial<CustomerAccess>) => onChange({ ...value, ...patch });
  return (
    <fieldset id="business-type-group" tabIndex={-1} className="space-y-3">
      <legend className="font-semibold">How do you serve customers? (Required)</legend>
      <p className="text-sm text-muted-foreground">
        Choose all that apply. You can have a shop and also travel, deliver or work online.
      </p>
      <FieldHelp label="customer access">
        This describes how people use your business. It does not change your business category.
        Select at least one option.
      </FieldHelp>
      {CUSTOMER_ACCESS_OPTIONS.map((option) => (
        <label
          aria-label={option.label}
          key={option.value}
          className="flex min-h-11 items-start gap-3 rounded-xl border p-3"
        >
          <input
            aria-label={option.label}
            type="checkbox"
            className="mt-1"
            checked={value.methods.includes(option.value)}
            onChange={(e) =>
              update({
                methods: e.target.checked
                  ? [...value.methods, option.value]
                  : value.methods.filter((m) => m !== option.value),
              })
            }
          />
          <span>
            <span className="block font-medium">{option.label}</span>
            <span className="block text-sm text-muted-foreground">{option.hint}</span>
          </span>
        </label>
      ))}
      {value.methods.includes("visit") && (
        <div className="space-y-3">
          <label className="block text-sm">
            Where do customers visit you? (Required)
            <select
              className="mt-2 h-11 w-full rounded-md border bg-background px-3"
              value={value.premises ?? ""}
              onChange={(e) =>
                update({
                  premises: e.target.value as CustomerAccess["premises"],
                  publishAddress: false,
                })
              }
            >
              <option value="">Choose a place</option>
              <option value="standalone_shop">Shop, office, practice or workshop</option>
              <option value="mall_store">Shopping centre</option>
              <option value="home_business">Home</option>
              <option value="market_stall">Market stall</option>
            </select>
          </label>
          {["mall_store", "market_stall"].includes(value.premises ?? "") && (
            <label className="block text-sm">
              Shopping centre or market name (Required)
              <input
                className="mt-2 h-11 w-full rounded-md border bg-background px-3"
                value={value.venue ?? ""}
                onChange={(e) => update({ venue: e.target.value })}
              />
            </label>
          )}
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              checked={value.publishAddress}
              onChange={(e) => update({ publishAddress: e.target.checked })}
            />
            Show my exact visitor address publicly
          </label>
          <p className="text-sm text-muted-foreground">
            If you leave this off, only your area is published. Your street address and map
            directions will not be saved to the public profile.
          </p>
        </div>
      )}
      {value.methods.includes("travel") && (
        <label className="block text-sm">
          Service areas (Required)
          <span className="block text-muted-foreground">
            Places you travel to, separated by commas. For example: Soweto, Sandton. This is not
            your home address.
          </span>
          <input
            className="mt-2 h-11 w-full rounded-md border bg-background px-3"
            value={value.serviceAreas ?? ""}
            onChange={(e) => update({ serviceAreas: e.target.value })}
          />
        </label>
      )}
      {value.methods.includes("delivery") && (
        <div className="space-y-2">
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              checked={value.nationwide ?? false}
              onChange={(e) => update({ nationwide: e.target.checked })}
            />
            I deliver nationwide
          </label>
          {!value.nationwide && (
            <label className="block text-sm">
              Delivery areas (Required)
              <input
                className="mt-2 h-11 w-full rounded-md border bg-background px-3"
                value={value.deliveryAreas ?? ""}
                onChange={(e) => update({ deliveryAreas: e.target.value })}
              />
              <span className="text-muted-foreground">
                Separate places with commas, for example: Durban, Umhlanga.
              </span>
            </label>
          )}
        </div>
      )}
    </fieldset>
  );
}
