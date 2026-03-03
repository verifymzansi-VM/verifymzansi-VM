"use client";

import { useState } from "react";
import { Send, Loader2, CheckCircle2, Shield } from "lucide-react";
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

export default function DsarPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [requestType, setRequestType] = useState<RequestType>("access");
  const [details, setDetails] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const { toast } = useToast();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errors: Record<string, string> = {};

    if (!name) errors.name = "Full name is required";
    if (!email) errors.email = "Email address is required";

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
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Submission failed");
      }

      setIsSubmitted(true);
    } catch (err) {
      toast({
        title: "Failed to submit request",
        description:
          err instanceof Error
            ? err.message
            : "Please try again or email privacy@verifymzansi.co.za",
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
      desc: "Request a copy of all personal data we hold about you",
    },
    {
      value: "correction",
      label: "Correct My Data",
      desc: "Request correction of inaccurate personal information",
    },
    {
      value: "deletion",
      label: "Delete My Data",
      desc: "Request deletion of your personal data and account",
    },
    {
      value: "objection",
      label: "Object to Processing",
      desc: "Object to how we process your personal information",
    },
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1">
        <div className="container-page py-6 space-y-8">
          <PageHeader
            title="Data Subject Access Request"
            description="Exercise your rights under POPIA. Submit a request to access, correct, or delete your personal data held by VerifyMzansi."
            breadcrumbs={[{ label: "Data Request (POPIA)" }]}
          />

          <div className="mx-auto max-w-xl">
            {isSubmitted ? (
              <Card>
                <CardContent className="p-8 text-center space-y-4">
                  <CheckCircle2 className="h-12 w-12 text-brand-green mx-auto" />
                  <h2 className="font-display text-xl font-bold">Request Submitted</h2>
                  <p className="text-muted-foreground">
                    We&apos;ve received your request and will respond within 30 days as required by
                    POPIA. You&apos;ll receive a confirmation email at <strong>{email}</strong>.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Reference: DSAR-{Date.now().toString(36).toUpperCase()}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Shield className="h-5 w-5 text-brand-green" />
                    Submit a Request
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleSubmit} className="space-y-5">
                    {/* Request Type */}
                    <div className="space-y-3">
                      <Label>Request Type</Label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {REQUEST_TYPES.map((rt) => (
                          <button
                            key={rt.value}
                            type="button"
                            onClick={() => setRequestType(rt.value)}
                            className={`rounded-lg border p-3 text-left transition-colors ${
                              requestType === rt.value
                                ? "border-brand-green bg-brand-green-50 dark:bg-brand-green-950/30"
                                : "border-muted hover:border-foreground/20"
                            }`}
                          >
                            <p className="text-sm font-medium">{rt.label}</p>
                            <p className="text-xs text-muted-foreground">{rt.desc}</p>
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
                        aria-invalid={!!fieldErrors.name}
                        aria-describedby={fieldErrors.name ? "name-error" : undefined}
                      />
                      {fieldErrors.name && (
                        <p
                          id="name-error"
                          role="alert"
                          className="text-sm text-destructive"
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
                        aria-invalid={!!fieldErrors.email}
                        aria-describedby={fieldErrors.email ? "email-error" : undefined}
                      />
                      {fieldErrors.email && (
                        <p
                          id="email-error"
                          role="alert"
                          className="text-sm text-destructive"
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
                        placeholder="13-digit SA ID number"
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
                          className="text-sm text-destructive"
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
                        className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                        value={details}
                        onChange={(e) => setDetails(e.target.value)}
                        placeholder="Any additional information about your request..."
                      />
                    </div>

                    {/* Turnstile CAPTCHA */}
                    <TurnstileWidget
                      onSuccess={(token) => setTurnstileToken(token)}
                      onError={() => setTurnstileToken("")}
                      onExpire={() => setTurnstileToken("")}
                    />

                    <Button type="submit" className="w-full gap-2" disabled={isSubmitting}>
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
