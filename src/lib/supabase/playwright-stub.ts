import "server-only";

import crypto from "node:crypto";
import { fulfillPlaywrightPayment } from "./playwright-payment-fulfillment";
import type { AuthChangeEvent, Session, SupabaseClient } from "@supabase/supabase-js";
import {
  createPlaywrightSession,
  createPlaywrightTableRow,
  ensurePlaywrightVerifiedMember,
  listPlaywrightUsers,
  listPlaywrightTableRows,
  resolvePlaywrightSession,
  writePlaywrightTableRows,
} from "@/lib/supabase/playwright-fixture-store";
import { isPlaywrightSupabaseStubMode as _isPlaywrightSupabaseStubMode } from "@/lib/supabase/playwright-mode";

type QueryResult<TData> = {
  data: TData;
  error: null | { message: string; code?: string };
  count?: number | null;
};

type StubAuthUser = Awaited<ReturnType<typeof resolvePlaywrightSession>>;

type CookieStoreAdapter = {
  get: (name: string) => string | undefined;
  set: (name: string, value: string) => void;
  remove: (name: string) => void;
};

type StubClientOptions = {
  cookies?: CookieStoreAdapter;
  sessionToken?: string | null;
};

type Filter =
  | { kind: "eq" | "neq" | "gt" | "gte" | "lt" | "lte"; column: string; value: unknown }
  | { kind: "in"; column: string; value: unknown[] }
  | { kind: "is"; column: string; value: unknown }
  | { kind: "like" | "ilike"; column: string; value: string }
  | { kind: "not"; column: string; operator: string; value: string }
  | { kind: "or"; expression: string; column?: string; value?: unknown };

type SortOrder = {
  column: string;
  ascending: boolean;
  nullsFirst: boolean;
};

export const PLAYWRIGHT_SESSION_COOKIE = "vmz_pw_session";

function createAuthError(message: string, status: number, code?: string) {
  return {
    message,
    status,
    code,
    name: "AuthApiError",
  };
}

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

function getColumnValue(row: Record<string, unknown>, column: string): unknown {
  return row[column];
}

function normalizeComparableValue(value: unknown): unknown {
  if (typeof value === "string") {
    const parsedDate = Date.parse(value);
    if (!Number.isNaN(parsedDate) && value.includes("T")) {
      return parsedDate;
    }
  }

  return value;
}

function matchesLike(value: unknown, pattern: string, caseInsensitive: boolean) {
  if (typeof value !== "string") {
    return false;
  }

  const needle = pattern.replace(/%/g, "");
  if (!needle) {
    return true;
  }

  return caseInsensitive
    ? value.toLowerCase().includes(needle.toLowerCase())
    : value.includes(needle);
}

function evaluateExpression(row: Record<string, unknown>, expression: string): boolean {
  if (expression.startsWith("and(") && expression.endsWith(")")) {
    const inner = expression.slice(4, -1);
    return splitTopLevel(inner).every((part) => evaluateExpression(row, part));
  }

  const segments = expression.split(".");
  if (segments.length < 3) {
    return true;
  }

  const [column, operator, ...rest] = segments;
  const rawValue = rest.join(".");
  const value = getColumnValue(row, column);

  switch (operator) {
    case "eq":
      return String(value ?? "") === rawValue;
    case "neq":
      return String(value ?? "") !== rawValue;
    case "ilike":
      return matchesLike(value, rawValue, true);
    case "like":
      return matchesLike(value, rawValue, false);
    case "gte":
      return Number(normalizeComparableValue(value)) >= Number(normalizeComparableValue(rawValue));
    case "lte":
      return Number(normalizeComparableValue(value)) <= Number(normalizeComparableValue(rawValue));
    case "gt":
      return Number(normalizeComparableValue(value)) > Number(normalizeComparableValue(rawValue));
    case "lt":
      return Number(normalizeComparableValue(value)) < Number(normalizeComparableValue(rawValue));
    case "is":
      return rawValue === "null" ? value == null : value === rawValue;
    default:
      return true;
  }
}

