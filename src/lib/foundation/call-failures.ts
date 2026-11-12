/**
 * Remembers how the most recently completed database command of one foundation
 * API client ended, so a route that answers "unavailable" can log which command
 * failed and why. A later successful command clears it: only a failure that is
 * still the latest outcome is attributed, never an older one.
 *
 * Only the command name (an `api.*` function), the HTTP status and the database
 * error code (for example `42501`, `PT409` or `PGRST202`) are kept. Messages,
 * details, hints, arguments and replies are never read into this record: they
 * can carry personal data.
 */

type FoundationCallFailure = {
  /** The `api.*` function name, or "auth" / "other" for non-command requests. */
  command: string;
  status?: number;
  errorCode?: string;
  /** Set when no reply arrived, for example "TimeoutError". */
  errorType?: string;
};

/** The latest completed call of one client: a failure, or null for a success. */
type CallOutcome = { sequence: number; failure: FoundationCallFailure | null };

let sequence = 0;

const COMMAND = /\/rest\/v1\/rpc\/([a-z][a-z0-9_]{0,62})(?:[/?#]|$)/;
const ERROR_CODE = /^[A-Za-z0-9_]{1,16}$/;
const ERROR_TYPE = /^[A-Za-z][A-Za-z0-9_]{0,59}$/;
const MAX_ERROR_BODY_BYTES = 8192;

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function foundationCommandName(input: Parameters<typeof fetch>[0]): string {
  let path: string;
  try {
    path = new URL(requestUrl(input)).pathname;
  } catch {
    return "other";
  }
  const command = COMMAND.exec(path)?.[1];
  if (command) return command;
  return path.startsWith("/auth/") ? "auth" : "other";
}

/**
 * A short, stable error type that is safe to log: the error's own `name`.
 * Class names are minified in production builds, so every server error class
 * sets `override name = "<ClassName>"` (enforced by a test) and the constructor
 * name is never used.
 */
export function errorTypeOf(error: unknown): string {
  const name = error instanceof Error ? error.name : error === null ? "null" : typeof error;
  return name && ERROR_TYPE.test(name) ? name : "Error";
}

// Long digit runs could be a phone or ID number placed in an error by mistake.
const LONG_NUMBER = /\d{6,}/;

/** A database or service error code, or undefined when it does not look like one. */
export function safeErrorCode(value: unknown): string | undefined {
  return typeof value === "string" && ERROR_CODE.test(value) && !LONG_NUMBER.test(value)
    ? value
    : undefined;
}

// Enum-like reasons only, for example "legal_name_required".
const REASON = /^[a-z][a-z0-9_]{0,59}$/;

/** A stable reason such as "legal_name_required", or undefined. */
export function safeReason(value: unknown): string | undefined {
  return typeof value === "string" && REASON.test(value) && !LONG_NUMBER.test(value)
    ? value
    : undefined;
}

/** Reads at most MAX_ERROR_BODY_BYTES of a copy of the reply; larger bodies are skipped. */
async function readBoundedText(response: Response): Promise<string | undefined> {
  const reader = response.clone().body?.getReader();
  if (!reader) return undefined;
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_ERROR_BODY_BYTES) {
      // Not awaited: a cancelled copy settles only once the original is done too.
      void reader.cancel().catch(() => {
        // Only the copy is cancelled; the caller still reads the original reply.
      });
      return undefined;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function readErrorCode(response: Response): Promise<string | undefined> {
  try {
    const text = await readBoundedText(response);
    if (text === undefined) return undefined;
    const body = JSON.parse(text) as unknown;
    return body && typeof body === "object"
      ? safeErrorCode((body as Record<string, unknown>).code)
      : undefined;
  } catch {
    // Not a JSON error body; the status alone still identifies the failure.
    return undefined;
  }
}

const recorders = new WeakMap<object, () => CallOutcome | null>();

/** Wraps a fetch so the outcome of the latest completed call is remembered. */
export function createFoundationCallRecorder(fetcher: typeof fetch) {
  let last: CallOutcome | null = null;
  const settle = (failure: FoundationCallFailure | null) => {
    last = { sequence: ++sequence, failure };
  };
  const recordingFetch: typeof fetch = async (input, init) => {
    const command = foundationCommandName(input);
    let response: Response;
    try {
      response = await fetcher(input, init);
    } catch (error) {
      settle({ command, errorType: errorTypeOf(error) });
      throw error;
    }
    if (response.ok) settle(null);
    else {
      const errorCode = await readErrorCode(response);
      settle({ command, status: response.status, ...(errorCode ? { errorCode } : {}) });
    }
    return response;
  };
  return {
    fetch: recordingFetch,
    /** Links this recorder to the API object it serves. */
    attach<T extends object>(api: T): T {
      recorders.set(api, () => last);
      return api;
    },
  };
}

/**
 * The failed command of one or more foundation API clients, when the latest
 * completed call among them failed. A later success among them returns null.
 */
export function lastFoundationFailure(apis: unknown): FoundationCallFailure | null {
  let latest: CallOutcome | null = null;
  for (const api of Array.isArray(apis) ? apis : [apis]) {
    if (!api || (typeof api !== "object" && typeof api !== "function")) continue;
    const outcome = recorders.get(api)?.() ?? null;
    if (outcome && (!latest || outcome.sequence > latest.sequence)) latest = outcome;
  }
  return latest?.failure ?? null;
}
