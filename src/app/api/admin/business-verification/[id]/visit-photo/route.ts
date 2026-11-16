import { uploadSeenPhoto } from "@/lib/foundation/seen-media-route";

/**
 * POST /api/admin/business-verification/[id]/visit-photo
 * The assigned verifier adds a photo (visit) or screenshot (video call).
 * Server time is recorded; for visits the browser's location is kept with
 * the photo as evidence. Photos are private and deleted with the case files.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return uploadSeenPhoto(request, (await params).id);
}
