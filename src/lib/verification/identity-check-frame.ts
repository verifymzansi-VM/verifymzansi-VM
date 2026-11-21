/**
 * The automatic ID check runs inside the verification page in an iframe of
 * the partner's session link (Didit plan, section 9). Only the verification
 * page may frame this origin and lend it the camera
 * (src/lib/middleware/security-headers.ts).
 *
 * Messages from the frame (ready, completed, error) are hints for the screen
 * only: the result is always fetched by the server.
 */
export const IDENTITY_CHECK_FRAME_ORIGIN = "https://verify.didit.me";

/** True only for a message posted by the check's own frame origin. */
export function isIdentityCheckFrameMessage(event: Pick<MessageEvent, "origin">): boolean {
  return event.origin === IDENTITY_CHECK_FRAME_ORIGIN;
}
