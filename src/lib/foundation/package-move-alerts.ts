import "server-only";
import { z } from "zod";
import { sendStaffOperationsEmail, type StaffEmailSection } from "../services/email";
import { createLogger } from "../utils/logger";
import { paymentAlertRecipients } from "./payment-alerts";

const log = createLogger("PackageMoveAlerts");

// Package moves the slot sweep could not make
// (20261119151152_package_gap_fixes.sql): `package_skipped` this run, how many
// recorded failures are stuck (failing for over 30 minutes, or repeatedly in
// the package's last day), and the stuck ones not reported before (each is
// reported once per failure run, the oldest 20, ids only). A database without
// that update sends neither.
const stuckMove = z.object({
  package_id: z.uuid(),
  post_id: z.uuid().nullable(),
  direction: z.enum(["into_package", "out_of_package"]),
  tries: z.number().int().min(1),
  first_failed_at: z.iso.datetime({ offset: true }),
  reason: z.string().regex(/^(busy|error [0-9A-Z]{5})$/),
});
export type StuckPackageMove = z.infer<typeof stuckMove>;
const packageMoves = z.object({
  package_skipped: z.number().int().min(0).optional(),
  package_stuck: z.number().int().min(0).optional(),
  package_stuck_moves: z.array(stuckMove).max(20).optional(),
});

/** Logs the moves the sweep skipped (retried next run) and the stuck ones;
 * returns the stuck moves the database has not reported before. */
export function readPackageMoves(data: unknown): StuckPackageMove[] {
  const moves = packageMoves.safeParse(data);
  if (!moves.success) return [];
  const { package_skipped: skipped = 0, package_stuck: stuck = 0 } = moves.data;
  const fresh = moves.data.package_stuck_moves ?? [];
  if (skipped > 0) log.warn("Package moves skipped this run", { skipped });
  if (stuck > 0) log.warn("Package moves stuck", { stuck, newlyStuck: fresh.length });
  if (fresh.length) log.error("Package move stuck", { moves: fresh });
  return fresh;
}

export type PackageMoveAlert = (moves: StuckPackageMove[]) => Promise<{ success: boolean }>;

const DIRECTION_WORDS: Record<StuckPackageMove["direction"], string> = {
  into_package: "into the package",
  out_of_package: "out of the package",
};

/** One staff email about newly stuck moves, to the payment alert addresses
 * (PAYMENT_ALERT_EMAILS). Without addresses it reports failure; the caller
 * logs it. Ids only: no names, titles or contact details. */
export const emailPackageMoveAlert: PackageMoveAlert = async (moves) => {
  const to = paymentAlertRecipients();
  if (!to) return { success: false };
  const first = moves[0];
  return sendStaffOperationsEmail({
    to,
    idempotencyKey: `package-moves/${first.package_id}/${first.post_id ?? "package"}/${first.first_failed_at}/${moves.length}`,
    subject: `VerifyMzansi: ${moves.length === 1 ? "a package move is" : `${moves.length} package moves are`} stuck`,
    title: moves.length === 1 ? "A package move is stuck" : "Package moves are stuck",
    intro:
      "The minute sweep keeps failing to move these posts. It tries again every minute; nothing was changed. A post that never moves falls into the 3-day grace when its package ends.",
    sections: moves.map((move): StaffEmailSection => ({
      heading: `Post could not move ${DIRECTION_WORDS[move.direction]}`,
      rows: [
        ["Package", move.package_id],
        ["Post", move.post_id ?? "(the package was busy)"],
        ["Tries", String(move.tries)],
        ["Failing since", move.first_failed_at],
        ["Reason", move.reason],
      ],
    })),
    closing:
      "Staff see these under Needs attention on Payments & Refunds. See docs/RUNBOOK.md, Package moves.",
    reason: "You receive VerifyMzansi payment alerts.",
    tone: "warning",
  });
};
