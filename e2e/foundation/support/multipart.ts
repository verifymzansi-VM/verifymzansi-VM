import type { Request } from "@playwright/test";

/**
 * Whether a request sends a multipart form (a file upload).
 *
 * Playwright's WebKit takes a routed request's body from WebKit's inspector,
 * which leaves out the file parts of a multipart form, so route.fetch() would
 * send the form again without its files and the website would refuse it. On
 * the first iPhone Safari (mobile-safari) CI runs, every ID photo upload
 * through such a recording guard was answered, yet the page never reached the
 * selfie step. A guard therefore passes these requests on with
 * route.continue(), which keeps the browser's own body, and reads the reply
 * from request.response() instead.
 */
export function isMultipartForm(request: Request) {
  return /^multipart\/form-data/i.test(request.headers()["content-type"] ?? "");
}
