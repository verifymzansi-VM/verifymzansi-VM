"use client";

import { useState } from "react";
import { Send, Loader2, CheckCircle2, Shield, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { PageHeader } from "@/components/layout/page-header";
import { useToast } from "@/hooks/use-toast";
import { TurnstileWidget } from "@/components/ui/turnstile-widget";
import { saIdSchema } from "@/lib/validations/shared";

type RequestType = "access" | "correction" | "deletion" | "objection";
type DsarFailurePayload = {
  requestId?: string;
  reference?: string;
};

function formatDsarSubmissionFailure(payload: DsarFailurePayload | null): string {
  const identifiers = [
    payload?.reference ? `Reference: ${payload.reference}` : null,
    payload?.requestId ? `Case ID: ${payload.requestId}` : null,
  ].filter(Boolean);

  const suffix = identifiers.length > 0 ? ` ${identifiers.join(" | ")}` : "";
  return `Please try again or email privacy@verifymzansi.com.${suffix}`;
}

export default function DsarPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [requestType, setRequestType] = useState<RequestType>("access");
  const [details, setDetails] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [submittedReference, setSubmittedReference] = useState("");
  const [submittedRequestId, setSubmittedRequestId] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileUnavailable, setTurnstileUnavailable] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const { toast } = useToast();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errors: Record<string, string> = {};

    if (!name) errors.name = "Full name is required";
    else if (name.trim().length < 2) errors.name = "Name must be at least 2 characters";

    if (!email) errors.email = "Email address is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      errors.email = "Enter a valid email address";

    if (!idNumber) {
      errors.idNumber = "SA ID number is required";
    } else {
      const idResult = saIdSchema.safeParse(idNumber);
      if (!idResult.success) {
        errors.idNumber = idResult.error.issues[0].message;
      }
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/dsar/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: requestType,
          name,
          email,
          idNumber,
          details: details || undefined,
          turnstileToken: turnstileToken || undefined,
        }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as DsarFailurePayload | null;
        throw new Error(formatDsarSubmissionFailure(data));
      }

      const data = (await res.json()) as { reference?: string; requestId?: string };
      setSubmittedReference(data.reference || "");
      setSubmittedRequestId(data.requestId || "");
      setIsSubmitted(true);
    } catch (err) {
      toast({
        title: "Failed to submit request",
        description:
          err instanceof Error
            ? err.message
            : "Please try again or email privacy@verifymzansi.com.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  const REQUEST_TYPES: { value: RequestType; label: string; desc: string }[] = [
    {
      value: "access",
      label: "Access My Data",
      desc: "Get a copy of your data",
    },
    {
      value: "correction",
      label: "Correct My Data",
      desc: "Fix inaccurate information",
    },
    {
      value: "deletion",
      label: "Delete My Data",
      desc: "Delete data and account",
    },
    {
      value: "objection",
      label: "Object to Processing",
      desc: "Object to data processing",
    },
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1">
        <div className="container-page py-4 space-y-4">
          <PageHeader
            title="Data Access Request"
            description="Exercise your POPIA data rights."
            breadcrumbs={[{ label: "Data Access Request" }]}
          />

          <div className="mx-auto max-w-xl">
            {isSubmitted ? (
              <Card>
                <CardContent className="p-6 text-center space-y-3">
                  <CheckCircle2 className="h-10 w-10 text-brand-green mx-auto" />
                  <h2 className="font-display text-xl font-bold">Request Submitted</h2>
                  <p className="text-muted-foreground">
                    We&apos;ve received your request and will respond within 30 days as required by
                    POPIA. You&apos;ll receive a confirmation email at <strong>{email}</strong>.
                  </p>
                  {submittedReference ? (
                    <p className="text-xs text-muted-foreground">Reference: {submittedReference}</p>
                  ) : null}
                  {submittedRequestId ? (
                    <p className="text-xs text-muted-foreground">Case ID: {submittedRequestId}</p>
                  ) : null}
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2 h-11 gap-2"
                    onClick={() => (window.location.href = "/dashboard")}
                  >
                    <ArrowLeft className="h-4 w-4" /> Back to Dashboard
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Shield className="h-4 w-4 text-brand-green" />
                    Submit a Request
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleSubmit} className="space-y-3">
                    {/* Request Type */}
                    <div className="space-y-2">
                      <Label>Request Type</Label>
                      <div className="grid grid-cols-2 gap-1.5">
                        {REQUEST_TYPES.map((rt) => (
                          <button
                            key={rt.value}
                            type="button"
                            onClick={() => setRequestType(rt.value)}
                            className={`min-h-11 rounded-lg border p-2 text-left transition-colors ${
                              requestType === rt.value
                                ? "border-brand-green bg-brand-green-50 dark:bg-brand-green-950/30"
                                : "border-muted hover:border-foreground/20"
                            }`}
                          >
                            <p className="text-xs font-medium">{rt.label}</p>
                            <p className="text-[10px] text-muted-foreground">{rt.desc}</p>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Personal Info */}
                    <div className="space-y-2">
                      <Label htmlFor="name">Full Name *</Label>
                      <Input
                        id="name"
                        value={name}
                        onChange={(e) => {
                          setName(e.target.value);
                          if (fieldErrors.name) {
                            setFieldErrors((prev) => ({ ...prev, name: "" }));
                          }
                        }}
                        placeholder="Your full legal name"
                        required
                        autoComplete="name"
                        aria-invalid={!!fieldErrors.name}
                        aria-describedby={fieldErrors.name ? "name-error" : undefined}
                      />
                      {fieldErrors.name && (
                        <p
                          id="name-error"
                          role="alert"
                          className="inline-form-error"
                          data-error="name"
                        >
                          {fieldErrors.name}
                        </p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="email">Email Address *</Label>
                      <Input
                        id="email"
                        type="email"
                        value={email}
                        onChange={(e) => {
                          setEmail(e.target.value);
                          if (fieldErrors.email) {
                            setFieldErrors((prev) => ({ ...prev, email: "" }));
                          }
                        }}
                        placeholder="your@email.com"
                        required
                        autoComplete="email"
                        aria-invalid={!!fieldErrors.email}
                        aria-describedby={fieldErrors.email ? "email-error" : undefined}
                      />
                      {fieldErrors.email && (
                        <p
                          id="email-error"
                          role="alert"
                          className="inline-form-error"
                          data-error="email"
                        >
                          {fieldErrors.email}
                        </p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="idNumber">SA ID Number *</Label>
                      <Input
                        id="idNumber"
                        name="idNumber"
                        value={idNumber}
                        onChange={(e) => {
                          setIdNumber(e.target.value);
                          if (fieldErrors.idNumber) {
                            setFieldErrors((prev) => ({ ...prev, idNumber: "" }));
                          }
                        }}
                        placeholder="e.g. 8501015800083"
                        maxLength={13}
                        required
                        aria-invalid={!!fieldErrors.idNumber}
                        aria-describedby={fieldErrors.idNumber ? "idNumber-error" : undefined}
                      />
                      <p className="text-xs text-muted-foreground">
                        Required for identity verification. Handled securely under POPIA.
                      </p>
                      {fieldErrors.idNumber && (
                        <p
                          id="idNumber-error"
                          role="alert"
                          className="inline-form-error"
                          data-error="idNumber"
                        >
                          {fieldErrors.idNumber}
                        </p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="details">Additional Details</Label>
                      <textarea
                        id="details"
                        className="flex min-h-[50px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                        value={details}
                        onChange={(e) => setDetails(e.target.value)}
                        placeholder="Optional details..."
                        rows={2}
                      />
                    </div>

                    {/* Turnstile CAPTCHA */}
                    <TurnstileWidget
                      onSuccess={(token) => setTurnstileToken(token)}
                      onError={() => setTurnstileToken("")}
                      onExpire={() => setTurnstileToken("")}
                      onUnavailable={() => setTurnstileUnavailable(true)}
                    />

                    {turnstileUnavailable && (
                      <p className="text-xs text-destructive" role="alert">
                        Security check failed to load. Refresh the page to try again.
                      </p>
                    )}

                    <Button
                      type="submit"
                      className="h-11 w-full gap-2"
                      disabled={isSubmitting || !turnstileToken}
                    >
                      {isSubmitting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                      Submit Request
                    </Button>

                    <p className="text-xs text-muted-foreground text-center">
                      We will respond within 30 days as required by POPIA Section 23.
                    </p>
                  </form>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
