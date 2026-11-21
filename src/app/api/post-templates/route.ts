import type { NextRequest } from "next/server";
import { handleListPostTemplates, handleSavePostTemplate } from "@/lib/foundation/post-templates";

/** GET /api/post-templates: the caller's post templates (SHOW_POST_TEMPLATES). */
export async function GET(request: NextRequest) {
  return handleListPostTemplates(request);
}

/** POST /api/post-templates { name, data }: save a template (Multi-listing package). */
export async function POST(request: NextRequest) {
  return handleSavePostTemplate(request);
}
