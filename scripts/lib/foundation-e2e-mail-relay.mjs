// Local stand-in for the email provider's send API, for the foundation test
// copy only (M0.9a). The website sends its emails through the provider's SDK,
// which reads its API address from RESEND_BASE_URL; the copy points that at
// this relay on loopback, so the website's own emails (for example the email
// job's seller notices) land in the copy's local mail catcher instead of
// reaching the provider. Production never sets RESEND_BASE_URL.
//
// It answers only POST /emails with the copy's synthetic key, accepts only
// recipients on the reserved .test domain, and hands each message to the local
// mail catcher's send API on 127.0.0.1. The provider's idempotency key travels
// as a header so tests can find the exact message for an outbox event.
import { createServer } from "node:http";
import { assertLoopbackUrl } from "./foundation-e2e-target.mjs";

const MAX_BODY_BYTES = 256 * 1024;
export const IDEMPOTENCY_HEADER = "X-Resend-Idempotency-Key";
const IDEMPOTENCY_KEY = /^[A-Za-z0-9/_:.-]{1,256}$/;
const ADDRESS = /^[^\s@<>",]+@[^\s@<>",]+$/;

/** "Name <a@b>" or "a@b" to the mail catcher's address shape; null when malformed. */
function parseAddress(value) {
  if (typeof value !== "string" || value.length > 320) return null;
  const named = /^\s*(.*?)\s*<([^<>]+)>\s*$/.exec(value);
  const email = (named ? named[2] : value).trim();
  if (!ADDRESS.test(email)) return null;
  const name = named ? named[1].replace(/^"|"$/g, "").trim() : "";
  return name ? { Email: email, Name: name } : { Email: email };
}

function addressList(value) {
  const items = Array.isArray(value) ? value : value === undefined ? [] : [value];
  const parsed = items.map(parseAddress);
  return parsed.every(Boolean) ? parsed : null;
}

/** Only the reserved .test domain (RFC 2606) ever receives mail from the copy. */
function isTestRecipient(address) {
  return /\.test$/i.test(address.Email.split("@")[1] ?? "");
}

/**
 * Translates one provider send request into the mail catcher's send request.
 * @returns {{ ok: true, message: Record<string, unknown> } | { ok: false, reason: string }}
 */
export function toMailCatcherMessage(body, idempotencyKey) {
  if (typeof body !== "object" || body === null || Array.isArray(body))
    return { ok: false, reason: "invalid body" };
  const from = parseAddress(body.from);
  const to = addressList(body.to);
  const replyTo = addressList(body.reply_to);
  if (!from || !to || to.length === 0 || to.length > 10 || !replyTo)
    return { ok: false, reason: "invalid addresses" };
  if (!to.every(isTestRecipient)) return { ok: false, reason: "recipient outside the copy" };
  if (body.cc !== undefined || body.bcc !== undefined || body.attachments !== undefined)
    return { ok: false, reason: "unsupported fields" };
  if (typeof body.subject !== "string" || body.subject.length === 0 || body.subject.length > 998)
    return { ok: false, reason: "invalid subject" };
  for (const field of ["html", "text"])
    if (body[field] !== undefined && typeof body[field] !== "string")
      return { ok: false, reason: `invalid ${field}` };
  if (idempotencyKey !== undefined && !IDEMPOTENCY_KEY.test(idempotencyKey))
    return { ok: false, reason: "invalid idempotency key" };
  return {
    ok: true,
    message: {
      From: from,
      To: to,
      ...(replyTo.length ? { ReplyTo: replyTo } : {}),
      Subject: body.subject,
      ...(body.text !== undefined ? { Text: body.text } : {}),
      ...(body.html !== undefined ? { HTML: body.html } : {}),
      ...(idempotencyKey ? { Headers: { [IDEMPOTENCY_HEADER]: idempotencyKey } } : {}),
    },
  };
}

/**
 * @param {{ port: number, apiKey: string, mailOrigin: string, fetchImpl?: typeof fetch }} options
 * @returns {Promise<import("node:http").Server>}
 */
export function startLocalMailRelay({ port, apiKey, mailOrigin, fetchImpl = fetch }) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid relay port");
  if (typeof apiKey !== "string" || apiKey.length < 16) throw new Error("Invalid relay key");
  const catcher = assertLoopbackUrl(mailOrigin, { what: "the mail catcher", protocols: ["http:"] });
  if (catcher.pathname !== "/") throw new Error("Invalid mail catcher address");
  const sendUrl = new URL("/api/v1/send", catcher);
  const server = createServer((request, response) => {
    const answer = (status, body) => {
      response.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      response.end(JSON.stringify(body));
    };
    // The provider's error shape, so the website's sender reports it as a failure.
    const refuse = (status, name, message) => answer(status, { statusCode: status, name, message });
    if (request.url !== "/emails") return refuse(404, "not_found", "not found");
    if (request.method !== "POST") return refuse(405, "method_not_allowed", "method not allowed");
    if (request.headers.authorization !== `Bearer ${apiKey}`)
      return refuse(401, "missing_api_key", "unauthorised");
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) request.destroy();
      else chunks.push(chunk);
    });
    request.on("end", async () => {
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        return refuse(422, "validation_error", "invalid body");
      }
      const header = request.headers["idempotency-key"];
      const translated = toMailCatcherMessage(body, Array.isArray(header) ? header[0] : header);
      if (!translated.ok) return refuse(422, "validation_error", translated.reason);
      try {
        const sent = await fetchImpl(sendUrl, {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(5000),
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(translated.message),
        });
        const result = await sent.json().catch(() => null);
        if (!sent.ok || typeof result?.ID !== "string")
          return refuse(502, "application_error", "mail catcher refused the message");
        return answer(200, { id: result.ID });
      } catch {
        return refuse(502, "application_error", "mail catcher unavailable");
      }
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}
