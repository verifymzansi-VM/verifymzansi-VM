/**
 * Remembers the last failed database command of one foundation API client, so
 * a route that answers "unavailable" can log which command failed and why.
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
  /** Orders failures across clients; never logged. */
  sequence: number;
};

let sequence = 0;

const COMMAND = /\/rest\/v1\/rpc\/([a-z][a-z0-9_]{0,62})(?:[/?#]|$)/;
const ERROR_CODE = /^[A-Za-z0-9_]{1,16}$/;
const ERROR_TYPE = /^[A-Za-z][A-Za-z0-9_.]{0,59}$/;
const MAX_ERROR_BODY_CHARS = 8192;

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

/** A short, stable error class name that is safe to log. */
export function errorTypeOf(error: unknown): string {
  const name =
    error instanceof Error
      ? error.name && error.name !== "Error"
        ? error.name
        : error.constructor?.name
      : error === null
        ? "null"
        : typeof error;
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

const REASON = /^[a-z][a-z0-9_:.-]{0,59}$/;

/** A stable reason such as "legal_name_required", or undefined. */
export function safeReason(value: unknown): string | undefined {
  return typeof value === "string" && REASON.test(value) && !LONG_NUMBER.test(value)
    ? value
    : undefined;
}

async function readErrorCode(response: Response): Promise<string | undefined> {
  try {
    const text = await response.clone().text();
    if (text.length > MAX_ERROR_BODY_CHARS) return undefined;
    const body = JSON.parse(text) as unknown;
    return body && typeof body === "object"
      ? safeErrorCode((body as Record<string, unknown>).code)
      : undefined;
  } catch {
    // Not a JSON error body; the status alone still identifies the failure.
    return undefined;
  }
}

const recorders = new WeakMap<object, () => FoundationCallFailure | null>();

/** Wraps a fetch so failed replies and lost requests are remembered. */
export function createFoundationCallRecorder(fetcher: typeof fetch) {
  let last: FoundationCallFailure | null = null;
  const recordingFetch: typeof fetch = async (input, init) => {
    const command = foundationCommandName(input);
    let response: Response;
    try {
      response = await fetcher(input, init);
    } catch (error) {
      last = { command, errorType: errorTypeOf(error), sequence: ++sequence };
      throw error;
    }
    if (!response.ok) {
      const errorCode = await readErrorCode(response);
      last = {
        command,
        status: response.status,
        ...(errorCode ? { errorCode } : {}),
        sequence: ++sequence,
      };
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

/** The most recent failed command of one or more foundation API clients. */
export function lastFoundationFailure(apis: unknown): FoundationCallFailure | null {
  let latest: FoundationCallFailure | null = null;
  for (const api of Array.isArray(apis) ? apis : [apis]) {
    if (!api || (typeof api !== "object" && typeof api !== "function")) continue;
    const failure = recorders.get(api)?.() ?? null;
    if (failure && (!latest || failure.sequence > latest.sequence)) latest = failure;
  }
  return latest;
}