function splitTopLevel(expression: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;

  for (const char of expression) {
    if (char === "," && depth === 0) {
      if (current.trim()) {
        parts.push(current.trim());
      }
      current = "";
      continue;
    }

    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    current += char;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

function applyFilters(rows: Array<Record<string, unknown>>, filters: Filter[]) {
  return rows.filter((row) =>
    filters.every((filter) => {
      switch (filter.kind) {
        case "eq":
          return getColumnValue(row, filter.column) === filter.value;
        case "neq":
          return getColumnValue(row, filter.column) !== filter.value;
        case "gt":
          return (
            Number(normalizeComparableValue(getColumnValue(row, filter.column))) >
            Number(normalizeComparableValue(filter.value))
          );
        case "gte":
          return (
            Number(normalizeComparableValue(getColumnValue(row, filter.column))) >=
            Number(normalizeComparableValue(filter.value))
          );
        case "lt":
          return (
            Number(normalizeComparableValue(getColumnValue(row, filter.column))) <
            Number(normalizeComparableValue(filter.value))
          );
        case "lte":
          return (
            Number(normalizeComparableValue(getColumnValue(row, filter.column))) <=
            Number(normalizeComparableValue(filter.value))
          );
        case "in":
          return filter.value.includes(getColumnValue(row, filter.column));
        case "is":
          return filter.value === null
            ? getColumnValue(row, filter.column) == null
            : getColumnValue(row, filter.column) === filter.value;
        case "like":
          return matchesLike(getColumnValue(row, filter.column), filter.value, false);
        case "ilike":
          return matchesLike(getColumnValue(row, filter.column), filter.value, true);
        case "not":
          if (filter.operator === "ilike") {
            return !matchesLike(getColumnValue(row, filter.column), filter.value, true);
          }
          if (filter.operator === "like") {
            return !matchesLike(getColumnValue(row, filter.column), filter.value, false);
          }
          return true;
        case "or":
          return splitTopLevel(filter.expression).some((part) => evaluateExpression(row, part));
        default:
          return true;
      }
    })
  );
}

const FRESH_POST_MS = 72 * 60 * 60 * 1000;

/** Computed fields the real database provides (see 20261002135904). */
function sortValue(row: Record<string, unknown>, column: string): unknown {
  if (column !== "fair_rotation_key") return row[column];
  const liveAt = Date.parse(String(row.published_at ?? row.created_at ?? ""));
  if (!Number.isFinite(liveAt)) return "1";
  const fresh = Date.now() - liveAt < FRESH_POST_MS ? "0" : "1";
  // Newest first inside each group keeps fixture order predictable.
  return `${fresh}${String(9_999_999_999_999 - liveAt).padStart(13, "0")}`;
}

function applyOrdering(rows: Array<Record<string, unknown>>, orders: SortOrder[]) {
  if (orders.length === 0) {
    return rows;
  }

  return [...rows].sort((left, right) => {
    for (const order of orders) {
      const leftValue = sortValue(left, order.column);
      const rightValue = sortValue(right, order.column);

      if (leftValue == null && rightValue == null) continue;
      if (leftValue == null) return order.nullsFirst ? -1 : 1;
      if (rightValue == null) return order.nullsFirst ? 1 : -1;

      const normalizedLeft = normalizeComparableValue(leftValue) as string | number | boolean;
      const normalizedRight = normalizeComparableValue(rightValue) as string | number | boolean;

      if (normalizedLeft === normalizedRight) continue;
      if (normalizedLeft < normalizedRight) {
        return order.ascending ? -1 : 1;
      }
      return order.ascending ? 1 : -1;
    }

    return 0;
  });
}

class PlaywrightQueryBuilder<TData = unknown> implements PromiseLike<QueryResult<TData>> {
  private readonly filters: Filter[] = [];
  private readonly orders: SortOrder[] = [];
  private selectedColumns: string | undefined;
  private countRequested = false;
  private head = false;
  private limitCount: number | null = null;
  private rangeStart: number | null = null;
  private rangeEnd: number | null = null;
  private mutation: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private payload: Record<string, unknown>[] = [];
  private onConflict: string[] = [];

  constructor(private readonly table: string) {}

  select(columns = "*", options?: { count?: "exact"; head?: boolean }) {
    this.selectedColumns = columns;
    this.countRequested = options?.count === "exact";
    this.head = options?.head === true;
    return this;
  }

  insert(payload: Record<string, unknown> | Array<Record<string, unknown>>) {
    this.mutation = "insert";
    this.payload = Array.isArray(payload) ? payload : [payload];
    return this;
  }

  update(payload: Record<string, unknown>) {
    this.mutation = "update";
    this.payload = [payload];
    return this;
  }

  upsert(
    payload: Record<string, unknown> | Array<Record<string, unknown>>,
    options?: { onConflict?: string }
  ) {
    this.mutation = "upsert";
    this.payload = Array.isArray(payload) ? payload : [payload];
    this.onConflict = options?.onConflict?.split(",").map((item) => item.trim()) ?? [];
    return this;
  }

  delete() {
    this.mutation = "delete";
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ kind: "eq", column, value });
    return this;
  }

  neq(column: string, value: unknown) {
    this.filters.push({ kind: "neq", column, value });
    return this;
  }

  gt(column: string, value: unknown) {
    this.filters.push({ kind: "gt", column, value });
    return this;
  }

  gte(column: string, value: unknown) {
    this.filters.push({ kind: "gte", column, value });
    return this;
  }

  lt(column: string, value: unknown) {
    this.filters.push({ kind: "lt", column, value });
    return this;
  }

  lte(column: string, value: unknown) {
    this.filters.push({ kind: "lte", column, value });
    return this;
  }

  like(column: string, value: string) {
    this.filters.push({ kind: "like", column, value });
    return this;
  }

  ilike(column: string, value: string) {
    this.filters.push({ kind: "ilike", column, value });
    return this;
  }

  is(column: string, value: unknown) {
    this.filters.push({ kind: "is", column, value });
    return this;
  }

  in(column: string, value: unknown[]) {
    this.filters.push({ kind: "in", column, value });
    return this;
  }

  not(column: string, operator: string, value: string) {
    this.filters.push({ kind: "not", column, operator, value });
    return this;
  }

  or(expression: string) {
    this.filters.push({ kind: "or", expression, column: "", value: "" });
    return this;
  }

  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) {
    this.orders.push({
      column,
      ascending: options?.ascending !== false,
      nullsFirst: options?.nullsFirst === true,
    });
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  range(from: number, to: number) {
    this.rangeStart = from;
    this.rangeEnd = to;
    return this;
  }

  maybeSingle() {
    return this.executeSingle(true);
  }

  single() {
    return this.executeSingle(false);
  }

  contains() {
    return this;
  }

  overlaps() {
    return this;
  }

  filter() {
    return this;
  }

  match() {
    return this;
  }

  private executeSelectRows() {
    let rows = applyFilters(
      listPlaywrightTableRows(this.table) as Array<Record<string, unknown>>,
      this.filters
    );
    const count = rows.length;
    rows = applyOrdering(rows, this.orders);

    if (this.rangeStart != null && this.rangeEnd != null) {
      rows = rows.slice(this.rangeStart, this.rangeEnd + 1);
    } else if (this.limitCount != null) {
      rows = rows.slice(0, this.limitCount);
    }

    return {
      rows,
      count,
    };
  }

  private executeMutation() {
    const existingRows = listPlaywrightTableRows(this.table) as Array<Record<string, unknown>>;
    const matchingRows = applyFilters(existingRows, this.filters);
    const matchingIds = new Set(matchingRows.map((row) => row.id));
    let nextRows = [...existingRows];
    let resultRows: Array<Record<string, unknown>> = [];

    if (this.mutation === "insert") {
      resultRows = this.payload.map((row) => createPlaywrightTableRow(this.table, row));
      nextRows.push(...resultRows);
    }

    if (this.mutation === "update") {
      const patch = this.payload[0] ?? {};
      nextRows = existingRows.map((row) => {
        if (!matchingIds.has(row.id)) {
          return row;
        }

        const updatedRow = createPlaywrightTableRow(
          this.table,
          { ...row, ...patch },
          { preserveId: true }
        );
        resultRows.push(updatedRow);
        return updatedRow;
      });
    }

    if (this.mutation === "upsert") {
      const conflictColumns = this.onConflict.length > 0 ? this.onConflict : ["id"];

      for (const incoming of this.payload) {
        const existingIndex = nextRows.findIndex((row) =>
          conflictColumns.every((column) => row[column] === incoming[column])
        );

        if (existingIndex === -1) {
          const createdRow = createPlaywrightTableRow(this.table, incoming);
          nextRows.push(createdRow);
          resultRows.push(createdRow);
          continue;
        }

        const updatedRow = createPlaywrightTableRow(
          this.table,
          { ...nextRows[existingIndex], ...incoming },
          { preserveId: true }
        );
        nextRows[existingIndex] = updatedRow;
        resultRows.push(updatedRow);
      }
    }

    if (this.mutation === "delete") {
      resultRows = matchingRows;
      nextRows = existingRows.filter((row) => !matchingIds.has(row.id));
    }

    writePlaywrightTableRows(this.table, nextRows);
    return resultRows;
  }

  private async execute(): Promise<QueryResult<TData>> {
    if (this.mutation === "select") {
      const { rows, count } = this.executeSelectRows();
      return {
        data: (this.head ? null : cloneValue(rows)) as TData,
        error: null,
        count: this.countRequested ? count : null,
      };
    }

    const rows = this.executeMutation();
    const shouldReturnRows = this.selectedColumns !== undefined || this.head;

    return {
      data: (shouldReturnRows && !this.head ? cloneValue(rows) : null) as TData,
      error: null,
      count: null,
    };
  }

  private async executeSingle(maybeSingle: boolean): Promise<QueryResult<TData>> {
    const result = await this.execute();
    const rows = Array.isArray(result.data) ? result.data : [];
    const singleRow = rows[0] ?? null;

    if (!maybeSingle && !singleRow) {
      return {
        data: null as TData,
        error: { message: "No rows found", code: "PGRST116" },
        count: result.count ?? null,
      };
    }

    return {
      data: singleRow as TData,
      error: null,
      count: result.count ?? null,
    };
  }

  then<TResult1 = QueryResult<TData>, TResult2 = never>(
    onfulfilled?: ((value: QueryResult<TData>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

function resolveStubUser(
  cookieStore?: CookieStoreAdapter,
  sessionToken?: string | null
): StubAuthUser {
  const token = sessionToken ?? cookieStore?.get(PLAYWRIGHT_SESSION_COOKIE) ?? null;
  return resolvePlaywrightSession(token);
}

function createStubSession(token: string | null, user: StubAuthUser): Session | null {
  if (!token || !user) {
    return null;
  }

  return {
    access_token: token,
    refresh_token: token,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user,
  } as unknown as Session;
}

export function createPlaywrightStubSupabaseClient(
  options: StubClientOptions = {}
): SupabaseClient {
  const cookieStore = options.cookies;
  const authStateListeners = new Set<(event: AuthChangeEvent, session: Session | null) => void>();

  function emitAuthState(event: AuthChangeEvent, session: Session | null) {
    for (const listener of authStateListeners) {
      listener(event, session);
    }
  }

  return {
    auth: {
      async getUser() {
        return { data: { user: resolveStubUser(cookieStore, options.sessionToken) }, error: null };
      },
      async getSession() {
        const user = resolveStubUser(cookieStore, options.sessionToken);
        const token = cookieStore?.get(PLAYWRIGHT_SESSION_COOKIE) ?? options.sessionToken ?? null;
        return {
          data: {
            session: createStubSession(token, user),
          },
          error: null,
        };
      },
      async signInWithPassword(credentials: { email: string; password: string }) {
        const persona = credentials.email.split("@")[0] || "member";
        const user = ensurePlaywrightVerifiedMember(persona);

        if (user.email !== credentials.email || user.password !== credentials.password) {
          return {
            data: { user: null, session: null },
            error: createAuthError("Invalid login credentials", 400, "invalid_credentials"),
          };
        }

        const { token } = createPlaywrightSession(persona);
        cookieStore?.set(PLAYWRIGHT_SESSION_COOKIE, token);
        const session = createStubSession(token, user);
        emitAuthState("SIGNED_IN", session);
        return {
          data: { user, session },
          error: null,
        };
      },
      async signUp(credentials: { email: string; password?: string }) {
        const persona = credentials.email.split("@")[0] || "member";
        const user = ensurePlaywrightVerifiedMember(persona);
        return {
          data: { user, session: null },
          error: null,
        };
      },
      async signInWithOAuth(credentials: {
        provider: string;
        options?: { redirectTo?: string | undefined };
      }) {
        const fallbackOrigin = "http://127.0.0.1:3100";
        let origin = fallbackOrigin;

        if (typeof credentials.options?.redirectTo === "string") {
          try {
            origin = new URL(credentials.options.redirectTo).origin;
          } catch {
            origin = fallbackOrigin;
          }
        }

        return {
          data: {
            provider: credentials.provider,
            url: `${origin}/login#oauth-ok`,
          },
          error: null,
        };
      },
      async resetPasswordForEmail() {
        return { data: {}, error: null };
      },
      async exchangeCodeForSession() {
        return {
          data: { session: null, user: null },
          error: createAuthError("Playwright stub does not issue callback sessions", 400),
        };
      },
      async updateUser() {
        return { data: { user: resolveStubUser(cookieStore, options.sessionToken) }, error: null };
      },
      async signOut() {
        cookieStore?.remove(PLAYWRIGHT_SESSION_COOKIE);
        emitAuthState("SIGNED_OUT", null);
        return { error: null };
      },
      onAuthStateChange(callback: (event: AuthChangeEvent, session: Session | null) => void) {
        authStateListeners.add(callback);

        return {
          data: {
            subscription: {
              unsubscribe() {
                authStateListeners.delete(callback);
              },
            },
          },
        };
      },
      admin: {
        async listUsers(params?: { page?: number; perPage?: number }) {
          const page = Math.max(1, Number(params?.page ?? 1));
          const perPage = Math.max(1, Number(params?.perPage ?? 50));
          const users = listPlaywrightUsers();
          const from = (page - 1) * perPage;

          return {
            data: {
              users: users.slice(from, from + perPage),
              aud: "authenticated",
            },
            error: null,
          };
        },
        async deleteUser(userId: string) {
          const tables = [
            "account_profiles",
            "listings",
            "businesses",
            "promotions",
            "free_posts_used",
            "entitlements",
          ];

          for (const table of tables) {
            const rows = listPlaywrightTableRows(table).filter(
              (row) => row.user_id !== userId && row.owner_id !== userId && row.seller_id !== userId
            );
            writePlaywrightTableRows(table, rows);
          }

          return { data: { user: null }, error: null };
        },
      },
    },
    from(table: string) {
      return new PlaywrightQueryBuilder(table);
    },
    async rpc(fn: string, params?: Record<string, unknown>) {
      if (fn === "media_storage_used") {
        const used = listPlaywrightTableRows("media_uploads")
          .filter((row) => row.user_id === params?.p_user)
          .reduce((total, row) => total + Number(row.file_size ?? 0), 0);
        return { data: used, error: null };
      }
      if (fn === "apply_kyc_provider_webhook") {
        const result = listPlaywrightTableRows("kyc_provider_results").find(
          (row) => row.provider_ref === params?.p_provider_ref
        );
        if (!result) return { data: { outcome: "unknown" }, error: null };
        // Known callbacks need the transactional SQL implementation. Fail closed
        // rather than reporting success without updating evidence, risk and audit.
        return {
          data: null,
          error: { message: "Known KYC callbacks require the database integration suite" },
        };
      }
      if (fn === "fulfill_ozow_payment" || fn === "confirm_ozow_payment")
        return fulfillPlaywrightPayment(params, fn === "confirm_ozow_payment");
      if (fn === "increment_otp_attempt") {
        // Mirrors public.increment_otp_attempt: count every attempt on an
        // unverified challenge and lock it once max_attempts is reached.
        const rows = listPlaywrightTableRows("otp_challenges");
        const challenge = rows.find(
          (row) => row.id === params?.challenge_id && row.verified_at == null
        );
        if (!challenge) {
          return { data: [{ new_attempt_count: null, new_locked_until: null }], error: null };
        }
        const attemptCount = Number(challenge.attempt_count ?? 0) + 1;
        challenge.attempt_count = attemptCount;
        if (attemptCount >= Number(params?.max_attempts ?? 5)) {
          challenge.locked_until = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        }
        writePlaywrightTableRows("otp_challenges", rows);
        return {
          data: [
            {
              new_attempt_count: attemptCount,
              new_locked_until: (challenge.locked_until as string | null | undefined) ?? null,
            },
          ],
          error: null,
        };
      }
      if (fn === "reserve_intro_trial") {
        // E2E personas are always verified members, so the identity gate from
        // intro_trial_identity() is treated as satisfied. Mirror the claim
        // ledger so trial-aware screens keep working.
        const userId = String(params?.p_user_id ?? "");
        const area = String(params?.p_area ?? "");
        const contentId = String(params?.p_content_id ?? "");
        const durationDays = Number(params?.p_duration_days ?? 7);
        const rows = listPlaywrightTableRows("intro_trial_claims");
        const existingRow = rows.find(
          (row) => row.user_id === userId && row.content_id === contentId && row.released_at == null
        );
        if (existingRow) {
          return { data: true, error: null };
        }
        rows.push({
          id: crypto.randomUUID(),
          user_id: userId,
          area,
          content_id: contentId,
          content_table: null,
          duration_days: durationDays,
          admin_granted: false,
          created_at: new Date().toISOString(),
          activated_at: null,
          expires_at: null,
          released_at: null,
          release_reason: null,
          converted_at: null,
        });
        writePlaywrightTableRows("intro_trial_claims", rows);
        return { data: true, error: null };
      }
      if (fn === "release_intro_trial") {
        const userId = String(params?.p_user_id ?? "");
        const contentId = String(params?.p_content_id ?? "");
        const reason = String(params?.p_reason ?? "released");
        const rows = listPlaywrightTableRows("intro_trial_claims");
        const row = rows.find(
          (entry) =>
            entry.user_id === userId && entry.content_id === contentId && entry.released_at == null
        );
        if (!row) {
          return { data: false, error: null };
        }
        row.released_at = new Date().toISOString();
        row.release_reason = reason;
        writePlaywrightTableRows("intro_trial_claims", rows);
        return { data: true, error: null };
      }
      if (fn === "claim_free_post_slot") {
        const userId = String(params?.p_user_id ?? "");
        const area = String(params?.p_area ?? "");
        const contentId = String(params?.p_content_id ?? "");
        const maxAllowed = Number(params?.p_max_allowed ?? 0);
        const rows = listPlaywrightTableRows("free_posts_used");
        const activeRows = rows.filter(
          (row) => row.user_id === userId && row.area === area && row.released_at == null
        );

        const existingRow = activeRows.find((row) => row.content_id === contentId);
        if (existingRow) {
          return { data: true, error: null };
        }

        if (activeRows.length >= maxAllowed) {
          return { data: false, error: null };
        }

        rows.push({
          id: crypto.randomUUID(),
          user_id: userId,
          area,
          content_id: contentId,
          released_at: null,
          release_reason: null,
          created_at: new Date().toISOString(),
        });
        writePlaywrightTableRows("free_posts_used", rows);
        return { data: true, error: null };
      }

      if (fn === "get_business_category_counts") {
        const liveBusinesses = listPlaywrightTableRows("businesses").filter(
          (row) => row.status === "live" && typeof row.category === "string"
        );
        const counts = new Map<string, number>();

        for (const business of liveBusinesses) {
          const category = String(business.category);
          counts.set(category, (counts.get(category) ?? 0) + 1);
        }

        return {
          data: Array.from(counts.entries()).map(([category, count]) => ({ category, count })),
          error: null,
        };
      }

      if (
        fn === "insert_listing_with_limit" ||
        fn === "insert_promotion_with_limit" ||
        fn === "insert_business_with_limit"
      ) {
        const table =
          fn === "insert_listing_with_limit"
            ? "listings"
            : fn === "insert_promotion_with_limit"
              ? "promotions"
              : "businesses";
        const userId = String(params?.p_user_id ?? "");
        const area = String(params?.p_area ?? "");
        const maxAllowed = Number(params?.p_max_allowed ?? -1);
        const payload = { ...((params?.p_data ?? {}) as Record<string, unknown>) };
        const rows = listPlaywrightTableRows(table);

        if (maxAllowed >= 0) {
          const currentCount = rows.filter(
            (row) =>
              (row.owner_id === userId || row.seller_id === userId) &&
              (table === "promotions" || row.area === area) &&
              row.status !== "rejected"
          ).length;

          if (currentCount >= maxAllowed) {
            return { data: { limit_reached: true }, error: null };
          }
        }

        const now = new Date().toISOString();
        const newRow: Record<string, unknown> = {
          view_count: 0,
          ...(table === "promotions" ? { click_count: 0 } : {}),
          ...payload,
          owner_id: userId,
          created_at: payload.created_at ?? now,
          updated_at: payload.updated_at ?? now,
        };
        rows.push(newRow);
        writePlaywrightTableRows(table, rows);
        return { data: newRow, error: null };
      }

      return { data: null, error: null };
    },
  } as unknown as SupabaseClient;
}
