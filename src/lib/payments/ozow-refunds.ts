import "server-only";

import { z } from "zod";
import { createLogger } from "@/lib/utils/logger";
import { fetchWithoutRedirects } from "@/lib/utils/fetch-without-redirects";
import {
  getOzowAccessToken,
  getOzowBaseUrlContext,
  isMockOzowEnabled,
  type OzowClientCredentials,
} from "./ozow";

/**
 * Ozow refunds through One API (hub.ozow.com, "Refund a payment"):
 * POST /v1/transactions/{id}/refunds, GET /v1/refunds/{id} and GET /v1/refunds
 * by date. Tokens need the "refunds" scope; this module uses its own Ozow API
 * key (OZOW_REFUND_CLIENT_ID / OZOW_REFUND_CLIENT_SECRET, Worker secrets), so
 * the payment key never holds refund rights.
 *
 * Nothing here decides whether a refund may be made: the database approves it
 * (src/lib/foundation/ozow-refunds.ts) and hands the sender one Idempotency-Key
 * per refund record, reused on every retry so Ozow never makes a second
 * refund for the same record. Mock Ozow never contacts Ozow and refuses here.
 */

const log = createLogger("OzowRefunds");

/** The switch: only the exact value "true" turns API refunds on. */
export const OZOW_API_REFUNDS_SWITCH = "OZOW_API_REFUNDS_ENABLED";
const REFUND_SCOPE = "refunds";
const REQUEST_TIMEOUT_MS = 15_000;
/** Ozow lists at most 50 refunds a page; the daily check reads 40 pages at most. */
const LIST_PAGE_LIMIT = 40;

type Environment = Record<string, string | undefined>;

function refundCredentials(environment: Environment): OzowClientCredentials {
  return {
    clientId: environment.OZOW_REFUND_CLIENT_ID?.trim() || undefined,
    clientSecret: environment.OZOW_REFUND_CLIENT_SECRET?.trim() || undefined,
    names: ["OZOW_REFUND_CLIENT_ID", "OZOW_REFUND_CLIENT_SECRET"],
  };
}

/**
 * Whether staff refunds go to Ozow through the API. Off unless the switch is
 * exactly "true" AND the refund key is set; never with mock Ozow. While off,
 * staff record refunds as before (Ozow's reference), and no refund request,
 * notice or check reaches Ozow.
 */
export function ozowApiRefundsEnabled(environment: Environment = process.env): boolean {
  const credentials = refundCredentials(environment);
  return (
    environment[OZOW_API_REFUNDS_SWITCH] === "true" &&
    Boolean(credentials.clientId && credentials.clientSecret) &&
    !isMockOzowEnabled()
  );
}

/** The refund webhook's own signing secret (Svix, "whsec_..."), or null. */
export function ozowRefundWebhookSecret(environment: Environment = process.env): string | null {
  const secret = environment.OZOW_REFUND_WEBHOOK_SECRET?.trim();
  return secret ? secret : null;
}

/** Ozow's refund statuses, as text (the API and full notices) or as numbers. */
export const OZOW_REFUND_STATUSES = [
  "Pending",
  "Submitted",
  "Complete",
  "Failed",
  "Cancelled",
  "Returned",
  "Invalid",
  "PendingInvestigation",
  "Error",
] as const;
export type OzowRefundStatus = (typeof OZOW_REFUND_STATUSES)[number];
const NUMBERED: Record<string, OzowRefundStatus> = {
  "0": "Pending",
  "1": "Complete",
  "2": "Submitted",
  "3": "Failed",
  "4": "Cancelled",
  "5": "Returned",
  "-1": "Invalid",
  "-2": "PendingInvestigation",
  "-3": "Error",
};
const BY_NAME = new Map(OZOW_REFUND_STATUSES.map((status) => [status.toLowerCase(), status]));

