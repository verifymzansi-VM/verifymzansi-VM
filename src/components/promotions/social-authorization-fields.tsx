import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  SOCIAL_AUTHORIZATION_COPY,
  SOCIAL_AUTHORIZATION_VERSION,
  type PromotionSocialAuthorizationInput,
} from "@/lib/promotions/social-authorization";
import {
  SOCIAL_AUTHORIZER_RELATIONSHIP_LABELS,
  type SocialAuthorizerRelationship,
} from "@/types/enums";
import { cn } from "@/lib/utils";

const SELECT_CLASS =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

interface SocialAuthorizationFieldsProps {
  value: PromotionSocialAuthorizationInput;
  onChange: (value: PromotionSocialAuthorizationInput) => void;
  errors?: Record<string, string>;
  className?: string;
  headingClassName?: string;
}

function updateValue(
  value: PromotionSocialAuthorizationInput,
  patch: Partial<PromotionSocialAuthorizationInput>
): PromotionSocialAuthorizationInput {
  return { ...value, ...patch };
}

export function SocialAuthorizationFields({
  value,
  onChange,
  errors = {},
  className,
  headingClassName,
}: SocialAuthorizationFieldsProps) {
  return (
    <section className={cn("space-y-4 rounded-xl border bg-card/60 p-4", className)}>
      <div className="space-y-2">
        <h3 className={cn("font-display text-base font-semibold", headingClassName)}>
          {SOCIAL_AUTHORIZATION_COPY.sectionTitle}
        </h3>
        <p className="text-sm text-muted-foreground">{SOCIAL_AUTHORIZATION_COPY.summary}</p>
      </div>

      <div className="space-y-3">
        <div className="flex items-start gap-3 text-sm">
          <input
            id="social-auth-not-authorized"
            type="radio"
            name="social-authorization"
            checked={!value.granted}
            onChange={() => onChange({ granted: false })}
            className="mt-1"
            aria-describedby="social-auth-not-authorized-description"
          />
          <span>
            <span className="font-medium text-foreground">
              {SOCIAL_AUTHORIZATION_COPY.pendingLabel}
            </span>
            <span
              id="social-auth-not-authorized-description"
              className="mt-1 block text-muted-foreground"
            >
              Keep the promotion eligible for VerifyMzansi only. It will not be eligible for
              VerifyMzansi-managed external social posting.
            </span>
          </span>
        </div>

        <div className="flex items-start gap-3 text-sm">
          <input
            id="social-auth-authorized"
            type="radio"
            name="social-authorization"
            checked={value.granted}
            onChange={() =>
              onChange({
                granted: true,
                relationship: value.relationship ?? "owner",
                monetizationAcknowledged: value.monetizationAcknowledged ?? false,
                acceptedVersion: value.acceptedVersion ?? "",
                authorizerName: value.authorizerName ?? "",
                authorizerRole: value.authorizerRole ?? "",
              })
            }
            className="mt-1"
            aria-describedby="social-auth-authorized-description"
          />
          <span>
            <span className="font-medium text-foreground">
              {SOCIAL_AUTHORIZATION_COPY.grantLabel}
            </span>
            <span
              id="social-auth-authorized-description"
              className="mt-1 block text-muted-foreground"
            >
              Capture explicit approval for VerifyMzansi to distribute the promotion on
              VerifyMzansi-owned social channels.
            </span>
          </span>
        </div>
      </div>

      {value.granted ? (
        <div className="space-y-4 rounded-lg border border-border/70 bg-background/80 p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="social-authorizer-name">Authorizer full name *</Label>
              <Input
                id="social-authorizer-name"
                value={value.authorizerName ?? ""}
                onChange={(event) =>
                  onChange(updateValue(value, { authorizerName: event.target.value }))
                }
                className={cn(errors["socialAuthorization.authorizerName"] && "border-destructive")}
              />
              {errors["socialAuthorization.authorizerName"] ? (
                <p className="inline-form-error">{errors["socialAuthorization.authorizerName"]}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="social-authorizer-role">Authorizer role / title *</Label>
              <Input
                id="social-authorizer-role"
                value={value.authorizerRole ?? ""}
                onChange={(event) =>
                  onChange(updateValue(value, { authorizerRole: event.target.value }))
                }
                className={cn(errors["socialAuthorization.authorizerRole"] && "border-destructive")}
              />
              {errors["socialAuthorization.authorizerRole"] ? (
                <p className="inline-form-error">{errors["socialAuthorization.authorizerRole"]}</p>
              ) : null}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="social-authorizer-relationship">Relationship *</Label>
            <select
              id="social-authorizer-relationship"
              className={cn(
                SELECT_CLASS,
                errors["socialAuthorization.relationship"] && "border-destructive"
              )}
              value={value.relationship ?? "owner"}
              onChange={(event) =>
                onChange(
                  updateValue(value, {
                    relationship: event.target.value as SocialAuthorizerRelationship,
                  })
                )
              }
            >
              {Object.entries(SOCIAL_AUTHORIZER_RELATIONSHIP_LABELS).map(([option, label]) => (
                <option key={option} value={option}>
                  {label}
                </option>
              ))}
            </select>
            {errors["socialAuthorization.relationship"] ? (
              <p className="inline-form-error">{errors["socialAuthorization.relationship"]}</p>
            ) : null}
          </div>

          <div className="space-y-3 rounded-lg border border-brand-green/15 bg-brand-green/5 p-4 text-sm">
            <p className="font-medium text-foreground">
              {SOCIAL_AUTHORIZATION_COPY.licenseAcknowledgement}
            </p>
            <p className="text-muted-foreground">
              Version:{" "}
              <span className="font-medium text-foreground">{SOCIAL_AUTHORIZATION_VERSION}</span>
            </p>
          </div>

          <div className="space-y-3">
            <label className="flex items-start gap-3 text-sm">
              <input
                id="social-monetization-acknowledged"
                type="checkbox"
                checked={value.monetizationAcknowledged === true}
                onChange={(event) =>
                  onChange(
                    updateValue(value, {
                      monetizationAcknowledged: event.target.checked,
                    })
                  )
                }
                className="mt-1 rounded"
              />
              <span>{SOCIAL_AUTHORIZATION_COPY.monetizationAcknowledgement}</span>
            </label>
            {errors["socialAuthorization.monetizationAcknowledged"] ? (
              <p className="inline-form-error">
                {errors["socialAuthorization.monetizationAcknowledged"]}
              </p>
            ) : null}

            <label className="flex items-start gap-3 text-sm">
              <input
                id="social-authorization-version"
                type="checkbox"
                checked={value.acceptedVersion === SOCIAL_AUTHORIZATION_VERSION}
                onChange={(event) =>
                  onChange(
                    updateValue(value, {
                      acceptedVersion: event.target.checked ? SOCIAL_AUTHORIZATION_VERSION : "",
                    })
                  )
                }
                className="mt-1 rounded"
              />
              <span>{SOCIAL_AUTHORIZATION_COPY.versionAcceptance}</span>
            </label>
            {errors["socialAuthorization.acceptedVersion"] ? (
              <p className="inline-form-error">{errors["socialAuthorization.acceptedVersion"]}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
