import type { NextRequest } from "next/server";
import { handleRestoredAvatarUpload } from "@/lib/foundation/restored-avatar-route";

export async function POST(request: NextRequest) {
  return handleRestoredAvatarUpload(request);
}
