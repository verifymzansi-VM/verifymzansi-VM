"use client";

import { BrandShield as Shield } from "@/components/shared/brand-shield";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  Hand,
  Loader2,
  PencilLine,
  Send,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { PageHeader } from "@/components/layout/page-header";
import { useToast } from "@/hooks/use-toast";
import { TurnstileWidget } from "@/components/ui/turnstile-widget";
import { PRIVACY_CONTACT_EMAIL } from "@/lib/contact-email";
import { saIdSchema } from "@/lib/validations/shared";
import { ensureCsrfTokenReady, withCsrfHeaders } from "@/lib/utils/csrf";

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
  return `Please try again or email ${PRIVACY_CONTACT_EMAIL}.${suffix}`;
}

const NEXT_STEPS = [
  { title: "We confirm it's you", body: "So nobody else can get your data." },
  { title: "We respond within 30 days", body: "As POPIA Section 23 requires." },
  { title: "You can escalate", body: "To the Information Regulator South Africa." },
] as const;

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
  const [captchaAttempt, setCaptchaAttempt] = useState(0);
  const [turnstileUnavailable, setTurnstileUnavailable] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const { toast } = useToast();
  const router = useRouter();

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
      if (!(await ensureCsrfTokenReady())) {
        throw new Error("Security check failed. Please refresh the page and try again.");
      }
      const res = await fetch("/api/dsar/submit", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
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
      setTurnstileToken("");
      setCaptchaAttempt((attempt) => attempt + 1);
      toast({
        title: "Failed to submit request",
        description:
          err instanceof Error
            ? err.message
            : `Please try again or email ${PRIVACY_CONTACT_EMAIL}.`,
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  const REQUEST_TYPES: {
    value: RequestType;
    label: string;
    desc: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    { value: "access", label: "Access My Data", desc: "Get a copy of your data", icon: Download },
    {
      value: "correction",
      label: "Correct My Data",
      desc: "Fix inaccurate information",
      icon: PencilLine,
    },
    { value: "deletion", label: "Delete My Data", desc: "Delete data and account", icon: Trash2 },
    {
      value: "objection",
      label: "Object to Processing",
      desc: "Object to data processing",
      icon: Hand,
    },
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main id="main-content" className="flex-1">
        <div className="container-page space-y-8 py-6 sm:py-10">
          <PageHeader
            title="Data access request"
            description="See, correct or delete the data we hold about you."
            breadcrumbs={[
              { label: "Privacy Policy", href: "/privacy" },
              { label: "Data access request" },
            ]}
          />

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] lg:gap-10">
            {isSubmitted ? (
              <section
                aria-labelledby="dsar-success-title"
                className="hero-panel p-6 text-center sm:p-10"
              >
                <div className="empty-state-icon">
                  <CheckCircle2 className="h-7 w-7" aria-hidden="true" />
                </div>
                <h2
                  id="dsar-success-title"
                  className="mt-4 font-display text-2xl font-bold tracking-tight"
                >
                  Request submitted
                </h2>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
                  We&apos;ve received your request and will respond within 30 days as required by
                  POPIA. You&apos;ll receive a confirmation email at{" "}
                  <strong className="text-foreground">{email}</strong>.
                </p>
                {(submittedReference || submittedRequestId) && (
                  <div className="mx-auto mt-5 w-fit max-w-full space-y-1 rounded-xl bg-muted px-4 py-3 text-left font-mono text-sm text-foreground">
                    {submittedReference ? (
                      <p className="break-all">Reference: {submittedReference}</p>
                    ) : null}
                    {submittedRequestId ? (
                      <p className="break-all">Case ID: {submittedRequestId}</p>
                    ) : null}
                  </div>
                )}
                <Button
                  variant="outline"
                  className="mt-6 h-11 gap-2"
                  onClick={() => router.push("/dashboard")}
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to dashboard
                </Button>
              </section>
            ) : (
              <section aria-labelledby="dsar-form-title" className="hero-panel p-5 sm:p-8">
                <div className="flex items-center gap-3">
                  <span className="icon-tile area-market-tile">
                    <Shield className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <h2
                    id="dsar-form-title"
                    className="font-display text-xl font-bold tracking-tight sm:text-2xl"
                  >
                    Submit a request
                  </h2>
                </div>
                <form onSubmit={handleSubmit} className="mt-6 space-y-5">
                  <div className="space-y-2">
                    <p id="request-type-label" className="text-sm font-medium leading-none">
                      Request type
                    </p>
                    <div
                      role="group"
                      aria-labelledby="request-type-label"
                      className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2"
                    >
                      {REQUEST_TYPES.map((rt) => {
                        const selected = requestType === rt.value;
                        const Icon = rt.icon;
                        return (
                          <button
                            key={rt.value}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => setRequestType(rt.value)}
                            className={`flex min-h-14 items-start gap-3 rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                              selected
                                ? "border-brand-green-600 bg-brand-green-50 ring-1 ring-brand-green-600 dark:border-brand-green-400 dark:bg-brand-green-950/40 dark:ring-brand-green-400"
                                : "border-border hover:border-foreground/25 hover:bg-muted/50"
                            }`}
                          >
                            <Icon
                              className={`mt-0.5 h-4 w-4 shrink-0 ${
                                selected
                                  ? "text-brand-green-700 dark:text-brand-green-300"
                                  : "text-muted-foreground"
                              }`}
                              aria-hidden="true"
                            />
                            <span>
                              <span className="block text-sm font-semibold text-foreground">
                                {rt.label}
                              </span>
                              <span className="block text-xs text-muted-foreground">{rt.desc}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
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
                      className="h-11"
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
                      className="h-11"
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
                      inputMode="numeric"
                      className="h-11 font-mono"
                      maxLength={13}
                      required
                      aria-invalid={!!fieldErrors.idNumber}
                      aria-describedby={
                        fieldErrors.idNumber ? "idNumber-hint idNumber-error" : "idNumber-hint"
                      }
                    />
                    <p id="idNumber-hint" className="text-xs text-muted-foreground">
                      We use it only to confirm the request is yours. Handled securely under POPIA.
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
                      className="flex min-h-[96px] w-full rounded-xl border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      value={details}
                      onChange={(e) => setDetails(e.target.value)}
                      placeholder="Optional: tell us which data or which account this is about"
                      rows={3}
                    />
                  </div>

                  {/* Turnstile CAPTCHA */}
                  <TurnstileWidget
                    key={captchaAttempt}
                    retryToken={captchaAttempt}
                    onSuccess={(token) => {
                      setTurnstileToken(token);
                      setTurnstileUnavailable(false);
                    }}
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
                    variant="trust-verified"
                    size="lg"
                    className="w-full"
                    disabled={isSubmitting || !turnstileToken}
                  >
                    {isSubmitting ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Send className="h-4 w-4" aria-hidden="true" />
                    )}
                    Send request
                  </Button>

                  {!turnstileToken && !turnstileUnavailable && (
                    <p className="text-center text-xs text-muted-foreground">
                      Complete the security check to submit.
                    </p>
                  )}
                </form>
              </section>
            )}

            <aside aria-labelledby="dsar-next-title" className="space-y-4">
              <div className="surface-card p-5 sm:p-6">
                <h2 id="dsar-next-title" className="font-body text-base font-semibold">
                  What happens next
                </h2>
                <ol className="mt-4 space-y-4">
                  {NEXT_STEPS.map((step, index) => (
                    <li key={step.title} className="flex gap-3.5">
                      <span
                        aria-hidden="true"
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-green/10 text-xs font-bold text-brand-green-700 dark:bg-brand-green/15 dark:text-brand-green-300"
                      >
                        {index + 1}
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-foreground">{step.title}</p>
                        <p className="mt-0.5 text-sm leading-6 text-muted-foreground">
                          {step.body}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
              <div className="surface-card p-5 text-sm leading-6 text-muted-foreground sm:p-6">
                <p className="font-semibold text-foreground">Prefer email?</p>
                <p className="mt-0.5">
                  <a
                    href={`mailto:${PRIVACY_CONTACT_EMAIL}`}
                    className="break-all font-semibold text-brand-green-700 underline underline-offset-4 dark:text-brand-green-300"
                  >
                    {PRIVACY_CONTACT_EMAIL}
                  </a>
                </p>
                <Link
                  href="/privacy"
                  className="mt-2 inline-flex min-h-10 items-center font-semibold text-foreground underline underline-offset-4"
                >
                  Privacy Policy
                </Link>
              </div>
            </aside>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
