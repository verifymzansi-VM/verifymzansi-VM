"use client";

import type { ComponentType, SVGProps } from "react";
import { Globe, MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FacebookIcon, InstagramIcon, TikTokIcon, XIcon } from "@/components/icons/social-icons";
import { cn } from "@/lib/utils";

export type OnlinePresenceField =
  | "website"
  | "mapDirections"
  | "socialFacebook"
  | "socialInstagram"
  | "socialTwitter"
  | "socialTiktok";

export type OnlinePresenceValues = Record<OnlinePresenceField, string>;

type FieldConfig = {
  field: OnlinePresenceField;
  /** Key used in the form's fieldErrors map */
  errorKey: string;
  label: string;
  placeholder: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  iconClass: string;
};

const LINK_FIELDS: FieldConfig[] = [
  {
    field: "website",
    errorKey: "website",
    label: "Website",
    placeholder: "https://www.yourbusiness.co.za",
    icon: Globe,
    iconClass: "bg-muted text-foreground",
  },
  {
    field: "mapDirections",
    errorKey: "map_directions",
    label: "Location pin (Google Maps link)",
    placeholder: "https://maps.app.goo.gl/…",
    icon: MapPin,
    iconClass:
      "bg-brand-red-50 text-brand-red-600 dark:bg-brand-red-950/40 dark:text-brand-red-300",
  },
  {
    field: "socialFacebook",
    errorKey: "socialFacebook",
    label: "Facebook",
    placeholder: "https://facebook.com/yourpage",
    icon: FacebookIcon,
    iconClass: "bg-[#1877F2] text-white",
  },
  {
    field: "socialInstagram",
    errorKey: "socialInstagram",
    label: "Instagram",
    placeholder: "https://instagram.com/yourname",
    icon: InstagramIcon,
    iconClass: "bg-gradient-to-br from-[#F58529] via-[#DD2A7B] to-[#8134AF] text-white",
  },
  {
    field: "socialTwitter",
    errorKey: "socialTwitter",
    label: "X (Twitter)",
    placeholder: "https://x.com/yourname",
    icon: XIcon,
    iconClass: "bg-black text-white dark:bg-white dark:text-black",
  },
  {
    field: "socialTiktok",
    errorKey: "socialTiktok",
    label: "TikTok",
    placeholder: "https://tiktok.com/@yourname",
    icon: TikTokIcon,
    iconClass: "bg-black text-white dark:bg-white dark:text-black",
  },
];

/**
 * Always-visible website, map pin and social media inputs, shared by every
 * posting form so customers can find the poster online and on the map.
 */
export function OnlinePresenceFields({
  values,
  onChange,
  errors = {},
  showMapPin = true,
  mapPinUnavailableReason,
  mapPinHint = "Open Google Maps, drop a pin on your spot, tap Share and paste the link here.",
  title = "Website, social media & location pin",
  description = "Optional, but customers trust profiles they can check online and find on a map.",
}: {
  values: OnlinePresenceValues;
  onChange: (field: OnlinePresenceField, value: string) => void;
  errors?: Record<string, string | undefined>;
  showMapPin?: boolean;
  /** Shown in place of the map pin input when the pin cannot be published */
  mapPinUnavailableReason?: string;
  mapPinHint?: string;
  title?: string;
  description?: string;
}) {
  const mapPinUsable = showMapPin && !mapPinUnavailableReason;
  const fields = LINK_FIELDS.filter((config) => mapPinUsable || config.field !== "mapDirections");

  return (
    <section
      aria-labelledby="online-presence-title"
      className="space-y-4 rounded-2xl border border-border bg-card p-4 sm:p-5"
    >
      <div className="space-y-1">
        <h3 id="online-presence-title" className="text-base font-semibold text-foreground">
          {title}
        </h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {fields.map(({ field, errorKey, label, placeholder, icon: Icon, iconClass }) => {
          const error = errors[errorKey] ?? errors[field];
          const hintId = field === "mapDirections" ? `${field}-hint` : undefined;
          return (
            <div
              key={field}
              className={cn("space-y-1.5", field === "mapDirections" && "sm:col-span-2")}
            >
              <Label htmlFor={field} className="flex items-center gap-2">
                <span
                  className={cn(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                    iconClass
                  )}
                  aria-hidden="true"
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>
                {label}{" "}
                <span className="text-xs font-normal text-muted-foreground">(Optional)</span>
              </Label>
              <Input
                id={field}
                type="text"
                inputMode="url"
                autoComplete="url"
                value={values[field]}
                onChange={(event) => onChange(field, event.target.value)}
                placeholder={placeholder}
                aria-invalid={Boolean(error) || undefined}
                aria-describedby={
                  [hintId, error ? `${field}-error` : null].filter(Boolean).join(" ") || undefined
                }
                className={cn(error && "border-destructive")}
              />
              {hintId && (
                <p id={hintId} className="text-xs text-muted-foreground">
                  {mapPinHint}
                </p>
              )}
              {error && (
                <p id={`${field}-error`} className="inline-form-error">
                  {error}
                </p>
              )}
            </div>
          );
        })}
      </div>
      {showMapPin && mapPinUnavailableReason && (
        <p className="flex items-start gap-2 rounded-xl bg-muted/60 px-3 py-2.5 text-sm text-muted-foreground">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {mapPinUnavailableReason}
        </p>
      )}
    </section>
  );
}
