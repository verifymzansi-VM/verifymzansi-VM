type QueryResult<TData> = {
  data: TData;
  error: null;
  count?: number;
};

type StubAuthUser = {
  id: string;
  email?: string;
  is_anonymous?: boolean;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
  identities?: Array<{ id: string }>;
};

const LIST_RESULT: QueryResult<unknown[]> = {
  data: [],
  error: null,
  count: 0,
};

const SINGLE_RESULT: QueryResult<null> = {
  data: null,
  error: null,
};

function resolveStubUser(email?: string): StubAuthUser {
  return {
    id: "playwright-user",
    email,
    is_anonymous: false,
    app_metadata: { role: "seller" },
    user_metadata: {},
    identities: [{ id: "playwright-identity" }],
  };
}

function createAuthError(message: string, status: number, code?: string) {
  return {
    message,
    status,
    code,
    name: "AuthApiError",
  };
}

function createQueryBuilder() {
  const builder = {
    select() {
      return builder;
    },
    insert() {
      return builder;
    },
    update() {
      return builder;
    },
    upsert() {
      return builder;
    },
    delete() {
      return builder;
    },
    eq() {
      return builder;
    },
    neq() {
      return builder;
    },
    gt() {
      return builder;
    },
    gte() {
      return builder;
    },
    lt() {
      return builder;
    },
    lte() {
      return builder;
    },
    like() {
      return builder;
    },
    ilike() {
      return builder;
    },
    is() {
      return builder;
    },
    in() {
      return builder;
    },
    not() {
      return builder;
    },
    or() {
      return builder;
    },
    match() {
      return builder;
    },
    contains() {
      return builder;
    },
    overlaps() {
      return builder;
    },
    filter() {
      return builder;
    },
    order() {
      return builder;
    },
    limit() {
      return builder;
    },
    range() {
      return builder;
    },
    maybeSingle() {
      return Promise.resolve(SINGLE_RESULT);
    },
    single() {
      return Promise.resolve(SINGLE_RESULT);
    },
    then(
      onfulfilled?: (value: QueryResult<unknown[]>) => unknown,
      onrejected?: (reason: unknown) => unknown
    ) {
      return Promise.resolve(LIST_RESULT).then(onfulfilled, onrejected);
    },
  };

  return builder;
}

export function isPlaywrightSupabaseStubMode(): boolean {
  return process.env.PLAYWRIGHT_SUPABASE_MODE === "stub";
}

export function createPlaywrightStubSupabaseClient() {
  const expectedEmail = process.env.PLAYWRIGHT_AUTH_EMAIL?.trim().toLowerCase();
  const expectedPassword = process.env.PLAYWRIGHT_AUTH_PASSWORD;

  return {
    auth: {
      async getUser() {
        return { data: { user: null }, error: null };
      },
      async getSession() {
        return { data: { session: null }, error: null };
      },
      async signInWithPassword(credentials: { email: string; password: string }) {
        const email = credentials.email.trim().toLowerCase();

        if (!expectedEmail || !expectedPassword) {
          return {
            data: { user: null, session: null },
            error: createAuthError("Invalid login credentials", 400, "invalid_credentials"),
          };
        }

        if (email !== expectedEmail || credentials.password !== expectedPassword) {
          return {
            data: { user: null, session: null },
            error: createAuthError("Invalid login credentials", 400, "invalid_credentials"),
          };
        }

        return {
          data: { user: resolveStubUser(email), session: { access_token: "playwright-session" } },
          error: null,
        };
      },
      async signUp(credentials: { email: string }) {
        return {
          data: { user: resolveStubUser(credentials.email.trim().toLowerCase()), session: null },
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
        return { data: { user: null }, error: null };
      },
      async signOut() {
        return { error: null };
      },
    },
    from() {
      return createQueryBuilder();
    },
    rpc() {
      return Promise.resolve(SINGLE_RESULT);
    },
  };
}
