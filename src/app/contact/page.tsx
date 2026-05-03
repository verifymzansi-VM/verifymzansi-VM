"use client";

import { useState, useCallback } from "react";
import { Loader2, CheckCircle2, Send } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { TurnstileWidget } from "@/components/ui/turnstile-widget";
import { useToast } from "@/hooks/use-toast";
import { getPublicRuntimeConfig } from "@/lib/public-runtime-config";
import { OfficialSocialLinks } from "@/components/shared/official-social-links";
import { SUPPORT_CONTACT_EMAIL } from "@/lib/contact-email";

const contactCategories = [
  {
    value: "fraud_report",
    label: "Fraud report",
    response: "Fraud reports are reviewed within 24-48 hours.",
  },
  {
    value: "verification_appeal",
    label: "Verification appeal",
    response: "Verification appeals are reviewed within 2-3 business days.",
  },
  {
    value: "privacy_popia",
    label: "Privacy/POPIA request",
    response: "Privacy requests are acknowledged within 2 business days.",
  },
  {
    value: "payment_refund",
    label: "Payment/refund issue",
    response: "Payment issues are reviewed within 2 business days.",
  },
  {
    value: "security_vulnerability",
    label: "Security vulnerability",
    response: "Security reports are triaged as soon as possible.",
  },
  {
    value: "business_claim",
    label: "Business claim request",
    response: "Business claim requests require proof of authority and are reviewed manually.",
  },
  {
    value: "general_support",
    label: "General support",
    response: "General messages are answered within 1-2 business days.",
  },
] as const;

export default function ContactPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [category, setCategory] =
    useState<(typeof contactCategories)[number]["value"]>("general_support");
  const [message, setMessage] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileUnavailable, setTurnstileUnavailable] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const { toast } = useToast();
  const runtimeConfig = getPublicRuntimeConfig();
  const selectedCategory = contactCategories.find((item) => item.value === category);

  const handleTurnstileSuccess = useCallback((token: string) => {
    setTurnstileToken(token);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Client-side validation
    const errors: Record<string, string> = {};
    if (!name.trim()) errors.name = "Name is required";
    if (!email.trim()) errors.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "Enter a valid email";
    if (!message.trim()) errors.message = "Message is required";
    else if (message.trim().length < 10) errors.message = "Message must be at least 10 characters";

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/contact/general", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          category,
          message: message.trim(),
          turnstileToken: turnstileToken || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to send message");
      }

      setIsSubmitted(true);
    } catch (err) {
      toast({
        title: "Failed to send message",
        description:
          err instanceof Error ? err.message : `Please try again or email ${SUPPORT_CONTACT_EMAIL}`,
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main id="main-content" className="flex-1">
        <div className="container-page py-4 space-y-4">
          <PageHeader
            title="Contact"
            description="Send support, verification, payment, privacy, or security requests to the right team."
            breadcrumbs={[{ label: "Contact" }]}
          />

          <div className="mx-auto max-w-lg">
            <OfficialSocialLinks
              links={runtimeConfig.officialSocialLinks}
              className="mb-4 rounded-xl border bg-card p-4"
              linkClassName="inline-flex items-center rounded-full border border-border/70 px-3 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            />

            {isSubmitted ? (
              <Card>
                <CardContent className="p-6 text-center space-y-3">
                  <CheckCircle2 className="h-10 w-10 text-brand-green mx-auto" />
                  <h2 className="font-display text-xl font-bold">Message Sent</h2>
                  <p className="text-muted-foreground">
                    We will reply to <strong>{email}</strong> within 1-2 business days. Fraud and
                    security reports are prioritised.
                  </p>
                  <Button
                    variant="outline"
                    className="h-11"
                    onClick={() => {
                      setIsSubmitted(false);
                      setName("");
                      setEmail("");
                      setCategory("general_support");
                      setMessage("");
                      setTurnstileToken("");
                    }}
                  >
                    Send Another Message
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>Send a Message</CardTitle>
                </CardHeader>
                <CardContent>
                  <form data-testid="contact-form" onSubmit={handleSubmit} className="space-y-3">
                    <div className="space-y-2">
                      <Label htmlFor="name">Name *</Label>
                      <Input
                        id="name"
                        name="name"
                        value={name}
                        onChange={(e) => {
                          setName(e.target.value);
                          if (fieldErrors.name) setFieldErrors((p) => ({ ...p, name: "" }));
                        }}
                        required
                        placeholder="Your full name"
                        autoComplete="name"
                        aria-invalid={fieldErrors.name ? "true" : undefined}
                        aria-describedby={fieldErrors.name ? "name-error" : undefined}
                      />
                      {fieldErrors.name && (
                        <p id="name-error" role="alert" className="inline-form-error">
                          {fieldErrors.name}
                        </p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="category">Contact category *</Label>
                      <select
                        id="category"
                        name="category"
                        value={category}
                        onChange={(e) =>
                          setCategory(e.target.value as (typeof contactCategories)[number]["value"])
                        }
                        className="h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      >
                        {contactCategories.map((item) => (
                          <option key={item.value} value={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                      {selectedCategory && (
                        <p className="text-xs text-muted-foreground">{selectedCategory.response}</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="email">Email *</Label>
                      <Input
                        id="email"
                        name="email"
                        type="email"
                        inputMode="email"
                        value={email}
                        onChange={(e) => {
                          setEmail(e.target.value);
                          if (fieldErrors.email) setFieldErrors((p) => ({ ...p, email: "" }));
                        }}
                        required
                        placeholder="you@example.com"
                        autoComplete="email"
                        aria-invalid={fieldErrors.email ? "true" : undefined}
                        aria-describedby={fieldErrors.email ? "email-error" : undefined}
                      />
                      {fieldErrors.email && (
                        <p id="email-error" role="alert" className="inline-form-error">
                          {fieldErrors.email}
                        </p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="message">Message *</Label>
                      <Textarea
                        id="message"
                        name="message"
                        value={message}
                        onChange={(e) => {
                          setMessage(e.target.value);
                          if (fieldErrors.message) setFieldErrors((p) => ({ ...p, message: "" }));
                        }}
                        required
                        rows={3}
                        className="min-h-[60px]"
                        placeholder="How can we help?"
                        aria-invalid={fieldErrors.message ? "true" : undefined}
                        aria-describedby={fieldErrors.message ? "message-error" : "message-hint"}
                      />
                      {fieldErrors.message ? (
                        <p id="message-error" role="alert" className="inline-form-error">
                          {fieldErrors.message}
                        </p>
                      ) : (
                        <p id="message-hint" className="text-xs text-muted-foreground">
                          Minimum 10 characters.
                        </p>
                      )}
                    </div>

                    <TurnstileWidget
                      onSuccess={handleTurnstileSuccess}
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
                      className="h-11 w-full gap-2 sm:w-auto"
                      disabled={isSubmitting || !turnstileToken}
                    >
                      {isSubmitting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                      Send Message
                    </Button>
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
