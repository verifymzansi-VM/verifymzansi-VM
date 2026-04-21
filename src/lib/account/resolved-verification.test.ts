import { describe, expect, it } from "vitest";
import { resolveAccountVerification } from "./resolved-verification";

type MockQueryResult = {
  data: unknown;
  error: null;
};

function createQueryBuilder(execute: (filters: Record<string, unknown>) => MockQueryResult) {
  const filters: Record<string, unknown> = {};

  const builder = {
    select() {
      return builder;
    },
    eq(column: string, value: unknown) {
      filters[column] = value;
      return builder;
    },
    in(column: string, values: unknown[]) {
      filters[column] = { in: values };
      return Promise.resolve(execute(filters));
    },
    maybeSingle() {
      const result = execute(filters);
      const rows = Array.isArray(result.data) ? result.data : result.data ? [result.data] : [];
      return Promise.resolve({ data: rows[0] ?? null, error: result.error });
    },
    then<TResult1 = MockQueryResult, TResult2 = never>(
      onfulfilled?: ((value: MockQueryResult) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
    ) {
      return Promise.resolve(execute(filters)).then(onfulfilled, onrejected);
    },
  };

  return builder;
}

function createMockClient(params: {
  profile: Record<string, unknown> | null;
  steps: Array<Record<string, unknown>>;
  artifacts: Array<Record<string, unknown>>;
}) {
  return {
    from(table: string) {
      switch (table) {
        case "account_profiles":
          return createQueryBuilder(() => ({ data: params.profile, error: null }));
        case "verification_steps":
          return createQueryBuilder((filters) => ({
            data: params.steps.filter((row) => row.user_id === filters.user_id),
            error: null,
          }));
        case "kyc_artifacts":
          return createQueryBuilder((filters) => {
            const stepTypeFilter = filters.step_type as { in?: unknown[] } | undefined;
            const allowedStepTypes = Array.isArray(stepTypeFilter?.in) ? stepTypeFilter.in : null;

            return {
              data: params.artifacts.filter((row) => {
                if (row.user_id !== filters.user_id) {
                  return false;
                }
                if (filters.status && row.status !== filters.status) {
                  return false;
                }
                if (allowedStepTypes && !allowedStepTypes.includes(row.step_type)) {
                  return false;
                }
                return true;
              }),
              error: null,
            };
          });
        default:
          throw new Error(`Unexpected table ${table}`);
      }
    },
  };
}

describe("resolveAccountVerification", () => {
  it("recovers pending ID and selfie uploads from artifacts when step rows are missing", async () => {
    const client = createMockClient({
      profile: {
        id: "profile-1",
        account_verification_status: "incomplete",
      },
      steps: [
        {
          user_id: "user-1",
          step_type: "phone",
          status: "approved",
          submitted_at: "2026-04-21T10:00:00.000Z",
        },
      ],
      artifacts: [
        {
          user_id: "user-1",
          step_type: "id_doc",
          status: "pending",
          created_at: "2026-04-21T10:05:00.000Z",
        },
        {
          user_id: "user-1",
          step_type: "selfie",
          status: "pending",
          created_at: "2026-04-21T10:06:00.000Z",
        },
      ],
    });

    const result = await resolveAccountVerification(client as never, "user-1");

    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ step_type: "phone", status: "approved" }),
        expect.objectContaining({
          step_type: "id_doc",
          status: "pending",
          submitted_at: "2026-04-21T10:05:00.000Z",
        }),
        expect.objectContaining({
          step_type: "selfie",
          status: "pending",
          submitted_at: "2026-04-21T10:06:00.000Z",
        }),
      ])
    );
    expect(result.submittedStepCount).toBe(3);
    expect(result.accountVerificationStatus).toBe("incomplete");
  });
});
