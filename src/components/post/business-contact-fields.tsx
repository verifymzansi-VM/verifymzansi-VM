"use client";

import { ContactSwitches, type ContactSwitchOption } from "./contact-switches";

/** Call and WhatsApp use the account's verified number; the inbox needs no number. */
const BUSINESS_CONTACT_SWITCHES: readonly ContactSwitchOption[] = [
  { id: "call", label: "Call", usesVerifiedNumber: true },
  { id: "whatsapp", label: "WhatsApp", usesVerifiedNumber: true },
  { id: "form", label: "VerifyMzansi inbox", hint: "Enquiries arrive in your account" },
];

const NUMBER_FIELDS = { call: "phone", whatsapp: "whatsapp" } as const;

export type ContactValues = { phone: string; whatsapp: string; website: string };

/**
 * The chosen contact methods. Call and WhatsApp count only with a number to
 * publish (the verified number), and the website counts whenever it is filled
 * in, from the links section. Without a stored choice, Call and WhatsApp
 * start on when there is a number.
 */
export function readContactMethods(value: unknown, values: ContactValues): string[] {
  const chosen = Array.isArray(value)
    ? value.filter(
        (method): method is string =>
          typeof method === "string" &&
          BUSINESS_CONTACT_SWITCHES.some((option) => option.id === method)
      )
    : ["call", "whatsapp"];
  const available = chosen.filter((method) =>
    method in NUMBER_FIELDS
      ? Boolean(values[NUMBER_FIELDS[method as keyof typeof NUMBER_FIELDS]].trim())
      : true
  );
  return values.website.trim() ? [...available, "website"] : available;
}

export function selectedContacts(methods: string[], values: ContactValues) {
  return {
    phone: methods.includes("call") ? values.phone : "",
    whatsapp: methods.includes("whatsapp") ? values.whatsapp : "",
    website: methods.includes("website") ? values.website : "",
  };
}

/** The business contact block: on/off switches, with the verified number shown masked. */
export function BusinessContactFields({
  methods,
  verifiedPhone,
  onMethods,
  errors,
}: {
  methods: string[];
  verifiedPhone: string | null | undefined;
  onMethods: (value: string[]) => void;
  errors: Record<string, string>;
}) {
  return (
    <ContactSwitches
      id="business-contact-methods"
      options={BUSINESS_CONTACT_SWITCHES}
      selected={methods.filter((method) => method !== "website")}
      onChange={onMethods}
      verifiedPhone={verifiedPhone}
      error={errors.contact_methods || errors.phone || errors.whatsapp}
    />
  );
}
