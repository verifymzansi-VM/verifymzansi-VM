import {
  SOCIAL_AUTHORIZATION_VERSION,
  type PromotionSocialAuthorizationInput,
} from "@/lib/promotions/social-authorization";
import { SOCIAL_AUTHORIZER_RELATIONSHIP_LABELS } from "@/types/enums";

export interface PromotionFormValues {
  priceZar: string;
  startDate: string;
  endDate: string;
  contactMethods: string[];
  socialAuthorization?: PromotionSocialAuthorizationInput;
}

function hasValidMoneyPrecision(value: number): boolean {
  return Math.abs(value * 100 - Math.round(value * 100)) < 0.001;
}

export function validatePromotionForm(values: PromotionFormValues): Record<string, string> {
  const errors: Record<string, string> = {};

  if (values.contactMethods.length === 0) {
    errors.contact_methods = "Choose at least one contact method.";
  }

  if (values.priceZar.trim()) {
    const numericPrice = Number(values.priceZar);
    if (!Number.isFinite(numericPrice) || numericPrice < 0) {
      errors.price_zar = "Enter a valid price.";
    } else if (!hasValidMoneyPrecision(numericPrice)) {
      errors.price_zar = "Price can have at most 2 decimal places.";
    }
  }

  if (values.startDate && Number.isNaN(new Date(values.startDate).getTime())) {
    errors.start_date = "Enter a valid start date.";
  }

  if (values.endDate && Number.isNaN(new Date(values.endDate).getTime())) {
    errors.end_date = "Enter a valid end date.";
  }

  if (values.startDate && values.endDate) {
    const start = new Date(values.startDate);
    const end = new Date(values.endDate);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end < start) {
      errors.end_date = "End date must be on or after the start date.";
    }
  }

  if (values.socialAuthorization?.granted) {
    if (!values.socialAuthorization.authorizerName?.trim()) {
      errors["socialAuthorization.authorizerName"] = "Enter the authorizer's full name.";
    }

    if (!values.socialAuthorization.authorizerRole?.trim()) {
      errors["socialAuthorization.authorizerRole"] = "Enter the authorizer's role or title.";
    }

    if (
      !values.socialAuthorization.relationship ||
      !(values.socialAuthorization.relationship in SOCIAL_AUTHORIZER_RELATIONSHIP_LABELS)
    ) {
      errors["socialAuthorization.relationship"] = "Select the authorizer relationship.";
    }

    if (!values.socialAuthorization.monetizationAcknowledged) {
      errors["socialAuthorization.monetizationAcknowledged"] =
        "You must acknowledge the monetization policy.";
    }

    if (values.socialAuthorization.acceptedVersion !== SOCIAL_AUTHORIZATION_VERSION) {
      errors["socialAuthorization.acceptedVersion"] =
        "You must accept the current authorization terms.";
    }
  }

  return errors;
}
