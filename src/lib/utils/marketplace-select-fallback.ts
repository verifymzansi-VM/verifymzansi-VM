type QueryErrorLike = {
  code?: string | null;
  message?: string | null;
} | null;

type QueryResult<TData> = {
  data: TData[] | null;
  count: number | null;
  error: QueryErrorLike;
};

export interface SelectFallbackAttempt<TField extends string> {
  select: string;
  omittedFields?: readonly TField[];
}

interface QueryWithSelectFallbacksOptions<TData, TField extends string> {
  attempts: readonly SelectFallbackAttempt<TField>[];
  fallbackFields: readonly TField[];
  runQuery: (selectClause: string) => PromiseLike<QueryResult<TData>>;
}

function isRetryableMissingColumnError<TField extends string>(
  error: QueryErrorLike,
  retryableFields: readonly TField[]
): boolean {
  if (!error || retryableFields.length === 0) {
    return false;
  }

  const code = error.code ?? "";
  const message = (error.message ?? "").toLowerCase();

  // PostgREST / PostgreSQL error codes for missing or unrecognised columns
  const retryableCodes = new Set([
    "42703", // undefined_column (PostgreSQL)
    "PGRST204", // column not found
    "PGRST200", // could not resolve column
    "PGRST116", // unexpected result shape
    "PGRST202", // function / column ambiguity
  ]);

  if (!retryableCodes.has(code)) {
    return false;
  }

  return (
    retryableFields.some((field) => message.includes(field.toLowerCase())) ||
    retryableCodes.has(code)
  );
}

export async function queryWithSelectFallbacks<TData, TField extends string>({
  attempts,
  fallbackFields,
  runQuery,
}: QueryWithSelectFallbacksOptions<TData, TField>) {
  let selectedAttempt = attempts[0];
  let lastResult: QueryResult<TData> = {
    data: null,
    count: null,
    error: null,
  };

  for (const attempt of attempts) {
    selectedAttempt = attempt;
    const result = await runQuery(attempt.select);
    lastResult = result;

    if (!result.error) {
      return {
        ...result,
        attempt,
      };
    }

    const retryableFields = fallbackFields.filter(
      (field) => !(attempt.omittedFields ?? []).includes(field)
    );

    if (!isRetryableMissingColumnError(result.error, retryableFields)) {
      break;
    }
  }

  return {
    ...lastResult,
    attempt: selectedAttempt,
  };
}
