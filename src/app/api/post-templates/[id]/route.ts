import type { NextRequest } from "next/server";
import {
  handleDeletePostTemplate,
  handleRenamePostTemplate,
} from "@/lib/foundation/post-templates";

/** PATCH /api/post-templates/[id] { name }: rename one of the caller's templates. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleRenamePostTemplate(request, (await params).id);
}

/** DELETE /api/post-templates/[id] {}: delete one of the caller's templates. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return handleDeletePostTemplate(request, (await params).id);
}
