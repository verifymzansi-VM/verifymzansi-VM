/** Read-only advisor callers supply fixed GET endpoints or SELECT-only query bodies. */
export async function fetchManagementApi<T>(
  token: string,
  pathname: string,
  init?: RequestInit
): Promise<T> {
  const timeout = AbortSignal.timeout(15_000);
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(`https://api.supabase.com/v1${pathname}`, {
    ...init,
    headers,
    signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
  });
  if (!response.ok) {
    // Response bodies may contain sensitive provider details; retain status only.
    throw new Error(`Supabase Management API ${pathname} failed (${response.status})`);
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new Error(`Supabase Management API ${pathname} returned invalid JSON`);
  }
}
