import {
  errorTypeOf,
  lastFoundationFailure,
  safeErrorCode,
  safeReason,
} from "@/lib/foundation/call-failures";
import { createLogger, type Logger } from "./logger";
import { requestReference } from "./request-reference";

/**
 * One log line per failed request: what kind of error, which database command,
 * which error code, and the request reference the visitor sees.
 *
 * Error messages, stacks, request bodies, query strings, headers and cookies are
 * never logged: they can carry email addresses, names, phone numbers, ID numbers
 * or tokens. Every logged value is a fixed name or matches a strict pattern.
 */

type RequestFailureDetails = {
  errorType: string;
  errorReason?: string;
  command?: string;
  errorCode?: string;
  httpStatus?: number;
  callErrorType?: string;
};

/** Safe facts about a failure; `api` is the foundation client (or clients) used. */
export function describeRequestFailure(error: unknown, api?: unknown): RequestFailureDetails {
  const call = lastFoundationFailure(api);
  const fields: Record<string, unknown> =
    error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  const errorReason = safeReason(fields.reason);
  const errorCode = call?.errorCode ?? safeErrorCode(fields.code);
  return {
    errorType: errorTypeOf(error),
    ...(errorReason ? { errorReason } : {}),
    ...(call ? { command: call.command } : {}),
    ...(errorCode ? { errorCode } : {}),
    ...(call?.status ? { httpStatus: call.status } : {}),
    ...(call?.errorType ? { callErrorType: call.errorType } : {}),
  };
}

const ACTION = /^[a-z][a-z0-9_:.-]{0,59}$/;

/**
 * Logs an unexpected request failure and returns the reference to show the
 * visitor. Use it wherever a route answers with a generic "unavailable" error.
 */
export function logRequestFailure(
  log: Logger,
  message: string,
  input: {
    request: { headers: Pick<Headers, "get"> };
    error?: unknown;
    /** The foundation API client(s) the route used, to name the failed command. */
    api?: unknown;
    /** The route's own action name, for example "profile:update". */
    action?: string;
  }
): string {
  const reference = requestReference(input.request.headers);
  log.error(message, {
    event: "request_failed",
    reference,
    ...(input.action && ACTION.test(input.action) ? { action: input.action } : {}),
    ...describeRequestFailure(input.error, input.api),
  });
  return reference;
}

const DIGEST = /^[A-Za-z0-9_-]{1,64}$/;
const ROUTE_PATH = /^\/[A-Za-z0-9_\-[\]()/.@]{0,119}$/;
const ROUTE_TYPES = new Set(["render", "route", "action", "proxy"]);
const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
const serverLog = createLogger("ServerError");

/**
 * Next.js `onRequestError` companion: one line per server error with the
 * digest shown on the error page, the request reference and the route file
 * (for example `/listing/[id]`), never the visited path or its query string.
 */
export function logServerRequestError(
  error: unknown,
  request: { method?: string; headers: Record<string, string | string[] | undefined> },
  context: { routePath?: string; routeType?: string }
): void {
  const digest =
    error && typeof error === "object" && "digest" in error
      ? String((error as { digest: unknown }).digest)
      : undefined;
  serverLog.error("Server request failed", {
    event: "request_failed",
    reference: requestReference(request.headers),
    ...(digest && DIGEST.test(digest) ? { digest } : {}),
    ...(request.method && METHODS.has(request.method) ? { method: request.method } : {}),
    ...(context.routePath && ROUTE_PATH.test(context.routePath)
      ? { routePath: context.routePath }
      : {}),
    ...(context.routeType && ROUTE_TYPES.has(context.routeType)
      ? { routeType: context.routeType }
      : {}),
    ...describeRequestFailure(error),
  });
}
