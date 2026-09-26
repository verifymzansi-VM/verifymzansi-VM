"use client";

import Link from "next/link";
import { useState, useCallback, useEffect } from "react";
import { BadgeHelp, CheckCircle2, Clock, FileLock2, Flag, Loader2, Mail, Send } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { InfoHero } from "@/components/safety/info-hero";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { TurnstileWidget } from "@/components/ui/turnstile-widget";
import { useToast } from "@/hooks/use-toast";
import { getPublicRuntimeConfig } from "@/lib/public-runtime-config";
import { OfficialSocialLinks } from "@/components/shared/official-social-links";
import { CONTACT_CATEGORY_EMAILS, SUPPORT_CONTACT_EMAIL } from "@/lib/contact-email";

const contactCategories = [
  {
    value: "fraud_report",
    label: "Fraud report",
    response: "Fraud reports are reviewed within 1-2 business days.",
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
    value: "organisation_proposal",
    label: "Organisation or bulk posting proposal",
    response:
      "Proposals for organisations and 50+ active posting slots are answered within 2 business days.",
  },
  {
    value: "general_support",
    label: "General support",
    response: "General messages are answered within 1-2 business days.",
  },
] as const;

const HELP_LINKS = [
  { href: "/safety", label: "Safety Centre", icon: Flag },
  { href: "/help/verification", label: "Verification help", icon: BadgeHelp },
  { href: "/dsar", label: "POPIA data request", icon: FileLock2 },
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
  const [receipt, setReceipt] = useState<{ reference?: string; acknowledgement?: string }>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const { toast } = useToast();
  const runtimeConfig = getPublicRuntimeConfig();
  const selectedCategory = contactCategories.find((item) => item.value === category);

  // Deep links such as /contact?topic=organisation_proposal preselect a category.
  useEffect(() => {
    const topic = new URLSearchParams(window.location.search).get("topic");
    const match = contactCategories.find((item) => item.value === topic);
    if (match) setCategory(match.value);
  }, []);

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

      setReceipt(await res.json());
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

  const categoryEmail = CONTACT_CATEGORY_EMAILS[category];

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main id="main-content" className="flex-1">
        <InfoHero
          title="Contact Us"
          description="Pick a topic and we'll route it to the right team."
          breadcrumbs={[{ label: "Contact" }]}
        />

        <div className="container-page py-8 sm:py-12">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)] lg:gap-10">
            {isSubmitted ? (
              <section
                aria-labelledby="contact-success-title"
                className="hero-panel p-6 text-center sm:p-10"
              >
                <div className="empty-state-icon">
                  <CheckCircle2 className="h-7 w-7" aria-hidden="true" />
                </div>
                <h2
                  id="contact-success-title"
                  className="mt-4 font-display text-2xl font-bold tracking-tight"
                >
                  Request received
                </h2>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
                  Your request is saved in our support inbox. Our team will review it and reply to{" "}
                  <strong className="text-foreground">{email}</strong>. {selectedCategory?.response}
                </p>
                {receipt.reference && (
                  <p className="mx-auto mt-5 w-fit max-w-full break-all rounded-xl bg-muted px-4 py-2.5 font-mono text-sm font-semibold text-foreground">
                    Reference: {receipt.reference}
                  </p>
                )}
                <p className="mx-auto mt-4 max-w-md text-sm leading-6 text-muted-foreground">
                  {receipt.acknowledgement === "accepted"
                    ? "An acknowledgement email has been queued. If it does not arrive, check spam. You do not need to submit again."
                    : "Your request is saved, but we could not confirm the acknowledgement email was sent. Keep your reference; you do not need to submit again."}
                </p>
                <Button
                  variant="outline"
                  className="mt-6 h-11"
                  onClick={() => {
                    setIsSubmitted(false);
                    setReceipt({});
                    setName("");
                    setEmail("");
                    setCategory("general_support");
                    setMessage("");
                    setTurnstileToken("");
                  }}
                >
                  Send another message
                </Button>
              </section>
            ) : (
              <section aria-labelledby="contact-form-title" className="hero-panel p-5 sm:p-8">
                <h2
                  id="contact-form-title"
                  className="font-display text-xl font-bold tracking-tight sm:text-2xl"
                >
                  Send us a message
                </h2>
                <form data-testid="contact-form" onSubmit={handleSubmit} className="mt-6 space-y-5">
                  <div className="grid gap-5 sm:grid-cols-2">
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
                        className="h-11"
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
                        className="h-11"
                        aria-invalid={fieldErrors.email ? "true" : undefined}
                        aria-describedby={fieldErrors.email ? "email-error" : undefined}
                      />
                      {fieldErrors.email && (
                        <p id="email-error" role="alert" className="inline-form-error">
                          {fieldErrors.email}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="category">What is it about? *</Label>
                    <select
                      id="category"
                      name="category"
                      value={category}
                      onChange={(e) =>
                        setCategory(e.target.value as (typeof contactCategories)[number]["value"])
                      }
                      aria-describedby="category-hint"
                      className="h-11 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      {contactCategories.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                    {selectedCategory && (
                      <p
                        id="category-hint"
                        className="flex items-center gap-1.5 text-xs text-muted-foreground"
                      >
                        <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        {selectedCategory.response}
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
                      rows={5}
                      className="min-h-[132px]"
                      placeholder="Tell us what happened. Include listing links or references if you have them."
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

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <Button
                      type="submit"
                      variant="trust-verified"
                      size="lg"
                      className="w-full sm:w-auto"
                      disabled={isSubmitting || !turnstileToken}
                    >
                      {isSubmitting ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Send className="h-4 w-4" aria-hidden="true" />
                      )}
                      Send message
                    </Button>
                    {!turnstileToken && !turnstileUnavailable && (
                      <p className="text-xs text-muted-foreground">
                        Complete the security check to send.
                      </p>
                    )}
                  </div>
                </form>
              </section>
            )}

            <aside className="space-y-4" aria-label="Other ways to reach us">
              <div className="surface-card p-5 sm:p-6">
                <span className="icon-tile area-market-tile">
                  <Mail className="h-5 w-5" aria-hidden="true" />
                </span>
                <h2 className="mt-4 font-body text-base font-semibold text-foreground">
                  Prefer email?
                </h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  For {selectedCategory?.label.toLowerCase()}, contact{" "}
                  <a
                    className="break-all font-semibold text-brand-green-700 underline underline-offset-4 hover:text-brand-green-800 dark:text-brand-green-300 dark:hover:text-brand-green-200"
                    href={`mailto:${categoryEmail}`}
                  >
                    {categoryEmail}
                  </a>
                  .
                </p>
              </div>

              <div className="surface-card p-5 sm:p-6">
                <h2 className="font-body text-base font-semibold text-foreground">Quick help</h2>
                <ul className="mt-3 divide-y divide-border/60">
                  {HELP_LINKS.map(({ href, label, icon: Icon }) => (
                    <li key={href}>
                      <Link
                        href={href}
                        className="flex min-h-12 items-center gap-3 py-2 text-sm font-medium text-foreground transition-colors hover:text-brand-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:text-brand-green-300"
                      >
                        <Icon
                          className="h-4 w-4 shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                        {label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-2xl border border-brand-red/25 bg-brand-red-50 p-5 text-sm leading-6 text-foreground/85 dark:border-brand-red/30 dark:bg-brand-red-950/30">
                <p className="font-semibold text-foreground">In danger right now?</p>
                <p className="mt-0.5">
                  Call SAPS on{" "}
                  <a href="tel:10111" className="font-semibold underline underline-offset-4">
                    10111
                  </a>{" "}
                  or{" "}
                  <a href="tel:112" className="font-semibold underline underline-offset-4">
                    112
                  </a>{" "}
                  from a cellphone.
                </p>
              </div>

              <OfficialSocialLinks
                links={runtimeConfig.officialSocialLinks}
                className="surface-card p-5"
                titleClassName="text-sm font-semibold text-foreground"
                linkClassName="inline-flex min-h-9 items-center rounded-full border border-border/70 px-3.5 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </aside>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
