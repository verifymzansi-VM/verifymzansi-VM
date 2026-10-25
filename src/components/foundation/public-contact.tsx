"use client";
import { useRef, useState } from "react";
import { TurnstileWidget } from "@/components/ui/turnstile-widget";
import { ensureCsrfTokenReady, withCsrfHeaders } from "@/lib/utils/csrf";
export function FoundationContact({
  postId,
  channels,
}: {
  postId: string;
  channels: ("call" | "whatsapp" | "form")[];
}) {
  const [token, setToken] = useState("");
  const [retry, setRetry] = useState(0);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [phone, setPhone] = useState<string | null>(null);
  const requestId = useRef<string | null>(null);
  async function request(path: string, body: object) {
    if (!token) throw new Error("Complete the security challenge");
    await ensureCsrfTokenReady();
    const response = await fetch(path, {
      method: "POST",
      headers: withCsrfHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ ...body, turnstile_token: token }),
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        typeof data.error === "string" ? data.error : "The request could not be completed"
      );
    return data;
  }
  async function reveal(channel: "call" | "whatsapp") {
    setBusy(true);
    setMessage("");
    try {
      const data = await request("/api/foundation/contact", { post_id: postId, channel });
      if (typeof data.phone !== "string" || !/^\+27[0-9]{9}$/.test(data.phone))
        throw new Error("This contact option is unavailable");
      setPhone(data.phone);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Contact options could not be loaded");
    } finally {
      setToken("");
      setRetry((value) => value + 1);
      setBusy(false);
    }
  }
  if (!channels.length)
    return (
      <p className="rounded-xl border p-5 text-sm">This member has not enabled contact options.</p>
    );
  return (
    <section className="space-y-4 rounded-2xl border bg-card p-5">
      <h2 className="text-lg font-semibold">Contact this member</h2>
      {channels.includes("form") && !sent && (
        <form
          className="space-y-3"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            setBusy(true);
            setMessage("");
            try {
              requestId.current ??= crypto.randomUUID();
              await request("/api/foundation/enquiries", {
                request_id: requestId.current,
                post_id: postId,
                buyer_email: String(form.get("email")),
                message: String(form.get("message")),
                ...(form.get("name") ? { buyer_name: String(form.get("name")) } : {}),
              });
              setSent(true);
              setMessage("Your message has been sent to the member.");
            } catch (error) {
              setMessage(error instanceof Error ? error.message : "Your message could not be sent");
            } finally {
              setToken("");
              setRetry((value) => value + 1);
              setBusy(false);
            }
          }}
        >
          <label className="block text-sm">
            Your name
            <input
              name="name"
              minLength={2}
              maxLength={80}
              className="mt-1 w-full rounded-lg border bg-background p-3"
            />
          </label>
          <label className="block text-sm">
            Reply email
            <input
              type="email"
              name="email"
              required
              maxLength={254}
              className="mt-1 w-full rounded-lg border bg-background p-3"
            />
          </label>
          <label className="block text-sm">
            Message
            <textarea
              name="message"
              required
              minLength={10}
              maxLength={1000}
              rows={5}
              className="mt-1 w-full rounded-lg border bg-background p-3"
            />
          </label>
          <button
            disabled={busy || !token}
            className="w-full rounded-lg bg-primary p-3 font-semibold text-primary-foreground disabled:opacity-50"
          >
            {busy ? "Sending…" : "Send enquiry"}
          </button>
        </form>
      )}
      {phone ? (
        <div className="flex flex-wrap gap-3">
          {channels.includes("call") && (
            <a className="rounded-lg border px-4 py-3" href={`tel:${phone}`}>
              Call {phone}
            </a>
          )}
          {channels.includes("whatsapp") && (
            <a
              className="rounded-lg border px-4 py-3"
              href={`https://wa.me/${phone.slice(1)}`}
              rel="noreferrer"
              target="_blank"
            >
              WhatsApp
            </a>
          )}
        </div>
      ) : (
        <div className="flex gap-3">
          {channels.includes("call") && (
            <button
              type="button"
              className="rounded-lg border p-3"
              disabled={busy || !token}
              onClick={() => void reveal("call")}
            >
              Show phone
            </button>
          )}
          {channels.includes("whatsapp") && (
            <button
              type="button"
              className="rounded-lg border p-3"
              disabled={busy || !token}
              onClick={() => void reveal("whatsapp")}
            >
              Show WhatsApp
            </button>
          )}
        </div>
      )}
      {(!sent || (!phone && channels.some((channel) => channel !== "form"))) && (
        <TurnstileWidget onSuccess={setToken} onExpire={() => setToken("")} retryToken={retry} />
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </section>
  );
}