/** Ozow's status in any of its forms, or null when it is not one of them. */
export function readOzowRefundStatus(value: unknown): OzowRefundStatus | null {
  if (typeof value === "number" && Number.isInteger(value)) return NUMBERED[String(value)] ?? null;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (/^-?[0-9]$/.test(text)) return NUMBERED[text] ?? null;
  return BY_NAME.get(text.toLowerCase()) ?? null;
}

/** One Ozow refund as this site stores it. */
export type OzowRefundFact = {
  refundId: string;
  transactionId: string;
  amountCents: number;
  status: OzowRefundStatus;
  requestedAt: string | null;
  completedAt: string | null;
};

const uuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  .transform((value) => value.toLowerCase());
const instant = z
  .string()
  .refine((value) => Number.isFinite(Date.parse(value)))
  .transform((value) => new Date(value).toISOString());

/** Rands to cents, only when the value is a whole number of cents. */
export function randsToCents(value: unknown): number | null {
  const rands = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof rands !== "number" || !Number.isFinite(rands) || rands <= 0) return null;
  const cents = Math.round(rands * 100);
  return Math.abs(cents - rands * 100) < 1e-6 && Number.isSafeInteger(cents) ? cents : null;
}

/** An Ozow Refund resource (or list item), checked; null when unusable. */
export function readOzowRefund(raw: unknown): OzowRefundFact | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const amount =
    record.amount && typeof record.amount === "object" && !Array.isArray(record.amount)
      ? (record.amount as Record<string, unknown>)
      : null;
  const refundId = uuid.safeParse(record.id);
  const transactionId = uuid.safeParse(record.transactionId);
  const status = readOzowRefundStatus(record.status);
  const amountCents = randsToCents(amount?.value);
  const currency = amount?.currency;
  const requested = record.requested == null ? null : instant.safeParse(record.requested);
  const completed = record.completed == null ? null : instant.safeParse(record.completed);
  if (
    !refundId.success ||
    !transactionId.success ||
    !status ||
    amountCents === null ||
    (currency !== undefined && currency !== "ZAR") ||
    (requested && !requested.success) ||
    (completed && !completed.success)
  )
    return null;
  return {
    refundId: refundId.data,
    transactionId: transactionId.data,
    amountCents,
    status,
    requestedAt: requested?.success ? requested.data : null,
    completedAt: completed?.success ? completed.data : null,
  };
}

/** Drops an unread error body; the status alone decides what happens. */
async function drain(response: Response) {
  await response.body?.cancel().catch(() => {
    // Only drains the unread body; the status above decides the result.
  });
}

export class OzowRefundUnavailableError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null
  ) {
    super(message);
    this.name = "OzowRefundUnavailableError";
  }
}

/** Ozow answered 404 for a refund id: it has no such refund. */
export class OzowRefundNotFoundError extends Error {
  constructor() {
    super("Ozow has no such refund");
    this.name = "OzowRefundNotFoundError";
  }
}

export type OzowRefundClient = {
  /** Gets a refunds token before anything is claimed: a missing or refused
   * refund key stops the send before the record is marked sent. */
  prepare: () => Promise<void>;
  create: (input: OzowRefundSend) => Promise<OzowRefundSendResult>;
  /** One refund; OzowRefundNotFoundError when Ozow has no such refund. */
  get: (refundId: string) => Promise<OzowRefundFact>;
  /** The refunds raised against one transaction. */
  transactionRefunds: (transactionId: string) => Promise<OzowRefundFact[]>;
  /** Refunds requested in a period; entries it cannot read are counted. */
  list: (from: Date, to: Date) => Promise<{ facts: OzowRefundFact[]; unreadable: number }>;
};

export type OzowRefundSend = {
  transactionId: string;
  amountCents: number;
  /** Fixed words with a reason code; never staff notes or member details. */
  reason: string;
  idempotencyKey: string;
};

export type OzowRefundSendResult =
  | { outcome: "accepted"; fact: OzowRefundFact }
  | { outcome: "refused"; failureReason: "ozow_refused" | "ozow_auth"; status: number }
  | { outcome: "unknown"; status: number | null };

type Fetcher = typeof fetch;

