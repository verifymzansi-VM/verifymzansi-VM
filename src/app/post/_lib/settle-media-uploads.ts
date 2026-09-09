/** Finish in-flight uploads before allowing another submission attempt. */
export async function settleMediaUploads<T extends readonly unknown[]>(
  uploads: readonly [...T]
): Promise<{ -readonly [P in keyof T]: Awaited<T[P]> }> {
  const results = await Promise.allSettled(uploads);
  const failure = results.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  return results.map((result) => (result as PromiseFulfilledResult<unknown>).value) as {
    -readonly [P in keyof T]: Awaited<T[P]>;
  };
}
