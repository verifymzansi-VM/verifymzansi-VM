type CountResult = { count: number | null; error: { message: string } | null };

/**
 * Checks a batch of `head: true` count reads. If any failed, it throws, and the
 * admin error page offers a retry: a failed count must never show as 0 or feed
 * a percentage. Otherwise every count is a number.
 */
export function countsOrThrow<const T extends readonly CountResult[]>(
  results: T,
  what: string
): { [K in keyof T]: { count: number } } {
  const failed = results.find((result) => result.error);
  if (failed?.error) throw new Error(`${what} could not be counted: ${failed.error.message}`);
  return results.map((result) => ({ count: result.count ?? 0 })) as {
    [K in keyof T]: { count: number };
  };
}