/**
 * The One API refund client. `fetcher` and `environment` exist for tests,
 * which pass fakes: nothing in the test suite reaches Ozow.
 */
export function createOzowRefundClient({
  environment = process.env,
  fetcher = globalThis.fetch,
}: {
  environment?: Environment;
  fetcher?: Fetcher;
} = {}): OzowRefundClient {
  const credentials = refundCredentials(environment);
  const ready = () => {
    if (isMockOzowEnabled())
      throw new OzowRefundUnavailableError("Ozow refunds are disabled while mock Ozow is enabled");
    if (!credentials.clientId || !credentials.clientSecret)
      throw new OzowRefundUnavailableError("The Ozow refund key is not configured");
    return getOzowBaseUrlContext();
  };
  const token = (force: boolean) => getOzowAccessToken(REFUND_SCOPE, force, credentials);

  /** One request with a fresh token after a 401; never follows a redirect. */
  async function send(
    url: URL,
    init: { method: "GET" | "POST"; body?: string; idempotencyKey?: string }
  ): Promise<Response> {
    const once = async (force: boolean) =>
      fetchWithoutRedirects(
        url,
        {
          method: init.method,
          headers: {
            Authorization: `Bearer ${await token(force)}`,
            Accept: "application/json",
            ...(init.body ? { "Content-Type": "application/json" } : {}),
            ...(init.idempotencyKey ? { "Idempotency-Key": init.idempotencyKey } : {}),
          },
          body: init.body,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
        fetcher
      );
    const response = await once(false);
    // An expired cached token: Ozow did nothing, so the same request (same
    // Idempotency-Key) is sent once more with a new token.
    return response.status === 401 ? once(true) : response;
  }

  function apiUrl(base: string, path: string) {
    const url = new URL(path, base);
    if (url.origin !== new URL(base).origin || !url.pathname.startsWith("/v1/"))
      throw new OzowRefundUnavailableError("Invalid Ozow refund link");
    return url;
  }

  return {
    async prepare() {
      ready();
      try {
        await token(false);
      } catch {
        throw new OzowRefundUnavailableError("No Ozow refunds token");
      }
    },

    async create(input) {
      const { baseUrl } = ready();
      if (!uuid.safeParse(input.transactionId).success || !Number.isSafeInteger(input.amountCents))
        throw new OzowRefundUnavailableError("Invalid refund request");
      const url = apiUrl(
        baseUrl,
        `/v1/transactions/${encodeURIComponent(input.transactionId)}/refunds`
      );
      const body = JSON.stringify({
        amount: { currency: "ZAR", value: input.amountCents / 100 },
        reason: input.reason,
        realTimePayment: false,
      });
      // One POST per claim. A lost answer, a conflict (409: the same key still
      // being handled), 429 or a server error leaves the outcome unknown; the
      // database then decides whether the record is sent again with the same
      // Idempotency-Key, so a refusal is only ever the answer to a request
      // that is the first one Ozow saw for this key.
      let response: Response;
      try {
        response = await send(url, {
          method: "POST",
          body,
          idempotencyKey: input.idempotencyKey,
        });
      } catch {
        return { outcome: "unknown", status: null };
      }
      if (response.ok) {
        const fact = readOzowRefund(await response.json().catch(() => null));
        if (
          fact &&
          fact.transactionId === input.transactionId.toLowerCase() &&
          fact.amountCents === input.amountCents
        )
          return { outcome: "accepted", fact };
        // Ozow answered yes with something this site cannot match: it may
        // have made a refund, so the outcome stays unknown.
        log.error("Ozow refund answer could not be read", { status: response.status });
        return { outcome: "unknown", status: response.status };
      }
      await drain(response);
      if (response.status === 401 || response.status === 403)
        return { outcome: "refused", failureReason: "ozow_auth", status: response.status };
      if ([400, 404, 405, 415, 422].includes(response.status))
        return { outcome: "refused", failureReason: "ozow_refused", status: response.status };
      return { outcome: "unknown", status: response.status };
    },

    async transactionRefunds(transactionId) {
      const { baseUrl } = ready();
      const tx = uuid.safeParse(transactionId);
      if (!tx.success) throw new OzowRefundUnavailableError("Invalid Ozow transaction id");
      let response: Response;
      try {
        response = await send(
          apiUrl(baseUrl, `/v1/transactions/${encodeURIComponent(tx.data)}/refunds`),
          { method: "GET" }
        );
      } catch {
        throw new OzowRefundUnavailableError("Ozow refund lookup failed");
      }
      if (!response.ok) {
        await drain(response);
        throw new OzowRefundUnavailableError("Ozow refund lookup failed", response.status);
      }
      const data: unknown = await response.json().catch(() => null);
      const items = Array.isArray(data)
        ? data
        : data && typeof data === "object" && Array.isArray((data as { results?: unknown }).results)
          ? (data as { results: unknown[] }).results
          : null;
      if (!items || items.length > 200)
        throw new OzowRefundUnavailableError("Invalid Ozow refund list");
      const facts = items.map(readOzowRefund);
      if (facts.some((fact) => !fact || fact.transactionId !== tx.data))
        throw new OzowRefundUnavailableError("Invalid Ozow refund list item");
      return facts as OzowRefundFact[];
    },

    async get(refundId) {
      const { baseUrl } = ready();
      const id = uuid.safeParse(refundId);
      if (!id.success) throw new OzowRefundUnavailableError("Invalid Ozow refund id");
      let response: Response;
      try {
        response = await send(apiUrl(baseUrl, `/v1/refunds/${encodeURIComponent(id.data)}`), {
          method: "GET",
        });
      } catch {
        throw new OzowRefundUnavailableError("Ozow refund lookup failed");
      }
      if (response.status === 404) {
        await drain(response);
        throw new OzowRefundNotFoundError();
      }
      if (!response.ok) {
        await drain(response);
        throw new OzowRefundUnavailableError("Ozow refund lookup failed", response.status);
      }
      const fact = readOzowRefund(await response.json().catch(() => null));
      if (!fact || fact.refundId !== id.data)
        throw new OzowRefundUnavailableError("Ozow returned an invalid refund");
      return fact;
    },

    async list(from, to) {
      const { baseUrl } = ready();
      const query = new URLSearchParams({
        fromDate: from.toISOString(),
        toDate: to.toISOString(),
        limit: "50",
        offset: "0",
      });
      const siteCode = environment.OZOW_SITE_CODE?.trim();
      if (siteCode) query.set("siteCode", siteCode);
      let url: URL | null = apiUrl(baseUrl, `/v1/refunds?${query}`);
      const facts: OzowRefundFact[] = [];
      let unreadable = 0;
      for (let page = 0; url && page < LIST_PAGE_LIMIT; page++) {
        let response: Response;
        try {
          response = await send(url, { method: "GET" });
        } catch {
          throw new OzowRefundUnavailableError("Ozow refund list failed");
        }
        if (!response.ok) {
          await drain(response);
          throw new OzowRefundUnavailableError("Ozow refund list failed", response.status);
        }
        const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
        if (!data || !Array.isArray(data.results))
          throw new OzowRefundUnavailableError("Invalid Ozow refund list");
        for (const item of data.results) {
          // One entry this site cannot read (a new status, another currency)
          // must not stop the check of the others: it is counted and logged.
          const fact = readOzowRefund(item);
          if (fact) facts.push(fact);
          else unreadable++;
        }
        const links =
          data.links && typeof data.links === "object"
            ? (data.links as Record<string, unknown>)
            : null;
        const next = typeof links?.next === "string" && links.next ? links.next : null;
        // Follow Ozow's own next link, only on Ozow's API origin; stop on an
        // empty page so a repeating link cannot loop.
        url = next && data.results.length > 0 ? apiUrl(baseUrl, next) : null;
      }
      if (url)
        throw new OzowRefundUnavailableError("Ozow refund list is longer than one check reads");
      return { facts, unreadable };
    },
  };
}
