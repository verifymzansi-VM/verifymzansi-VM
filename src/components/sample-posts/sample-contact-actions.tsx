"use client";

import { useState } from "react";
import { Loader2, MessageCircle, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { contactPhone, whatsappLink } from "@/lib/utils/contact-links";
import { withCsrfHeaders } from "@/lib/utils/csrf-client";

/**
 * VerifyMzansi's own Call and WhatsApp buttons on a sample page. The numbers
 * load only after the visitor clicks; no sign-in. The labels say these reach
 * VerifyMzansi, not the business in the video.
 */
export function SampleContactActions({ slug, title }: { slug: string; title: string }) {
  const [numbers, setNumbers] = useState<{ phone: string | null; whatsapp: string | null } | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reveal() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/sample-posts/contact", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ slug }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        phone?: string | null;
        whatsapp?: string | null;
      };
      if (!response.ok) {
        setError("Couldn't show the number. Try again.");
        return;
      }
      setNumbers({ phone: data.phone ?? null, whatsapp: data.whatsapp ?? null });
    } catch {
      setError("Couldn't show the number. Try again.");
    } finally {
      setLoading(false);
    }
  }

  const phone = contactPhone(numbers?.phone);
  const whatsapp = whatsappLink(
    numbers?.whatsapp,
    title,
    `/sample/${slug}`,
    "Hi VerifyMzansi, I saw the sample post"
  );

  return (
    <div className="mt-6 space-y-2" data-sample-contact>
      <p className="text-sm text-muted-foreground">
        These buttons contact VerifyMzansi, not the business in the video.
      </p>
      {numbers === null ? (
        <Button size="lg" className="h-11 gap-2" onClick={() => void reveal()} disabled={loading}>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Phone className="h-4 w-4" aria-hidden="true" />
          )}
          Show VerifyMzansi&apos;s number
        </Button>
      ) : (
        <div className="flex flex-wrap gap-3">
          {phone ? (
            <Button asChild size="lg" variant="outline" className="h-11 gap-2">
              <a href={`tel:${phone}`}>
                <Phone className="h-4 w-4" aria-hidden="true" />
                Call VerifyMzansi {phone}
              </a>
            </Button>
          ) : null}
          {whatsapp ? (
            <Button asChild size="lg" className="h-11 gap-2">
              <a href={whatsapp} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="h-4 w-4" aria-hidden="true" />
                WhatsApp VerifyMzansi
              </a>
            </Button>
          ) : null}
        </div>
      )}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
