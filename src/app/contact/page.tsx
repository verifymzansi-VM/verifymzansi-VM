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

export default function ContactPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const { toast } = useToast();
  const runtimeConfig = getPublicRuntimeConfig();

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
          err instanceof Error ? err.message : "Please try again or email support@verifymzansi.com",
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
          <PageHeader title="Contact Us" breadcrumbs={[{ label: "Contact" }]} />

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
                    Thank you for reaching out! Our team will get back to you at{" "}
                    <strong>{email}</strong> within 1–2 business days (South African business
                    hours).
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setIsSubmitted(false);
                      setName("");
                      setEmail("");
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
                        aria-describedby={fieldErrors.message ? "message-error" : undefined}
                      />
                      {fieldErrors.message && (
                        <p id="message-error" role="alert" className="inline-form-error">
                          {fieldErrors.message}
                        </p>
                      )}
                    </div>

                    <TurnstileWidget
                      onSuccess={handleTurnstileSuccess}
                      onError={() => setTurnstileToken("")}
                      onExpire={() => setTurnstileToken("")}
                    />

                    <Button
                      type="submit"
                      className="w-full sm:w-auto gap-2"
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
