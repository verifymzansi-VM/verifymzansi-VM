import "server-only";
import { z } from "zod";
import { IDENTITY_CHECK_FRAME_ORIGIN } from "../verification/identity-check-frame";

/**
 * The automatic ID check partner's API (Didit, v3), server side only. The
 * owner sets DIDIT_API_KEY (scopes: create sessions, read decisions, delete
 * sessions) and DIDIT_WORKFLOW_ID as Worker settings; this code never makes
 * or handles keys. The partner receives only our random check id
 * (`vendor_data`): no name, contact, network or device detail.
 */
const API = "https://verification.didit.me";
const TIMEOUT_MS = 10_000;
/** A larger photo is refused (the verification limit). */
const IMAGE_LIMIT = 5 * 1024 * 1024;

export type DiditConfig = { apiKey: string; workflowId: string };
/** Why a check could not start: the database pause reasons. */
export type DiditUnavailableReason = "no_credit" | "outage" | "not_configured";

export class DiditError extends Error {
  override name = "DiditError";
  constructor(
    readonly reason: DiditUnavailableReason,
    readonly status?: number,
    /** A short code for the logs (never member data). */
    readonly detail?: string
  ) {
    super(`Identity check partner unavailable: ${reason}`);
  }
}

/** The partner settings, or null while either is missing or malformed. */
export function diditConfig(
  environment: Record<string, string | undefined> = process.env
): DiditConfig | null {
  const apiKey = environment.DIDIT_API_KEY?.trim();
  const workflowId = environment.DIDIT_WORKFLOW_ID?.trim();
  if (!apiKey || !workflowId || !z.uuid().safeParse(workflowId).success) return null;
  return { apiKey, workflowId };
}

async function call(
  config: DiditConfig,
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
  signal?: AbortSignal
) {
  try {
    return await fetch(`${API}${path}`, {
      method,
      headers: {
        "x-api-key": config.apiKey,
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal ?? AbortSignal.timeout(TIMEOUT_MS),
      redirect: "error",
    });
  } catch {
    throw new DiditError("outage");
  }
}

/** A refused request: credit, our own settings (key, scopes, workflow) or
 * the partner itself. */
async function refused(response: Response): Promise<never> {
  const text = await response.text().catch(() => "");
  if ((response.status === 400 || response.status === 402) && /credit|balance/i.test(text))
    throw new DiditError("no_credit", response.status);
  if ([400, 401, 403, 404].includes(response.status))
    throw new DiditError("not_configured", response.status);
  throw new DiditError("outage", response.status);
}

const sessionUrl = z
  .string()
  .max(500)
  .refine((url) => url.startsWith(`${IDENTITY_CHECK_FRAME_ORIGIN}/`));
const createdSession = z.object({ session_id: z.uuid(), url: sessionUrl });

/** A new partner session for one check. */
export async function createDiditSession(config: DiditConfig, checkId: string) {
  const response = await call(config, "POST", "/v3/session/", {
    workflow_id: config.workflowId,
    vendor_data: checkId,
  });
  if (!response.ok) return refused(response);
  const parsed = createdSession.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new DiditError("outage", response.status);
  return { sessionId: parsed.data.session_id, url: parsed.data.url };
}

const text = z.string().nullish();
const decisionSchema = z.object({
  session_id: z.uuid(),
  status: z.string(),
  vendor_data: text,
  id_verifications: z
    .array(
      z.object({
        first_name: text,
        last_name: text,
        personal_number: text,
        issuing_state: text,
        front_image: text,
      })
    )
    .nullish(),
  liveness_checks: z.array(z.object({ reference_image: text })).nullish(),
  ip_analyses: z.array(z.object({ ip_address: text, platform: text })).nullish(),
});
export type DiditDecision = z.infer<typeof decisionSchema>;

/** The session's decision, read from the partner (never from a webhook body). */
export async function fetchDiditDecision(config: DiditConfig, sessionId: string) {
  const response = await call(
    config,
    "GET",
    `/v3/session/${encodeURIComponent(sessionId)}/decision/`
  );
  if (!response.ok) return refused(response);
  const parsed = decisionSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new DiditError("outage", response.status);
  return parsed.data;
}

/** Deletes a session and its face data at the partner; an already deleted
 * session counts as deleted. */
export async function deleteDiditSession(
  config: DiditConfig,
  sessionId: string,
  signal?: AbortSignal
) {
  const response = await call(
    config,
    "DELETE",
    `/v3/session/${encodeURIComponent(sessionId)}/delete/`,
    { deletion_instruction: "privacy_erasure" },
    signal
  );
  if (!response.ok && response.status !== 404) return refused(response);
}

/**
 * Hosts the decision's photo links may point to. Didit's documentation shows
 * only a placeholder ("<media-host>"), so this allows Didit's own domain and
 * Amazon S3 bucket hosts; the sandbox check before switch-on confirms the
 * real host (a refused host fails as a temporary error, "media_host", so the
 * result is recorded once the list is corrected).
 */
function allowedMediaHost(hostname: string) {
  // Plain suffix checks (no pattern matching): Didit's own domain, or an
  // Amazon S3 host ("<bucket>.s3.amazonaws.com", "<bucket>.s3.<region>.amazonaws.com").
  if (hostname === "didit.me" || hostname.endsWith(".didit.me")) return true;
  if (!hostname.endsWith(".amazonaws.com")) return false;
  const labels = hostname.split(".");
  const s3 = labels.indexOf("s3");
  return s3 > 0 && s3 >= labels.length - 4;
}

const stopReading = (cancelled: Promise<void>) =>
  cancelled.catch(() => {
    // Only stops the download; the refusal that follows is what matters.
  });

/** A photo from the decision's short-lived signed link: https, an allowed
 * host, no user name or password in the link, read up to the size limit. */
export async function fetchDiditImage(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new DiditError("outage", undefined, "media_url");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    !allowedMediaHost(parsed.hostname)
  )
    throw new DiditError("outage", undefined, "media_host");
  let response: Response;
  try {
    response = await fetch(parsed, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error" });
  } catch {
    throw new DiditError("outage", undefined, "media_fetch");
  }
  if (!response.ok || !response.body)
    throw new DiditError("outage", response.status, "media_fetch");
  if (Number(response.headers.get("content-length") ?? "0") > IMAGE_LIMIT) {
    await stopReading(response.body.cancel());
    throw new DiditError("outage", response.status, "media_size");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > IMAGE_LIMIT) {
      await stopReading(reader.cancel());
      throw new DiditError("outage", response.status, "media_size");
    }
    chunks.push(value);
  }
  if (size === 0) throw new DiditError("outage", response.status, "media_size");
  return Buffer.concat(chunks);
}
