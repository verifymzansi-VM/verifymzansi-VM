/** @vitest-environment node */
import { expect, it } from "vitest";
import { readFoundationRuntimeConnection } from "./runtime-connection";

const environment = {
  NODE_ENV: "production" as const,
  ENVIRONMENT: "production",
  FOUNDATION_SUPABASE_URL: "https://gntzjtuncsyefujajmjy.supabase.co",
  FOUNDATION_PROJECT_REF: "gntzjtuncsyefujajmjy",
  FOUNDATION_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic",
};
it("uses only explicit approved foundation bindings without a legacy fallback", () => {
  expect(readFoundationRuntimeConnection(environment).expectedProjectRef).toBe(
    "gntzjtuncsyefujajmjy"
  );
  expect(() =>
    readFoundationRuntimeConnection({
      NODE_ENV: "production",
      NEXT_PUBLIC_SUPABASE_URL: environment.FOUNDATION_SUPABASE_URL,
    })
  ).toThrow();
  expect(() =>
    readFoundationRuntimeConnection({
      ...environment,
      FOUNDATION_PROJECT_REF: "abcdefghijklmnopqrst",
      FOUNDATION_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
    })
  ).toThrow("Unapproved");
  expect(() =>
    readFoundationRuntimeConnection({
      ...environment,
      FOUNDATION_SUPABASE_PUBLISHABLE_KEY: "sb_secret_synthetic",
    })
  ).toThrow();
});
it("allows the fixed local fixture only in a test runtime", () => {
  const local = {
    ...environment,
    FOUNDATION_PROJECT_REF: "local-foundation",
    FOUNDATION_SUPABASE_URL: "http://127.0.0.1:55441",
  };
  expect(() => readFoundationRuntimeConnection(local)).toThrow();
  expect(
    readFoundationRuntimeConnection({
      ...local,
      ENVIRONMENT: "test",
      VERIFYMZANSI_RUNTIME_MODE: "e2e",
    }).url
  ).toBe("http://127.0.0.1:55441");
});
