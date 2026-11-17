import type { NextRequest } from "next/server";
import { handleRestoredNotifications } from "@/lib/foundation/restored-notifications-route";

/**
 * GET /api/notifications
 * Fetch the authenticated user's notifications.
 * Query params: ?unread=true (filter to unread only), ?limit=25 (pagination)
 */
export async function GET(request: NextRequest) {
  return handleRestoredNotifications(request, "GET");
}

/**
 * PATCH /api/notifications
 * Mark notifications as read.
 * Body: { id: string } — mark single notification read
 * Body: { all: true } — mark all notifications read
 */
export async function PATCH(request: NextRequest) {
  return handleRestoredNotifications(request, "PATCH");
}

/**
 * DELETE /api/notifications
 * Clear all notifications for the user, or delete a single one.
 * Body: { id: string } — delete single notification
 * Body: { all: true } — delete all
 */
export async function DELETE(request: NextRequest) {
  return handleRestoredNotifications(request, "DELETE");
}
