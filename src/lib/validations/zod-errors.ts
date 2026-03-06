import type { ZodError } from "zod";

export function toFieldErrorMap(error: ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};

  for (const issue of error.issues) {
    const path = issue.path.join(".");
    if (path && !fieldErrors[path]) {
      fieldErrors[path] = issue.message;
    }
  }

  return fieldErrors;
}
