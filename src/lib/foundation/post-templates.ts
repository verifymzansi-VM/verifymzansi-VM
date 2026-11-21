import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { handleFoundationOwnerRoute, type FoundationRefusal } from "./owner-route";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { SHOW_POST_TEMPLATES } from "../hidden-features";
import { createLogger } from "../utils/logger";
import {
  POST_TEMPLATE_NAME_MAX,
  postTemplateData,
  postTemplateList,
  type PostTemplateList,
} from "../post-templates";

const log = createLogger("PostTemplates");

class TemplateRefusal extends Error {
  override name = "TemplateRefusal";
  constructor(readonly refusal: FoundationRefusal) {
    super(refusal.error);
  }
}

function refuse(code: string | undefined): never {
  if (code === "PT402")
    throw new TemplateRefusal({
      status: 403,
      error: "Templates are part of the Multi-listing package.",
      reason: "package_required",
    });
  if (code === "PT429")
    throw new TemplateRefusal({
      status: 409,
      error: "You can keep up to 20 templates. Delete one first, or save under an existing name.",
      reason: "template_limit",
    });
  if (code === "PT409")
    throw new TemplateRefusal({
      status: 409,
      error: "You already have a template with that name.",
      reason: "template_name_taken",
    });
  if (code === "PT404")
    throw new TemplateRefusal({
      status: 404,
      error: "This template was deleted. Reload the page.",
      reason: "template_unavailable",
    });
  if (code === "22023")
    throw new TemplateRefusal({
      status: 422,
      error: "Check the template name and try again.",
      reason: "template_invalid",
    });
  throw new Error("Post template command unavailable");
}

const name = z.string().trim().min(1).max(POST_TEMPLATE_NAME_MAX);
const templateId = z.uuid();

/** One owner route for the template commands, off (404) while SHOW_POST_TEMPLATES is off. */
function templateRoute<T>(
  request: NextRequest,
  mutate: boolean,
  command: (api: FoundationAuthenticatedApi, input: unknown) => Promise<T>
) {
  if (!SHOW_POST_TEMPLATES) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return handleFoundationOwnerRoute({
    request,
    log,
    action: "post_templates",
    mutate,
    maxBytes: 20_000,
    unavailableMessage: "Your templates could not be reached. Try again shortly.",
    signInMessage: "Sign in to use your templates",
    refusal: (error) =>
      error instanceof TemplateRefusal
        ? error.refusal
        : error instanceof z.ZodError
          ? { status: 422, error: "Check the template and try again.", reason: "template_invalid" }
          : null,
    command,
  });
}

function unwrap(result: { data: unknown; error: { code?: string } | null }) {
  if (result.error) refuse(result.error.code);
  return result.data;
}

/** The caller's templates and whether their Multi-listing package runs. */
export async function readMyPostTemplates(
  api: FoundationAuthenticatedApi
): Promise<PostTemplateList> {
  return postTemplateList.parse(
    unwrap(await api.rpc("list_my_post_templates", {}, { get: false }))
  );
}

/** GET /api/post-templates */
export function handleListPostTemplates(request: NextRequest) {
  return templateRoute(request, false, (api) => readMyPostTemplates(api));
}

/** POST /api/post-templates { name, data }: saves, or replaces the one with that name. */
export function handleSavePostTemplate(request: NextRequest) {
  return templateRoute(request, true, async (api, input) => {
    const body = z.strictObject({ name, data: postTemplateData }).parse(input);
    const saved = z
      .strictObject({ id: templateId, name: z.string(), replaced: z.boolean() })
      .parse(
        unwrap(
          await api.rpc(
            "save_my_post_template",
            { p_name: body.name, p_data: body.data },
            { get: false }
          )
        )
      );
    return saved;
  });
}

/** PATCH /api/post-templates/[id] { name } */
export function handleRenamePostTemplate(request: NextRequest, id: string) {
  return templateRoute(request, true, async (api, input) => {
    const body = z.strictObject({ name }).parse(input);
    if (!templateId.safeParse(id).success) refuse("PT404");
    return z
      .strictObject({ id: templateId, name: z.string() })
      .parse(
        unwrap(
          await api.rpc(
            "rename_my_post_template",
            { p_template: id.toLowerCase(), p_name: body.name },
            { get: false }
          )
        )
      );
  });
}

/** DELETE /api/post-templates/[id] with the empty JSON body {}. */
export function handleDeletePostTemplate(request: NextRequest, id: string) {
  return templateRoute(request, true, async (api, input) => {
    z.strictObject({}).parse(input);
    if (!templateId.safeParse(id).success) refuse("PT404");
    return z
      .strictObject({ id: templateId })
      .parse(
        unwrap(
          await api.rpc("delete_my_post_template", { p_template: id.toLowerCase() }, { get: false })
        )
      );
  });
}
