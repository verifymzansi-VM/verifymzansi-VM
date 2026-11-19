import "server-only";

import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { settleStaffCommand } from "./staff-command";

/**
 * Multi-listing package moves the minute sweep is failing to make now
 * (20261119151152_package_gap_fixes.sql): the post of an ended Individual slot
 * that cannot move into its package, or a package post that cannot move into
 * a free Individual slot in the package's last days. Staff with
 * `payments:view` read them; the sweep retries every minute by itself.
 */
const instant = z.iso.datetime({ offset: true });
const packageMoveFailureSchema = z.strictObject({
  package_id: z.uuid(),
  owner_name: z.string().max(120).nullable(),
  // None when the package itself was busy.
  post_id: z.uuid().nullable(),
  // The first 8 characters of the post id (never its title).
  post_ref: z
    .string()
    .regex(/^[0-9a-f]{8}$/)
    .nullable(),
  direction: z.enum(["into_package", "out_of_package"]),
  tries: z.number().int().min(1),
  first_failed_at: instant,
  last_failed_at: instant,
  reason: z.string().regex(/^(busy|error [0-9A-Z]{5})$/),
  package_ends_at: instant.nullable(),
  stuck: z.boolean(),
});
export type PackageMoveFailure = z.infer<typeof packageMoveFailureSchema>;

/** The current failures, oldest first (at most 50). */
export async function readStaffPackageMoveFailures(
  api: FoundationAuthenticatedApi
): Promise<PackageMoveFailure[]> {
  return (
    await settleStaffCommand(
      api.rpc("get_staff_package_move_failures", {}, { get: false }),
      z.strictObject({ items: z.array(packageMoveFailureSchema).max(50) })
    )
  ).items;
}
