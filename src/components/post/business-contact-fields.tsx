"use client";

import { FieldHelp } from "./field-help";
import { Input } from "@/components/ui/input";
import { PostLabel } from "./post-label";

const BUSINESS_CONTACT_CHOICES = [
  {
    method: "call",
    field: "phone",
    label: "Phone calls",
    inputLabel: "Phone number",
    example: "082 123 4567",
    hint: "Publish a number customers can call.",
  },
  {
    method: "whatsapp",
    field: "whatsapp",
    label: "WhatsApp",
    inputLabel: "WhatsApp Number",
    example: "082 123 4567",
    hint: "Publish a number registered on WhatsApp.",
  },
  {
    method: "email",
    field: "email",
    label: "Email",
    inputLabel: "Email Address",
    example: "hello@example.co.za",
    hint: "Publish an email address for enquiries.",
  },
  {
    method: "website",
    field: "website",
    label: "Website",
    inputLabel: "Website",
    example: "https://example.co.za",
    hint: "Link to your website. It does not need an online checkout.",
  },
  {
    method: "form",
    field: null,
    label: "VerifyMzansi inbox",
    inputLabel: "",
    example: "",
    hint: "Receive enquiries in your account without publishing a number.",
  },
] as const;

/** Website has its own always-visible field; the rest are opt-in checkboxes. */
const CHECKBOX_CHOICES = BUSINESS_CONTACT_CHOICES.filter((choice) => choice.method !== "website");

export type ContactValues = { phone: string; whatsapp: string; email: string; website: string };
/**
 * The website is entered in the always-visible "Website, social media &
 * location pin" section, so it counts as a contact method whenever it is
 * filled in instead of needing its own checkbox.
 */
export function readContactMethods(value: unknown, values: ContactValues): string[] {
  const chosen = Array.isArray(value)
    ? value.filter(
        (method): method is string =>
          typeof method === "string" &&
          method !== "website" &&
          BUSINESS_CONTACT_CHOICES.some((choice) => choice.method === method)
      )
    : BUSINESS_CONTACT_CHOICES.filter(
        (choice) => choice.field && choice.field !== "website" && values[choice.field]
      ).map((choice) => choice.method);
  return values.website.trim() ? [...chosen, "website"] : chosen;
}
export function selectedContacts(methods: string[], values: ContactValues) {
  return {
    phone: methods.includes("call") ? values.phone : "",
    whatsapp: methods.includes("whatsapp") ? values.whatsapp : "",
    email: methods.includes("email") ? values.email : "",
    website: methods.includes("website") ? values.website : "",
  };
}

export function BusinessContactFields({
  methods,
  values,
  onMethods,
  onValue,
  errors,
}: {
  methods: string[];
  values: ContactValues;
  onMethods: (value: string[]) => void;
  onValue: (field: keyof ContactValues, value: string) => void;
  errors: Record<string, string>;
}) {
  return (
    <fieldset id="business-contact-methods" tabIndex={-1} className="space-y-3">
      <legend className="font-medium">How should customers contact you? (Required)</legend>
      <p className="text-sm text-muted-foreground">
        Choose at least one. Choose all that apply. Details for selected methods will be public.
        Your website goes in the website and social media section below.
      </p>
      <FieldHelp label="contact methods">
        Use a number or email address you check regularly. The VerifyMzansi inbox sends enquiries to
        your account. If you deselect a method, its details will not appear on your profile.
      </FieldHelp>
      <div className="grid gap-2 sm:grid-cols-2">
        {CHECKBOX_CHOICES.map((choice) => (
          <label
            key={choice.method}
            className="flex min-h-11 items-start gap-2 rounded-xl border p-3"
          >
            <input
              aria-label={choice.label}
              type="checkbox"
              checked={methods.includes(choice.method)}
              onChange={(event) =>
                onMethods(
                  event.target.checked
                    ? [...methods, choice.method]
                    : methods.filter((method) => method !== choice.method)
                )
              }
            />
            <span>
              <span className="block font-medium">{choice.label}</span>
              <span className="text-sm text-muted-foreground">{choice.hint}</span>
            </span>
          </label>
        ))}
      </div>
      {errors.contact_methods && <p className="inline-form-error">{errors.contact_methods}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        {CHECKBOX_CHOICES.map(
          (choice) =>
            choice.field &&
            methods.includes(choice.method) && (
              <div key={choice.method}>
                <PostLabel htmlFor={choice.field} required>
                  {choice.inputLabel}
                </PostLabel>
                <Input
                  id={choice.field}
                  value={values[choice.field]}
                  onChange={(event) => onValue(choice.field!, event.target.value)}
                  placeholder={choice.example}
                  aria-invalid={Boolean(errors[choice.field])}
                />
                {errors[choice.field] && (
                  <p className="inline-form-error">{errors[choice.field]}</p>
                )}
              </div>
            )
        )}
      </div>
    </fieldset>
  );
}
