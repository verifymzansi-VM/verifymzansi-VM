import {
  BUSINESS_DETAILS_SECTIONS,
  coerceBusinessDetails,
  type BusinessDetailsFieldConfig,
} from "./business-type-details";
import type { BusinessDetails } from "@/types/business-details";
import type { BusinessType } from "@/types/enums";

const SA_PHONE_REGEX = /^(\+27|0)[6-8][0-9]{8}$/;

export interface BusinessFormValues {
  businessType: BusinessType | "";
  businessDetails: BusinessDetails | null;
  storeNumber: string;
  serviceAreasInput: string;
  mapDirections: string;
  phone: string;
  whatsapp: string;
  email: string;
  website: string;
  socialFacebook: string;
  socialInstagram: string;
  socialTwitter: string;
  socialTiktok: string;
}

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export function parseServiceAreas(serviceAreasInput: string): string[] {
  return serviceAreasInput
    .split(",")
    .map((area) => area.trim())
    .filter(Boolean);
}

function validateDetailsField(
  field: BusinessDetailsFieldConfig,
  value: unknown,
  errors: Record<string, string>
) {
  const path = `business_details.${field.name}`;

  if (field.required) {
    if (field.kind === "list" && (!Array.isArray(value) || value.length === 0)) {
      errors[path] = `${field.label} is required.`;
      return;
    }
    if (field.kind === "select" && typeof value !== "string") {
      errors[path] = `${field.label} is required.`;
      return;
    }
    if (field.kind !== "checkbox" && field.kind !== "list" && `${value ?? ""}`.trim() === "") {
      errors[path] = `${field.label} is required.`;
      return;
    }
  }

  if (
    field.kind === "url" &&
    typeof value === "string" &&
    value.trim() &&
    !isValidUrl(value.trim())
  ) {
    errors[path] = `Enter a valid ${field.label.toLowerCase()}.`;
  }

  if (
    field.kind === "number" &&
    value !== undefined &&
    value !== null &&
    (typeof value !== "number" ||
      Number.isNaN(value) ||
      (field.min !== undefined && value < field.min))
  ) {
    errors[path] = `${field.label} must be ${field.min ?? 0} or more.`;
  }
}

export function validateBusinessForm(values: BusinessFormValues): Record<string, string> {
  const errors: Record<string, string> = {};

  if (values.businessType === "mall_store" && !values.storeNumber.trim()) {
    errors.store_number = "Store number is required for mall stores.";
  }

  if (
    values.businessType === "mobile_service" &&
    parseServiceAreas(values.serviceAreasInput).length === 0
  ) {
    errors.service_areas = "Add at least one service area.";
  }

  if (
    values.businessType &&
    ["mall_store", "standalone_shop", "home_business", "market_stall"].includes(
      values.businessType
    ) &&
    values.mapDirections.trim() &&
    !isValidUrl(values.mapDirections.trim())
  ) {
    errors.map_directions = "Enter a valid map directions URL.";
  }

  if (values.businessType) {
    const details = coerceBusinessDetails(values.businessType, values.businessDetails);
    for (const field of BUSINESS_DETAILS_SECTIONS[values.businessType].fields) {
      validateDetailsField(
        field,
        (details as unknown as Record<string, unknown>)[field.name],
        errors
      );
    }
  }

  if (values.phone && !SA_PHONE_REGEX.test(values.phone.trim())) {
    errors.phone = "Enter a valid South African number.";
  }

  if (values.whatsapp && !SA_PHONE_REGEX.test(values.whatsapp.trim())) {
    errors.whatsapp = "Enter a valid South African WhatsApp number.";
  }

  if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) {
    errors.email = "Enter a valid email address.";
  }

  if (values.website && !isValidUrl(values.website.trim())) {
    errors.website = "Enter a valid website URL.";
  }

  const socialFields: Array<[keyof BusinessFormValues, string]> = [
    ["socialFacebook", "Enter a valid Facebook URL."],
    ["socialInstagram", "Enter a valid Instagram URL."],
    ["socialTwitter", "Enter a valid X / Twitter URL."],
    ["socialTiktok", "Enter a valid TikTok URL."],
  ];

  for (const [field, message] of socialFields) {
    const rawValue = values[field];
    if (typeof rawValue === "string" && rawValue.trim() && !isValidUrl(rawValue.trim())) {
      errors[field] = message;
    }
  }

  return errors;
}
