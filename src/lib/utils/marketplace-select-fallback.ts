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
  runQuery: (selectClause: string) => Promise<QueryResult<TData>>;
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

  if (code !== "42703" && code !== "PGRST204" && code !== "PGRST200") {
    return false;
  }

  return (
    retryableFields.some((field) => message.includes(field.toLowerCase())) ||
    code === "42703" ||
    code === "PGRST204" ||
    code === "PGRST200"
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
