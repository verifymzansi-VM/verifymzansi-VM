import "server-only";
import { parseFoundationConnection } from "./connection";

/** Separate bindings until cutover; legacy factories cannot supply this client. */
export function readFoundationRuntimeConnection(environment = process.env) {
  const connection = parseFoundationConnection({
    url: environment.FOUNDATION_SUPABASE_URL,
    expectedProjectRef: environment.FOUNDATION_PROJECT_REF,
    publishableKey: environment.FOUNDATION_SUPABASE_PUBLISHABLE_KEY,
  });
  const localTest =
    connection.expectedProjectRef === "local-foundation" &&
    environment.ENVIRONMENT !== "production" &&
    (environment.NODE_ENV === "test" ||
      (environment.ENVIRONMENT === "test" && environment.VERIFYMZANSI_RUNTIME_MODE === "e2e"));
  if (!localTest && connection.expectedProjectRef !== "gntzjtuncsyefujajmjy")
    throw new Error("Unapproved foundation runtime project");
  return connection;
}
